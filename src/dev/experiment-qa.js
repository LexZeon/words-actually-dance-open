import { eventBus, EVENTS } from '../core/events.js';
import { EFFECTS } from '../visuals/effect-catalog.js';
import { sampleLibrary } from '../content/sample-library.js';
import { authoringPrompt } from '../content/authoring-prompt.js';
import { parseScriptInput, serializeScriptDocument } from '../content/script-document.js';
import { collectAlignment, runAnnotatedFile } from './music-alignment-qa.js';
import { installDanceCycleQA } from './dance-cycle-qa.js';
import { installDrumQA } from './drum-qa.js';
import { installMusicSectionQA } from './music-section-qa.js';
import { installGhostQA } from './ghost-qa.js';
import { installShowcaseRecording } from './showcase-recording.js';
import { installSentenceQA } from './sentence-qa.js';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const assert = (condition, message, detail) => {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`);
};
const median = (values) => {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  return ordered.length ? ordered[Math.floor(ordered.length / 2)] : 0;
};
const counters = (app) => ({
  observed: app.playback.metrics.observedBeats,
  internal: app.playback.metrics.beats,
});
const differences = (app, before) => ({
  observedBeats: app.playback.metrics.observedBeats - before.observed,
  internalBeats: app.playback.metrics.beats - before.internal,
});
const beginTrace = () => {
  window.__wadAudioTrace = [];
  window.__wadCollectTrace = true;
};

/** Observe a bounded native condition without driving the production clock.
 * Sentence settle/hold and whole-group padding can legitimately exceed an
 * old fixed wall-time sleep; success still requires the actual app events. */
export async function waitForNativeQACondition(
  inspect,
  { timeoutMs = 12000, isActive = () => true, now = () => performance.now(), sleep = wait } = {},
) {
  if (typeof inspect !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000)
    throw new TypeError('Native QA requires a condition and a bounded timeout.');
  const started = now();
  for (;;) {
    const elapsedMs = now() - started;
    if (!isActive()) return { conditionMet: false, timedOut: false, cancelled: true, elapsedMs };
    if (inspect()) return { conditionMet: true, timedOut: false, cancelled: false, elapsedMs };
    if (elapsedMs >= timeoutMs) return { conditionMet: false, timedOut: true, cancelled: false, elapsedMs };
    await sleep(Math.min(25, timeoutMs - elapsedMs));
  }
}

function collectMotionEvidence(app) {
  const snapshots = [];
  let lastSample = -Infinity;
  const previousFrame = app.playback.onFrame;
  const record = (frame) => {
    previousFrame(frame);
    const now = performance.now();
    if (now - lastSample < 45) return;
    lastSample = now;
    const features = frame.measured;
    const motion = app.dance.getMotionState();
    if (!motion.poses || !motion.constraints?.canvas) return;
    snapshots.push({
      time: now / 1000,
      beatPhase: app.clock.getState().phase,
      frequencyHz: features.frequencyHz,
      amplitude: features.amplitude,
      timbreBrightness: features.timbreBrightness,
      noisiness: features.noisiness,
      attack: features.attack,
      group: { ...motion.poses.group },
      glyphs: motion.poses.glyphs.map((glyph) => ({ ...glyph })),
      canvas: { ...motion.constraints.canvas },
      featureMap: { ...motion.featureMap },
      primary: motion.primary,
      secondary: motion.secondary,
      cycle: { ...motion.cycle },
    });
  };
  app.playback.onFrame = record;
  return () => {
    if (app.playback.onFrame === record) app.playback.onFrame = previousFrame;
    const max = (values) => Math.max(0, ...values.filter(Number.isFinite));
    const range = (values) => {
      const valid = values.filter(Number.isFinite);
      return valid.length ? { min: Math.min(...valid), max: Math.max(...valid) } : { min: 0, max: 0 };
    };
    const finitePoses = snapshots.every((snapshot) =>
      [snapshot.group, ...snapshot.glyphs].every((pose) => Object.values(pose).every(Number.isFinite)),
    );
    const peakX = max(snapshots.map((snapshot) => Math.abs(snapshot.group.x) * snapshot.canvas.width));
    const peakY = max(snapshots.map((snapshot) => Math.abs(snapshot.group.y) * snapshot.canvas.height));
    const glyphX = max(
      snapshots.flatMap((snapshot) =>
        snapshot.glyphs.map((glyph) => Math.abs(glyph.x) * snapshot.canvas.width),
      ),
    );
    const glyphY = max(
      snapshots.flatMap((snapshot) =>
        snapshot.glyphs.map((glyph) => Math.abs(glyph.y) * snapshot.canvas.height),
      ),
    );
    const evidence = {
      audioSource: 'demo',
      pulseSource: 'internal',
      snapshotCount: snapshots.length,
      finitePoses,
      peakTranslationXPx: peakX,
      peakTranslationYPx: peakY,
      peakGlyphXPx: glyphX,
      peakGlyphYPx: glyphY,
      peakRotationRadians: max(snapshots.map((snapshot) => Math.abs(snapshot.group.rotation))),
      peakScaleDelta: max(
        snapshots.map((snapshot) =>
          Math.max(Math.abs(snapshot.group.scaleX - 1), Math.abs(snapshot.group.scaleY - 1)),
        ),
      ),
      inputs: {
        frequencyHz: range(snapshots.map((snapshot) => snapshot.frequencyHz)),
        amplitude: range(snapshots.map((snapshot) => snapshot.amplitude)),
        beatPhase: range(snapshots.map((snapshot) => snapshot.beatPhase)),
        timbreBrightness: range(snapshots.map((snapshot) => snapshot.timbreBrightness)),
        noisiness: range(snapshots.map((snapshot) => snapshot.noisiness)),
        attack: range(snapshots.map((snapshot) => snapshot.attack)),
      },
      minimumVisibleTravelPx: 8,
      visibleMotion: Math.max(peakX, peakY, glyphX, glyphY) >= 8,
      cycleSamples: snapshots.filter((snapshot) => snapshot.cycle.active).length,
      cycleIds: [...new Set(snapshots.map((snapshot) => snapshot.cycle.id).filter(Boolean))],
      samples: snapshots.filter((_, index) => index % 8 === 0),
    };
    return evidence;
  };
}

function nextBeat(action, inspect, timeout = 1600) {
  return new Promise((resolve) => {
    let timer;
    const stop = eventBus.on(EVENTS.BEAT_GRID, (event) => {
      if (event.kind !== 'beat') return;
      stop();
      clearTimeout(timer);
      resolve(inspect(event));
    });
    timer = setTimeout(() => {
      stop();
      resolve(false);
    }, timeout);
    action();
  });
}

function testTick(stage, beat, subdivision) {
  stage.onTick(
    {
      kind: subdivision === 0 ? 'beat' : 'subdivision',
      beatIndex: beat,
      subdivisionIndex: subdivision,
      bpm: 108,
      time: (beat * 60) / 108 + (subdivision * 60) / 108 / 4,
      source: 'test-fixture',
      testOnly: true,
    },
    { silent: 0, bpm: 108 },
  );
  stage.frame?.({ beatIndex: beat, phase: subdivision / 4 });
}

function revealCurrent(stage) {
  for (let beat = 5000; beat < 5080; beat++) {
    for (let subdivision = 0; subdivision < 4; subdivision++) {
      testTick(stage, beat, subdivision);
      if (stage.current && stage.getState().cursor === stage.current.chars.length) return;
    }
  }
  throw new Error('Visual fixture did not finish revealing within bounded test ticks.');
}

function rectangle(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function visualBounds(app) {
  const stage = rectangle(app.knowledge.el);
  const readingTrack = rectangle(app.knowledge.current?.track);
  const tolerance = 2;
  const readingWithinStage =
    !!stage &&
    !!readingTrack &&
    readingTrack.left >= stage.left - tolerance &&
    readingTrack.right <= stage.right + tolerance &&
    readingTrack.top >= stage.top - tolerance &&
    readingTrack.bottom <= stage.bottom + tolerance;
  return {
    stage,
    readingTrack,
    readingWithinStage,
    current: rectangle(app.knowledge.current?.el),
    ink: rectangle(app.knowledge.current?.inkForeground),
  };
}

function intersection(a, b, tolerance = 0.5) {
  return (
    a.left < b.right - tolerance &&
    a.right > b.left + tolerance &&
    a.top < b.bottom - tolerance &&
    a.bottom > b.top + tolerance
  );
}

function glyphCollisions(stage) {
  const glyphs = stage.current.chars
    .map(({ el, group }, index) => ({
      index,
      text: el.textContent,
      keyword: group.keyword,
      role: group.el.dataset.role || 'manual',
      emphasis: group.el.dataset.emphasis || 'manual',
      featured: group.el.classList.contains('emphasis-current'),
      entering: el.classList.contains('new'),
      read: el.classList.contains('read'),
      bounds: rectangle(el),
    }))
    .filter((glyph) => glyph.read && !/^\s*$/u.test(glyph.text));
  const ordinary = glyphs.filter((glyph) => !glyph.keyword && !glyph.entering);
  const keywords = glyphs.filter((glyph) => glyph.keyword);
  const collisions = [];
  for (const word of keywords)
    for (const adjacent of ordinary) {
      if (intersection(word.bounds, adjacent.bounds))
        collisions.push({
          keyword: word.index,
          ordinary: adjacent.index,
          keywordText: word.text,
          ordinaryText: adjacent.text,
        });
    }
  const ink = rectangle(stage.current.inkForeground);
  const ghost = rectangle(stage.current.inkGhost);
  const reading = rectangle(stage.current.track);
  return {
    collisions,
    glyphs,
    enteringKeywordCount: keywords.filter((glyph) => glyph.entering).length,
    ink,
    ghost,
    reading,
    inkOverlapsReading: !!ink && intersection(ink, reading),
    ghostOverlapsReading: !!ghost && intersection(ghost, reading),
  };
}

function freezeAnimations(stage, { groupPhase = 0.28, entryPhase = 0.3, inkPhase = 0.05 } = {}) {
  for (const animation of stage.el.getAnimations({ subtree: true })) {
    const timing = animation.effect.getTiming();
    const duration = Number(timing.duration) || 550;
    const name = animation.animationName || '';
    animation.pause();
    animation.currentTime =
      duration *
      (name === 'keyword-pulse' || name.startsWith('emphasis-')
        ? groupPhase
        : name === 'karaoke-pop'
          ? entryPhase
          : name === 'char-tunnel'
            ? entryPhase === 0.3
              ? 0.6
              : entryPhase
            : name === 'ink-push' || name === 'ink-depth'
              ? inkPhase
              : 1);
  }
}

const OVERLAP_FIXTURES = [
  {
    id: 'crossing-keywords',
    structured: true,
    sentenceType: 'definition',
    index: 0,
    keyword: '机器学习',
    text: '机器学习系统通过反馈调整结果。',
    keywords: [
      { text: '机器学习', role: 'primary' },
      { text: '学习系统', role: 'secondary' },
      { text: '反馈', role: 'secondary' },
    ],
  },
  {
    id: 'long-unbroken-text',
    manual: 'karaoke',
    index: 0,
    keyword: '文字',
    text: `文字${'abcdefghijklmnopqrstuvwxyz'.repeat(2)}`,
    keywords: ['文字'],
  },
  {
    id: 'structured-definition',
    structured: true,
    sentenceType: 'definition',
    index: 0,
    keyword: '连接',
    text: '先理解连接，再把信息变成解释，但关键词并不是自动事实验证。',
    keywords: [
      { text: '连接', role: 'primary' },
      {
        text: '信息',
        role: 'secondary',
        relation: { from: '连接', to: '信息', type: 'combine', label: '连接信息' },
      },
      { text: '解释', role: 'secondary' },
    ],
  },
  {
    id: 'structured-contrast',
    structured: true,
    sentenceType: 'contrast',
    index: 0,
    keyword: '速度',
    text: '先观察速度，再记录方向；同一任务可以比较耗时和产出。',
    keywords: [
      { text: '速度', role: 'primary' },
      { text: '方向', role: 'secondary' },
      { text: '耗时', role: 'secondary' },
    ],
  },
  {
    id: 'marker',
    manual: 'marker',
    index: 0,
    keyword: '长期记忆形成机制',
    text: '先把长期记忆形成机制与Working memory连接，再让注意力👩‍💻落在当前任务上。',
    keywords: ['长期记忆形成机制', 'Working memory', '注意力👩‍💻'],
  },
  {
    id: 'karaoke',
    manual: 'karaoke',
    index: 0,
    keyword: 'Working memory',
    text: '理解👩‍💻Working memory需要练习，长期记忆形成机制也需要有意识的复习。',
    keywords: ['Working memory', '长期记忆形成机制', '复习'],
  },
  {
    id: 'definition',
    index: 1,
    keyword: '长期记忆形成机制',
    text: '长期记忆形成机制是信息保存的过程；Working memory支持当前任务，注意力👩‍💻决定选择。',
    keywords: ['长期记忆形成机制', 'Working memory', '注意力👩‍💻'],
  },
  {
    id: 'contrast',
    index: 1,
    keyword: 'Working memory',
    text: 'Working memory维持当前任务，但长期记忆形成机制保留信息；两者需要注意力👩‍💻连接。',
    keywords: ['Working memory', '长期记忆形成机制', '注意力👩‍💻'],
  },
  {
    id: 'ink',
    index: 0,
    keyword: '共振',
    text: '共振让周期性驱动积累能量，长期记忆形成机制需要复习；Working memory👩‍💻负责当前任务。',
    keywords: ['共振', '长期记忆形成机制', 'Working memory👩‍💻'],
  },
  {
    id: 'steps',
    index: 1,
    keyword: 'Working memory',
    text: '先用Working memory整理任务，再理解长期记忆形成机制，最后检查注意力👩‍💻。',
    keywords: ['Working memory', '长期记忆形成机制', '注意力👩‍💻'],
  },
  {
    id: 'spotlight',
    index: 1,
    keyword: 'Working memory',
    text: 'Working memory连接长期记忆形成机制与注意力👩‍💻。',
    keywords: ['Working memory', '长期记忆形成机制', '注意力👩‍💻'],
  },
  {
    id: 'diagonal',
    index: 2,
    keyword: '记忆',
    text: '把分散的记忆连成完整文字，让长期信息连接当前任务并清楚解释每个不同的知识词组。',
    keywords: ['记忆', '完整文字', '知识词组'],
  },
];

const SCENE_FIXTURES = Object.freeze({
  opening: { index: 0, text: 'Words can dance.', keyword: 'Words' },
  definition: {
    index: 1,
    text: '节拍，是音乐中反复出现的时间参照；节奏则安排声音的长短和出现时刻。',
    keyword: '节拍',
  },
  contrast: {
    index: 1,
    text: '增加速度能够缩短单次处理时间，但方向需要先明确，否则更多投入未必产生更好的结果。',
    keyword: '速度',
  },
  steps: {
    index: 1,
    text: '先确定目标，再把任务拆成小步，最后按依赖关系安排顺序，让每一步都能得到检查。',
    keyword: '目标',
  },
  spotlight: { index: 1, text: '100 × 1.1² = 121。', keyword: '121' },
  diagonal: { index: 2, text: '把分散的信息连成一段能向别人清楚解释的文字。', keyword: '信息' },
  flip: { index: 1, text: '把分散的信息连成一段能向别人清楚解释的文字。', keyword: '信息' },
  ink: {
    index: 0,
    text: '共振：周期性驱动接近固有频率时，振动往往增强，阻尼会消耗能量并限制振幅。',
    keyword: '共振',
  },
});

/** Dynamically installed by AppController only for an explicitly requested native QA run. */
export function installExperimentQA(app) {
  if (!window.desktop?.testMode) return false;
  installDanceCycleQA(app);
  installDrumQA(app);
  installMusicSectionQA(app);
  installGhostQA(app);
  installSentenceQA(app);
  installShowcaseRecording(app);

  window.__wadExperiment = {
    getState: () => app.getState(),
    setEffect: (effect) => {
      app.preference('autoDirection', false);
      app.preference('effect', effect);
    },
  };
  window.__wadAnnotatedFileTest = (options) => runAnnotatedFile(app, options);

  window.__wadLocalLikesTest = async () => {
    app.setPlaying(false);
    await app.audio.setPaused(true);
    const saved = {
      topic: app.activeTopic,
      index: app.state.topicIndex,
      custom: app.state.custom,
      likes: new Set(app.state.likes),
      preferences: { ...app.state.preferences },
    };
    try {
      app.applyText('本地身份一', '频率｜频率描述重复的快慢。');
      app.like();
      const firstLiked = app.ui.get('like-button').getAttribute('aria-pressed') === 'true';
      app.applyText('本地身份二', '幅度｜幅度描述变化的大小。');
      const secondUnliked = app.ui.get('like-button').getAttribute('aria-pressed') === 'false';
      app.applyText('本地身份一', '频率｜频率描述重复的快慢。');
      const revisitedLiked = app.ui.get('like-button').getAttribute('aria-pressed') === 'true';
      app.preference('autoDirection', false);
      app.preference('effect', 'waterfall-flow');
      const selected = [...app.ui.get('effect-options').querySelectorAll('[aria-pressed="true"]')];
      const selectionAccessible = selected.length === 1 && selected[0].dataset.effect === 'waterfall-flow';
      return {
        pass: firstLiked && secondUnliked && revisitedLiked && selectionAccessible,
        firstLiked,
        secondUnliked,
        revisitedLiked,
        selectionAccessible,
        testOnly: true,
      };
    } finally {
      app.state.likes = saved.likes;
      app.state.custom = saved.custom;
      app.state.preferences = saved.preferences;
      app.applyTopic(saved.topic, saved.index);
      app.applyPreferences();
    }
  };

  window.__wadQuarterTurnTest = async ({ long = false } = {}) => {
    app.setPlaying(false);
    // This geometry fixture reads once; real automatic repeat has its own native test.
    app.preference('repeat', false);
    await app.audio.setPaused(true);
    app.pendingTopic = null;
    app.preference('autoDirection', false);
    app.preference('effect', 'quarter-turn');
    const texts = long
      ? [
          '先让这段较长的知识文字完整打出来，再把原句作为整体旋转，保留换行与字号，避免转场开始时突然跳小。',
          '旧句完成90°旋转后缩小让位，下一句保持水平阅读，所有文字依然跟随统一拍子逐字显现。',
          '历史句继续转到180°和270°，排列在画面边缘，长句也需要保持原文完整并留出阅读空间。',
          '窗口调整和暂停都不能提前完成转场，节拍恢复后应从原来的旋转进度继续。',
        ]
      : [
          '先让这句话打出来。',
          '文字转过90°，缩小让位。',
          '下一句继续，画面接着转。',
          '文字各有大小，节拍连成一段。',
        ];
    app.applyTopic(
      {
        id: 'qa-quarter-turn',
        title: '90° 旋转接力',
        lines: texts.map((text, index) => ({
          text,
          keyword: ['句话', '90°', '下一句', '节拍'][index],
          holdBeats: 1,
        })),
      },
      -1,
    );
    const stage = app.knowledge;
    stage.setRate(4);
    stage.setPaused(false);
    let beat = 12000;
    while (stage.lineIndex < 1 && beat < 12120) {
      for (let subdivision = 0; subdivision < 4; subdivision++) {
        testTick(stage, beat, subdivision);
        if (stage.lineIndex === 1) break;
      }
      if (stage.lineIndex < 1) beat++;
    }
    assert(
      stage.lineIndex === 1 && stage.cursor === 0,
      'Quarter-turn did not withhold the next sentence during handoff',
      stage.getState(),
    );
    const snapshots = [];
    for (const phase of [0, 0.25, 0.5, 0.75, 0.9]) {
      stage.frame({ beatIndex: beat, phase });
      await new Promise(requestAnimationFrame);
      const bounds = rectangle(stage.el);
      const old = rectangle(stage.history[0]);
      const node = stage.history[0];
      const pose = stage.quarterTurn.poses.get(node);
      const metrics = {
        fontPx: parseFloat(getComputedStyle(node).fontSize),
        measuredFontPx: pose.fontPx,
        height: node.offsetHeight,
        measuredHeight: pose.height,
        width: node.offsetWidth,
        measuredWidth: pose.width,
      };
      assert(
        Math.abs(metrics.fontPx - metrics.measuredFontPx) < 0.1 &&
          Math.abs(metrics.height - metrics.measuredHeight) <= 1 &&
          Math.abs(metrics.width - metrics.measuredWidth) <= 1,
        'Retired type changed its actual font or wrapping before geometric scaling',
        metrics,
      );
      if (phase === 0.5) {
        const progress = stage.getState().quarterTurn.progress;
        const angle = Number(node.dataset.quarterAngle);
        stage.setPaused(true);
        stage.layoutCurrent();
        stage.frame({ beatIndex: beat + 20, phase: 0.9 });
        assert(
          stage.getState().quarterTurn.progress === progress && Number(node.dataset.quarterAngle) === angle,
          'Layout while paused advanced the unfinished quarter-turn',
          stage.getState(),
        );
        stage.setPaused(false);
      }
      snapshots.push({
        phase,
        metrics,
        angle: Number(stage.history[0].dataset.quarterAngle),
        transform: stage.history[0].style.transform,
        inside:
          old.left >= bounds.left - 2 &&
          old.right <= bounds.right + 2 &&
          old.top >= bounds.top - 2 &&
          old.bottom <= bounds.bottom + 2,
        cursor: stage.cursor,
      });
    }
    assert(
      snapshots.every(({ inside, cursor }) => inside && cursor === 0),
      'Quarter-turn clipped or revealed new text too early',
      snapshots,
    );
    assert(snapshots.at(-1).angle === 90, 'Quarter-turn was not a complete planar 90 degree turn', snapshots);
    const frozen = stage.history[0].style.transform;
    stage.setPaused(true);
    stage.frame({ beatIndex: beat + 20, phase: 0.5 });
    assert(stage.history[0].style.transform === frozen, 'Quarter-turn moved while paused', stage.getState());
    stage.setPaused(false);
    for (let next = beat + 1; next < beat + 160 && !stage.finished; next++)
      for (let subdivision = 0; subdivision < 4; subdivision++) testTick(stage, next, subdivision);
    const history = stage.history.map((node) => ({
      text: node.querySelector('.reading-track').textContent,
      angle: Number(node.dataset.quarterAngle),
      opacity: Number(node.style.opacity),
    }));
    assert(
      stage.current.track.textContent === texts[3] && history.every(({ text }) => texts.includes(text)),
      'Quarter-turn altered or truncated the knowledge text',
      history,
    );
    assert(
      history.slice(0, 3).every(({ angle }, index) => angle === (index + 1) * 90),
      'Past sentences did not accumulate planar quarter-turns',
      history,
    );
    // Fast synthetic ticks finish reading without waiting for real CSS time.
    // Settle just the fixture's entrance/transitions before its still capture.
    freezeAnimations(stage);
    stage.setPaused(true);
    app.dance.setPaused(true);
    assert(
      stage.finished && visualBounds(app).readingWithinStage,
      'Quarter-turn current sentence failed to finish or fit its reading area',
      stage.getState(),
    );
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return {
      pass: true,
      long,
      pulseSource: 'test-fixture',
      testOnly: true,
      pauseStable: true,
      snapshots,
      history,
      currentText: stage.current.track.textContent,
      state: stage.getState(),
      bounds: visualBounds(app),
    };
  };

  window.__wadTextFlowTest = async ({ long = false } = {}) => {
    app.setPlaying(false);
    // This geometry fixture reads once; real automatic repeat has its own native test.
    app.preference('repeat', false);
    await app.audio.setPaused(true);
    app.pendingTopic = null;
    app.preference('autoDirection', false);
    app.preference('effect', 'waterfall-flow');
    const texts = long
      ? [
          '先把这段知识文字完整写出来，让它留在同一版面中，下一句才会沿着它的边缘接着写。',
          '整个版面旋转与推移，已读文字仍保持相对位置，而不是分别缩小放到固定边缘。',
          '长句继续保持原来的换行，短句可以明显放大，旧句允许经过画框边界。',
          '当前知识仍要完整可读，暂停之后镜头与打字一起停下，恢复时继续原来的拍相。',
        ]
      : ['文字连成一幅画', '整个版面转过去', '下一句接着写', '继续'];
    app.applyTopic(
      {
        id: 'qa-text-flow',
        title: '瀑布流文字',
        lines: texts.map((text, index) => ({
          text,
          keyword: long ? ['知识', '旋转', '短句', '可读'][index] : ['文字', '版面', '下一句', '继续'][index],
          holdBeats: 1,
        })),
      },
      -1,
    );
    const stage = app.knowledge;
    stage.setRate(4);
    stage.setPaused(false);
    let beat = 14000;
    while (stage.lineIndex < 1 && beat < 14120) {
      for (let subdivision = 0; subdivision < 4; subdivision++) {
        testTick(stage, beat, subdivision);
        if (stage.lineIndex === 1) break;
      }
      if (stage.lineIndex < 1) beat++;
    }
    assert(
      stage.lineIndex === 1 && stage.cursor === 0,
      'Flow did not withhold typing during its camera turn',
      stage.getState(),
    );
    const plane = stage.textFlow.plane;
    const old = stage.history[0];
    const worldStyle = old.style.transform;
    const snapshots = [];
    for (const phase of [0, 0.25, 0.5, 0.75, 0.9]) {
      stage.frame({ beatIndex: beat, phase });
      await new Promise(requestAnimationFrame);
      const state = stage.textFlow.getState();
      assert(
        old.style.transform === worldStyle,
        'A history sentence moved independently of the common camera',
        state,
      );
      const poses = new Map(state.nodes.map((node) => [node.id, node]));
      for (const node of [stage.current.el, ...stage.history]) {
        const pose = poses.get(node.dataset.flowId);
        const metrics = {
          font: parseFloat(getComputedStyle(node).fontSize),
          height: node.offsetHeight,
          width: node.offsetWidth,
        };
        assert(
          Math.abs(metrics.font - pose.fontPx) < 0.1 &&
            Math.abs(metrics.width - pose.width) <= 1 &&
            Math.abs(metrics.height - pose.height) <= 1,
          'Flow font or wrapping disagrees with the fixed world geometry',
          { metrics, pose },
        );
      }
      if (phase === 0.5) {
        const cameraAngle = state.camera.angleDeg,
          progress = state.progress;
        stage.setPaused(true);
        stage.layoutCurrent();
        stage.frame({ beatIndex: beat + 20, phase: 0.9 });
        assert(
          stage.textFlow.getState().progress === progress &&
            stage.textFlow.getState().camera.angleDeg === cameraAngle,
          'Paused flow layout advanced the unfinished camera turn',
          stage.getState(),
        );
        stage.setPaused(false);
      }
      snapshots.push({
        phase,
        angle: state.camera.angleDeg,
        zoom: state.camera.zoom,
        cursor: stage.cursor,
        progress: state.progress,
      });
    }
    assert(
      snapshots.every((s) => s.cursor === 0) && snapshots.at(-1).angle === 90,
      'Flow camera did not complete 90 degrees before typing',
      snapshots,
    );
    assert(
      plane === stage.textFlow.plane && stage.el.querySelectorAll('.knowledge-flow-plane').length === 1,
      'Flow must use one persistent plane',
    );
    for (let next = beat + 1; next < beat + 180 && !stage.finished; next++)
      for (let sub = 0; sub < 4; sub++) testTick(stage, next, sub);
    const state = stage.textFlow.getState();
    assert(
      stage.finished && stage.current.track.textContent === texts[3],
      'Flow failed to finish the literal knowledge',
      stage.getState(),
    );
    assert(
      state.camera.angleDeg === 270 && state.nodes.at(-1).screenPose.angleDeg === 0,
      'Flow accumulated the wrong camera orientation',
      state,
    );
    assert(
      state.currentFits && state.currentReadable && visualBounds(app).readingWithinStage,
      'Flow current sentence is clipped or unreadable',
      state,
    );
    assert(
      state.nodes.every((node) => node.screenPose.scale === state.camera.zoom),
      'Flow individually scaled a history sentence',
      state,
    );
    const history = stage.history.map((node) => node.querySelector('.reading-track').textContent);
    assert(
      history.every((text) => texts.includes(text)),
      'Flow altered the knowledge text',
      history,
    );
    const croppedHistory = state.nodes.slice(0, -1).some((node) => node.screenPose.clipped);
    assert(
      long || state.nodes.at(-1).screenPose.renderedFontPx >= 64,
      'Short flow phrase is too small',
      state,
    );
    // Synthetic ticks run faster than the compositor and character transitions.
    // Let this fixture's final DOM commit before settling its still capture.
    await wait(180);
    freezeAnimations(stage);
    stage.setPaused(true);
    app.dance.setPaused(true);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const visibleGlyphs = stage.current.chars.filter(
      ({ el }) => Number(getComputedStyle(el).opacity) >= 0.95,
    ).length;
    assert(
      visibleGlyphs === stage.current.chars.length,
      'Flow reported reading complete with invisible glyphs',
      { visibleGlyphs, chars: stage.current.chars.length },
    );
    return {
      pass: true,
      long,
      pulseSource: 'test-fixture',
      testOnly: true,
      sharedPlane: true,
      visibleGlyphs,
      pauseStable: true,
      croppedHistory,
      snapshots,
      history,
      currentText: stage.current.track.textContent,
      state,
      bounds: visualBounds(app),
    };
  };

  window.__wadAutomaticEffectsTest = async () => {
    app.setPlaying(false);
    // This geometry fixture reads once; real automatic repeat has its own native test.
    app.preference('repeat', false);
    await app.audio.setPaused(true);
    app.pendingTopic = null;
    app.preference('autoDirection', true);
    const lines = Array.from({ length: 30 }, (_, index) => ({
      text: `知识跟着拍子走${index + 1}。`,
      keyword: '知识',
      holdBeats: 1,
    }));
    app.applyTopic({ id: 'qa-automatic-effects', title: '自动切换效果', lines }, -1);
    const stage = app.knowledge;
    stage.setRate(4);
    stage.setPaused(false);
    const captured = new Set(),
      snapshots = [];
    for (let beat = 16000; beat < 16240 && !stage.finished; beat++) {
      for (let sub = 0; sub < 4; sub++) {
        testTick(stage, beat, sub);
        if (stage.current && stage.cursor === stage.current.chars.length && !captured.has(stage.lineIndex)) {
          const state = stage.getState();
          // Settle this synthetic fixture before checking actual glyphs. Some
          // effects translate a full-width empty lane beyond the viewport.
          await new Promise(requestAnimationFrame);
          freezeAnimations(stage);
          const bounds = visualBounds(app);
          const displayed = ['pop', 'flash'].includes(state.effect)
            ? [stage.current.spotlight]
            : stage.current.chars.map(({ el }) => el);
          const visibleGlyphsWithinStage = displayed.every((node) => {
            const rect = rectangle(node),
              area = bounds.stage;
            return (
              rect.left >= area.left - 2 &&
              rect.right <= area.right + 2 &&
              rect.top >= area.top - 2 &&
              rect.bottom <= area.bottom + 2
            );
          });
          assert(
            state.autoDirection && visibleGlyphsWithinStage,
            'Automatic effect did not keep its current reading geometry',
            { state, bounds },
          );
          assert(
            stage.current.track.textContent === lines[stage.lineIndex].text,
            'Automatic effect changed the text',
          );
          assert(
            !stage.history.some((node) => stage.current.el === node),
            'Automatic effect reused current as history',
          );
          if (state.effect === 'waterfall-flow')
            assert(
              stage.textFlow.plane && state.textFlow.sharedPlane,
              'Automatic flow failed to render its common plane',
            );
          if (state.effect === 'quarter-turn')
            assert(state.quarterTurn, 'Automatic quarter-turn failed to reach its renderer');
          captured.add(stage.lineIndex);
          snapshots.push({
            line: stage.lineIndex,
            effect: state.effect,
            presentation: state.presentation,
            history: state.historyCount,
            visibleGlyphsWithinStage,
          });
        }
      }
    }
    assert(
      captured.size === lines.length,
      'Automatic effects failed to read the complete script',
      stage.getState(),
    );
    assert(
      snapshots.every((snapshot, index) => index === 0 || snapshot.effect !== snapshots[index - 1].effect),
      'Automatic effects repeated immediately',
      snapshots,
    );
    const modes = [...new Set(snapshots.map((snapshot) => snapshot.effect))];
    assert(
      EFFECTS.every(({ id }) => modes.includes(id)),
      'Automatic short-script rotation omitted implemented effects',
      modes,
    );
    stage.setPaused(true);
    app.dance.setPaused(true);
    return {
      pass: true,
      pulseSource: 'test-fixture',
      testOnly: true,
      modes,
      snapshots,
      lines: captured.size,
    };
  };

  window.__wadScriptSmokeTest = async () => {
    const original = { topic: app.activeTopic, index: app.state.topicIndex, custom: app.state.custom };
    const fixture = {
      schemaVersion: 1,
      title: '标准文案导入实验',
      sourceMode: 'source-only',
      lines: [
        {
          text: '先观察速度，再解释方向，但关系由材料决定。',
          keyword: '速度',
          sentenceType: 'definition',
          keywords: [
            { text: '速度', role: 'primary' },
            {
              text: '方向',
              role: 'secondary',
              relation: { from: '速度', to: '方向', type: 'related', label: '同一观察' },
            },
            { text: '材料', role: 'secondary' },
          ],
        },
      ],
    };
    try {
      app.setPlaying(false);
      await app.audio.setPaused(true);
      app.pendingTopic = null;
      app.ui.openPanel('content-dialog');
      await app.importScriptFile(new File([JSON.stringify(fixture)], '实验.wad.json'));
      const topic = app.activeTopic;
      const editor = parseScriptInput(document.getElementById('custom-text').value);
      const exported = serializeScriptDocument(topic);
      const imported = parseScriptInput(JSON.stringify(exported));
      const persisted = await window.desktop.loadState();
      const preserved =
        topic.lines[0].text === fixture.lines[0].text &&
        editor.lines[0].sentenceType === 'definition' &&
        imported.lines[0].keywords[1].relation.from === '速度' &&
        persisted.custom?.lines[0].keywords[1].role === 'secondary' &&
        persisted.custom?.schemaVersion === 1;
      assert(preserved, 'Structured import/editor/export/persistence lost metadata', { topic, persisted });
      app.knowledge.setAutoDirection(true);
      app.knowledge.setPaused(false);
      revealCurrent(app.knowledge);
      app.knowledge.setPaused(true);
      const presentation = app.knowledge.getState();
      assert(
        presentation.layout === 'definition' &&
          presentation.scene.directionSource === 'explicit' &&
          presentation.emphasis.some((item) => item.text === '方向' && item.role === 'secondary'),
        'Structured metadata did not reach the renderer',
        presentation,
      );
      app.ui.openPanel('content-dialog');
      let rejected = false;
      try {
        await app.importScriptFile(new File(['{"schemaVersion":99}'], '错误.json'));
      } catch {
        rejected = true;
      }
      const failedImportPreservesContent =
        rejected && app.activeTopic === topic && document.getElementById('content-dialog').open;
      assert(failedImportPreservesContent, 'Invalid script damaged the current content');
      const handlers = ['copyAuthoringPrompt', 'importScript', 'importScriptFile', 'exportScript'];
      const buttonsConnected = handlers.every((name) => typeof app.ui.handlers[name] === 'function');
      const promptsAvailable = ['source-only', 'free-examples', 'free-expansion'].every((mode) =>
        authoringPrompt(mode).includes('schemaVersion'),
      );
      assert(buttonsConnected && promptsAvailable, 'Authoring controls are disconnected');
      return {
        pass: true,
        importPath: 'AppController.importScriptFile → decodeScriptFile → parseScriptInput',
        preservedText: true,
        explicitScene: presentation.layout,
        roles: presentation.emphasis.map(({ text, role, variant }) => ({ text, role, variant })),
        jsonRoundTrip: true,
        nativeStatePreserved: true,
        failedImportPreservesContent,
        buttonsConnected,
        promptsAvailable,
        clipboardWritten: false,
        nativeFileDialogClicked: false,
      };
    } finally {
      app.ui.closePanel('content-dialog');
      app.state.custom = original.custom;
      app.pendingTopic = null;
      app.applyTopic(original.topic, original.index);
    }
  };

  window.__wadPrepareContentPanel = () => {
    app.ui.openPanel('content-dialog');
    document.querySelector('#content-dialog .custom-content').open = true;
    document.querySelector('#content-dialog .custom-content').scrollIntoView({ block: 'start' });
    return {
      dialog: rectangle(document.getElementById('content-dialog')),
      importButton: rectangle(document.getElementById('import-script-button')),
      copyButton: rectangle(document.getElementById('copy-authoring-prompt')),
      exportButton: rectangle(document.getElementById('export-script-button')),
      viewport: { width: innerWidth, height: innerHeight },
    };
  };

  window.__wadLiveMusicTest = async ({ duration = 30000, label = 'music' } = {}) => {
    duration = Math.min(60000, Math.max(1000, Number(duration) || 30000));
    await app.changeSource(() => app.audio.startSystem());
    beginTrace();
    const before = counters(app);
    const frames = [];
    const finishAlignment = collectAlignment(app);
    const stop = eventBus.on(EVENTS.AUDIO_FRAME, (features) => {
      const diagnostic = app.audio.detector?.getDiagnostics?.();
      frames.push({
        bpm: features.bpm,
        confidence: features.confidence,
        silent: features.silent,
        source: features.silent ? 'silent' : diagnostic?.source || 'unknown',
      });
    });
    try {
      await wait(duration);
      const voiced = frames.filter((frame) => !frame.silent);
      const confident = voiced.filter((frame) => frame.confidence >= 0.45);
      const sourceCounts = {};
      for (const frame of frames) sourceCounts[frame.source] = (sourceCounts[frame.source] || 0) + 1;
      return {
        label,
        duration,
        mode: app.audio.mode,
        groundTruthBpm: null,
        syntheticAudio: false,
        sampleRate: app.audio.context.sampleRate,
        fftSize: app.audio.analyser.fftSize,
        frameCount: frames.length,
        voicedFrames: voiced.length,
        voicedCoverage: voiced.length / Math.max(1, frames.length),
        medianBpm: median(voiced.map((frame) => frame.bpm).filter((bpm) => bpm > 0)),
        medianConfidentBpm: median(confident.map((frame) => frame.bpm).filter((bpm) => bpm > 0)),
        meanConfidence:
          voiced.reduce((total, frame) => total + (Number(frame.confidence) || 0), 0) /
          Math.max(1, voiced.length),
        confidentCoverage: confident.length / Math.max(1, voiced.length),
        overallConfidentCoverage: confident.length / Math.max(1, frames.length),
        sourceCounts,
        ...differences(app, before),
        clock: app.clock.getState(),
        fps: app.playback.metrics.fps,
        knowledge: app.knowledge.getState(),
        features: { ...app.playback.rawFeatures },
        traceMeta: window.__wadAudioTraceMeta,
        videoStopped: app.audio.stream.getVideoTracks().every((track) => track.readyState === 'ended'),
      };
    } finally {
      stop();
      window.__wadLiveAlignmentTrace = finishAlignment().frames;
      window.__wadLiveMusicTrace = window.__wadAudioTrace;
      window.__wadCollectTrace = false;
      app.setPlaying(false);
      await app.audio.setPaused(true);
    }
  };

  window.__wadSmokeTest = async () => {
    const preferences = { ...app.state.preferences };
    const original = { topic: app.activeTopic, index: app.state.topicIndex };
    beginTrace();
    let finishMotion = () => null;
    try {
      const initial = counters(app);
      await app.demo('balanced');
      finishMotion = collectMotionEvidence(app);
      await wait(7200);
      const motionEvidence = finishMotion();
      finishMotion = () => null;
      assert(
        motionEvidence.snapshotCount > 10 && motionEvidence.finitePoses && motionEvidence.visibleMotion,
        'Rendered dance stayed static or produced invalid poses',
        motionEvidence,
      );
      const detected = { ...app.playback.rawFeatures };
      const active = app.knowledge.getState();
      const observed = differences(app, initial);
      assert(
        observed.observedBeats > 2 && active.cursor > 0 && detected.bpm > 0,
        'Observed demo analysis failed',
        { observed, active, detected },
      );

      const oldTopic = app.activeTopic.id;
      let waitedForBeat;
      const applied = nextBeat(
        () => {
          app.loadTopic(sampleLibrary[1], 1);
          waitedForBeat = app.activeTopic.id === oldTopic && !!app.pendingTopic;
        },
        () => app.activeTopic.id === sampleLibrary[1].id,
      );
      const appliedOnBeat = await applied;
      const queuedTopicOnBeat = waitedForBeat && appliedOnBeat;
      assert(queuedTopicOnBeat, 'Topic did not wait for the unified next beat', app.getState());

      app.setPlaying(false);
      await app.audio.setPaused(true);
      const frozen = app.knowledge.getState();
      await wait(250);
      const paused = app.knowledge.getState();
      const pauseStable = frozen.cursor === paused.cursor && frozen.lineIndex === paused.lineIndex;
      assert(pauseStable, 'Manual pause advanced content', { frozen, paused });

      const internalTopic = {
        id: 'qa-internal',
        title: '内部时钟实验',
        keyword: '知识',
        emoji: '·',
        lines: [
          { id: 'qa-1', text: '知识在跳', keyword: '知识', holdBeats: 1 },
          { id: 'qa-2', text: '学习不停', keyword: '学习', holdBeats: 1 },
        ],
      };
      app.state.preferences = { ...preferences, rate: 4, repeat: true, autoDirection: false };
      app.applyPreferences();
      app.applyTopic(internalTopic, -1);
      const enters = [];
      let completions = 0;
      const stopLines = eventBus.on(EVENTS.LINE_ENTER, (event) => {
        if (app.activeTopic.id === internalTopic.id) enters.push(event.index);
      });
      const stopComplete = eventBus.on(EVENTS.CONTENT_COMPLETE, (event) => {
        if (event.id === internalTopic.id) completions++;
      });
      const internalStart = counters(app);
      app.setPlaying(true);
      let repeatObservation;
      try {
        repeatObservation = await waitForNativeQACondition(
          () => enters.includes(1) && enters.filter((index) => index === 0).length >= 2 && completions >= 1,
          {
            isActive: () => !app.destroyed && app.state.playing && app.activeTopic.id === internalTopic.id,
          },
        );
      } finally {
        stopLines();
        stopComplete();
      }
      const internal = {
        ...differences(app, internalStart),
        lineEntries: enters,
        completions,
        audioSuspended: app.audio.suspended,
        source: 'internal',
        repeatObservation,
      };
      internal.automaticAdvance = enters.includes(1);
      internal.repeat = enters.filter((index) => index === 0).length >= 2 && completions >= 1;
      assert(
        internal.internalBeats > 3 &&
          internal.observedBeats === 0 &&
          internal.automaticAdvance &&
          internal.repeat &&
          internal.audioSuspended &&
          repeatObservation.conditionMet,
        'Continuous clock or automatic sentence/repeat failed',
        internal,
      );

      app.setPlaying(false);
      app.applyTopic(sampleLibrary[0], 0);
      app.knowledge.setAutoDirection(false);
      app.knowledge.setPaused(false);
      const effects = [];
      for (const [index, effect] of EFFECTS.entries()) {
        app.knowledge.setEffect(effect.id);
        testTick(app.knowledge, 9000 + index, 0);
        effects.push({
          id: effect.id,
          selected: app.knowledge.el.dataset.effect === effect.id,
          pulseSource: 'test-fixture',
        });
      }
      assert(
        effects.every((effect) => effect.selected),
        'Manual effect selection failed',
        effects,
      );
      return {
        ...observed,
        detected,
        knowledge: active,
        pauseStable,
        queuedTopicOnBeat,
        motionEvidence,
        internalOnly: internal,
        effects,
        frames: app.playback.metrics.frames,
        fps: app.playback.metrics.fps,
        syntheticAudio: true,
        manualEffectsUseTestTicks: true,
      };
    } finally {
      finishMotion();
      window.__wadCollectTrace = false;
      app.setPlaying(false);
      await app.audio.setPaused(true);
      app.state.preferences = preferences;
      app.applyPreferences();
      app.pendingTopic = null;
      app.applyTopic(original.topic, original.index);
    }
  };

  window.__wadLocalFileSmokeTest = async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const index = await app.audio.addTrack('本地 WAV 验证', bytes);
    const before = counters(app);
    await app.changeSource(() => app.audio.playTrack(index));
    beginTrace();
    try {
      await wait(7000);
      const result = {
        mode: app.audio.mode,
        decodedDuration: app.audio.buffer.duration,
        ...differences(app, before),
        features: { ...app.playback.rawFeatures },
        knowledge: app.knowledge.getState(),
      };
      assert(
        result.mode === 'file' && result.observedBeats > 2 && result.features.bpm > 0,
        'Local file observed analysis failed',
        result,
      );
      return result;
    } finally {
      window.__wadCollectTrace = false;
      app.setPlaying(false);
      await app.audio.setPaused(true);
    }
  };

  window.__wadCaptureSmokeTest = async (externalReference = false) => {
    await app.audio.initialize();
    await app.audio.context.resume();
    let testSource, volume;
    if (!externalReference) {
      testSource = app.audio.context.createBufferSource();
      testSource.buffer = app.audio.createDemo('balanced').buffer;
      testSource.loop = true;
      volume = app.audio.context.createGain();
      volume.gain.value = 0.22;
      testSource.connect(volume);
      volume.connect(app.audio.context.destination);
      testSource.start();
    }
    try {
      await app.changeSource(() => app.audio.startSystem());
      beginTrace();
      const before = counters(app);
      await wait(8000);
      const result = {
        mode: app.audio.mode,
        externalReference,
        syntheticAudio: true,
        ...differences(app, before),
        audioTracks: app.audio.stream.getAudioTracks().map((track) => ({
          kind: track.kind,
          readyState: track.readyState,
          settings: track.getSettings(),
        })),
        videoStopped: app.audio.stream.getVideoTracks().every((track) => track.readyState === 'ended'),
        features: { ...app.playback.rawFeatures },
        knowledge: app.knowledge.getState(),
      };
      assert(
        result.observedBeats > 2 &&
          result.videoStopped &&
          result.audioTracks.every((track) => track.readyState === 'live'),
        'Loopback observed verification failed',
        result,
      );
      return result;
    } finally {
      window.__wadLoopbackTrace = window.__wadAudioTrace;
      window.__wadCollectTrace = false;
      testSource?.stop();
      testSource?.disconnect();
      volume?.disconnect();
      app.setPlaying(false);
      await app.audio.setPaused(true);
      app.audio.disconnectSource();
    }
  };

  window.__wadPrepareScreenshot = async (effect = 'stack') => {
    assert(
      EFFECTS.some((entry) => entry.id === effect),
      'Unknown manual effect fixture',
      effect,
    );
    app.setPlaying(false);
    await app.audio.setPaused(true);
    app.pendingTopic = null;
    app.applyTopic(sampleLibrary[0], 0);
    app.knowledge.setAutoDirection(false);
    app.knowledge.setEffect(effect);
    app.knowledge.setRate(4);
    app.knowledge.setPaused(false);
    app.dance.setPaused(false);
    revealCurrent(app.knowledge);
    await wait(1100);
    app.knowledge.setPaused(true);
    app.dance.setPaused(true);
    await new Promise(requestAnimationFrame);
    return {
      effect,
      pulseSource: 'test-fixture',
      knowledge: app.knowledge.getState(),
      bounds: visualBounds(app),
      visibleText: app.knowledge.current.track.textContent,
    };
  };

  window.__wadPrepareScene = async (layout) => {
    const fixture = SCENE_FIXTURES[layout];
    assert(fixture, 'Unknown directed scene fixture', layout);
    const lines = Array.from({ length: fixture.index }, (_, index) => ({
      id: `prefix-${index}`,
      text: 'Understand the next idea.',
      keyword: 'Understand',
      holdBeats: 8,
    }));
    lines.push({ id: `fixture-${layout}`, text: fixture.text, keyword: fixture.keyword, holdBeats: 8 });
    const topic = {
      id: `qa-scene-${layout}`,
      title: `视觉实验 · ${layout}`,
      keyword: fixture.keyword,
      lines,
    };
    app.setPlaying(false);
    await app.audio.setPaused(true);
    app.pendingTopic = null;
    app.applyTopic(topic, -1);
    app.knowledge.setAutoDirection(true);
    app.knowledge.setRate(4);
    app.knowledge.setPaused(false);
    app.dance.setPaused(false);
    if (fixture.index) app.knowledge.requestStep(fixture.index);
    revealCurrent(app.knowledge);
    await wait(1100);
    app.knowledge.setPaused(true);
    app.dance.setPaused(true);
    await new Promise(requestAnimationFrame);
    const knowledge = app.knowledge.getState();
    const result = {
      layout,
      pulseSource: 'test-fixture',
      text: fixture.text,
      textLength: Array.from(fixture.text).length,
      knowledge,
      bounds: visualBounds(app),
      visibleText: app.knowledge.current.track.textContent,
    };
    assert(
      knowledge.layout === layout && result.visibleText === fixture.text,
      'Directed fixture lost scene or original text',
      result,
    );
    return result;
  };

  window.__wadOverlapTest = async () => {
    app.setPlaying(false);
    await app.audio.setPaused(true);
    app.pendingTopic = null;
    const results = [];
    for (const fixture of OVERLAP_FIXTURES) {
      const lines = Array.from({ length: fixture.index }, (_, index) => ({
        id: `overlap-prefix-${index}`,
        text: 'A preceding idea.',
        keyword: 'idea',
        holdBeats: 32,
      }));
      lines.push({
        text: fixture.text,
        keyword: fixture.keyword,
        keywords: fixture.keywords.map((entry) => (typeof entry === 'string' ? { text: entry } : entry)),
        ...(fixture.sentenceType ? { sentenceType: fixture.sentenceType } : {}),
        holdBeats: 32,
      });
      let topic = { id: `qa-overlap-${fixture.id}`, title: '占位边界实验', keyword: fixture.keyword, lines };
      if (fixture.structured) {
        const { parseScriptInput } = await import('../content/script-document.js');
        topic = parseScriptInput(
          JSON.stringify({ schemaVersion: 1, sourceMode: 'source-only', title: topic.title, lines }),
        );
      }
      app.applyTopic(topic, -1);
      const stage = app.knowledge;
      stage.setAutoDirection(!fixture.manual);
      if (fixture.manual) stage.setEffect(fixture.manual);
      stage.setRate(4);
      stage.setPaused(false);
      if (fixture.index) stage.requestStep(fixture.index);
      revealCurrent(stage);
      stage.layoutCurrent();
      await wait(650);
      // Reproduce a last keyword glyph entering while its read neighbours remain visible.
      const entering = [...stage.current.chars].reverse().find(({ group }) => group.keyword);
      stage.clearTransientClasses();
      entering.el.classList.add('new');
      stage.pulseKeywords();
      const frames = [];
      for (const phase of [0.05, 0.28, 0.55, 0.9]) {
        freezeAnimations(stage, {
          groupPhase: phase,
          entryPhase: phase === 0.28 ? 0.3 : phase,
          inkPhase: phase,
        });
        await new Promise(requestAnimationFrame);
        frames.push({ phase, ...glyphCollisions(stage) });
      }
      const emphasisPeaks = [];
      const featured = stage.current.featuredKeyword;
      for (const group of stage.current.groups.filter((entry) => entry.keyword)) {
        stage.clearTransientClasses();
        const last = stage.current.chars.filter((entry) => entry.group === group).at(-1);
        last.el.classList.add('new');
        stage.current.featuredKeyword = group.el;
        stage.pulseKeywords();
        freezeAnimations(stage);
        await new Promise(requestAnimationFrame);
        const probe = glyphCollisions(stage);
        const style = getComputedStyle(group.el);
        const decoration = getComputedStyle(group.el, '::after');
        emphasisPeaks.push({
          text: group.el.textContent,
          role: group.emphasis?.role || 'manual',
          variant: group.emphasis?.variant || stage.effect,
          declaredPeakScale: group.emphasis?.peakScale || 1.18,
          groupBounds: rectangle(group.el),
          styles: {
            transform: style.transform,
            color: style.color,
            background: style.backgroundColor,
            animation: style.animationName,
            decoration: decoration.content,
            border: decoration.borderWidth,
          },
          ...probe,
          pass: !probe.collisions.length && !probe.inkOverlapsReading && !probe.ghostOverlapsReading,
        });
      }
      stage.clearTransientClasses();
      entering.el.classList.add('new');
      stage.current.featuredKeyword = featured;
      stage.pulseKeywords();
      // Leave the simultaneous 1.18 group x 1.20 karaoke peak for the native capture.
      freezeAnimations(stage);
      await new Promise(requestAnimationFrame);
      const peak = glyphCollisions(stage);
      stage.setPaused(true);
      app.dance.setPaused(true);
      const result = {
        id: fixture.id,
        pulseSource: 'test-fixture',
        testOnly: true,
        includesEnteringKeyword: true,
        peakKeywordScale: 1.18,
        peakEntryScale: stage.effect === 'karaoke' ? 1.2 : stage.effect === 'tunnel' ? 1.17 : 1,
        preservedText: stage.current.track.textContent === fixture.text,
        expectedText: fixture.text,
        actualText: stage.current.track.textContent,
        layout: stage.el.dataset.layout,
        effect: stage.effect,
        emphasis: stage.getState().emphasis,
        structuredImport: fixture.structured
          ? {
              parser: 'parseScriptInput',
              sentenceType: stage.getState().scene?.sentenceType,
              directionSource: stage.getState().scene?.directionSource,
              declaredRoles: fixture.keywords.map(({ text, role }) => ({ text, role })),
              metadataPresented:
                stage.el.dataset.layout === fixture.sentenceType &&
                stage.getState().scene?.directionSource === 'explicit' &&
                fixture.keywords.every(({ text, role }) =>
                  stage.getState().emphasis.some((entry) => entry.text === text && entry.role === role),
                ) &&
                new Set(stage.getState().emphasis.map(({ variant }) => variant)).size > 1,
            }
          : null,
        viewport: { width: innerWidth, height: innerHeight },
        bounds: visualBounds(app),
        inkLayout: stage.inkLayout,
        frames,
        emphasisPeaks,
        peak,
      };
      result.pass =
        result.preservedText &&
        (!result.structuredImport || result.structuredImport.metadataPresented) &&
        result.bounds.readingWithinStage &&
        emphasisPeaks.every((probe) => probe.pass) &&
        frames.every(
          (frame) => !frame.collisions.length && !frame.inkOverlapsReading && !frame.ghostOverlapsReading,
        );
      results.push(result);
    }
    return {
      pulseSource: 'test-fixture',
      testOnly: true,
      results,
      pass: results.every((result) => result.pass),
    };
  };
  return true;
}
