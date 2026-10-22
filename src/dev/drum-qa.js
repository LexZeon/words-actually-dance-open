import { EFFECTS } from '../visuals/effect-catalog.js';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const assert = (condition, message, detail) => {
  if (!condition) throw new Error(`Drum QA: ${message}: ${JSON.stringify(detail)}`);
};
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rectangle = (element) => {
  const box = element?.getBoundingClientRect();
  return box
    ? {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      }
    : null;
};
const overflow = (box, host) =>
  !box || !host
    ? Infinity
    : Math.max(0, host.left - box.left, box.right - host.right, host.top - box.top, box.bottom - host.bottom);
const amplitude = (pose) =>
  Math.max(
    Math.abs(pose?.y || 0),
    Math.abs((pose?.scaleY ?? 1) - 1) * 100,
    Math.abs((pose?.brightness ?? 1) - 1) * 20,
  );

const scalePair = (value) => {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .map(Number);
  return parts.length >= 1 && parts.every(Number.isFinite) ? [parts[0], parts[1] ?? parts[0]] : [NaN, NaN];
};
const close = (actual, expected, tolerance = 0.00002) =>
  Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;
const filterBrightness = (value) => {
  const match = String(value || '').match(/^brightness\(([\d.e+-]+)\)$/u);
  return match ? Number(match[1]) : NaN;
};
const computedFilter = (style, maximumBlur = 0, animationName = '') => {
  const value = String(style.filter || '');
  if (maximumBlur > 0) {
    const composed = value.match(/^blur\(([\d.e+-]+)(?:px)?\) brightness\(([\d.e+-]+)\)$/u);
    if (composed) {
      const blur = Number(composed[1]),
        brightness = Number(composed[2]);
      return {
        blur,
        brightness,
        valid: blur >= 0 && blur <= maximumBlur + 0.00002 && Number.isFinite(brightness),
      };
    }
    // Without the finite entrance animation the inline brightness is the
    // legitimate chain. An active entrance must retain its bounded blur too.
    if (
      String(style.animationName || '')
        .split(/\s*,\s*/u)
        .includes(animationName)
    )
      return { blur: NaN, brightness: NaN, valid: false };
  }
  const brightness = filterBrightness(value);
  return { blur: 0, brightness, valid: Number.isFinite(brightness) };
};

function visibleTextElement(node, host) {
  if (!node?.isConnected || !host?.contains(node) || !String(node.textContent || '').trim()) return false;
  const view = node.ownerDocument?.defaultView;
  if (typeof view?.getComputedStyle !== 'function') return false;
  let opacity = 1,
    reachedHost = false;
  for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
    const style = view.getComputedStyle(ancestor);
    opacity *= Number(style.opacity);
    if (
      style.display === 'none' ||
      ['hidden', 'collapse'].includes(style.visibility) ||
      style.contentVisibility === 'hidden' ||
      !(opacity > 0.001)
    )
      return false;
    if (ancestor === host) {
      reachedHost = true;
      break;
    }
  }
  const box = rectangle(node),
    bounds = rectangle(host);
  return Boolean(
    reachedHost &&
    box?.width > 0 &&
    box?.height > 0 &&
    bounds &&
    box.right > bounds.left &&
    box.left < bounds.right &&
    box.bottom > bounds.top &&
    box.top < bounds.bottom,
  );
}

function visibleGlyphCount(node, host) {
  const glyphs = [...node.querySelectorAll('.char')];
  return glyphs.length
    ? glyphs.filter((glyph) => glyph.classList.contains('read') && visibleTextElement(glyph, host)).length
    : Number(visibleTextElement(node, host));
}

/** Inspect actual post-frame CSS and visible text, not just the model pose.
 * A local tick can leave all track properties neutral while scaling a keyword.
 * Conversely, a hidden, detached or stale keyword never counts as visible work.
 */
export function measureKnowledgeDrumPresentation(
  stage,
  state = stage.getState().drum,
  eventKind = state?.pose?.kind,
) {
  const response = stage.drumResponse,
    track = response?.track,
    pose = state?.pose,
    host = stage.el,
    current = stage.current,
    view = host?.ownerDocument?.defaultView;
  if (!track || !pose || typeof view?.getComputedStyle !== 'function')
    return { stylesMatch: false, trackVisible: false, focusVisible: false, visibleMotion: 0, eventMotion: 0 };
  const computed = view.getComputedStyle(track),
    inlineScale = scalePair(track.style.scale),
    computedScale = scalePair(computed.scale);
  const spotlight = track === current?.spotlight,
    focusScale = state.presentation?.focusScale ?? pose.focusScale,
    expectedTrackScale = spotlight ? [focusScale, pose.scaleY * focusScale] : [1, pose.scaleY];
  const flash = spotlight && stage.effect === 'flash',
    zoom = !spotlight && host.dataset?.presentation === 'scene' && host.dataset?.entrance === 'zoom';
  const filter = computedFilter(computed, flash ? 2 : zoom ? 3 : 0, flash ? 'spotlight-flash' : 'scene-zoom');
  const translateY = (value) =>
    parseFloat(
      String(value || '')
        .trim()
        .split(/\s+/)
        .at(-1),
    );
  const trackStylesMatch =
    focusScale >= 1 &&
    focusScale <= pose.focusScale + 0.00002 &&
    close(inlineScale[0], expectedTrackScale[0]) &&
    close(inlineScale[1], expectedTrackScale[1]) &&
    close(computedScale[0], expectedTrackScale[0]) &&
    close(computedScale[1], expectedTrackScale[1]) &&
    close(translateY(track.style.translate), pose.y, 0.0002) &&
    close(translateY(computed.translate), pose.y, 0.0002) &&
    close(filterBrightness(track.style.filter), pose.brightness) &&
    filter.valid &&
    close(filter.brightness, pose.brightness);
  const trackVisible = visibleGlyphCount(track, host) > 0;
  const expectedFocus = spotlight
    ? [current.spotlight]
    : current?.featuredMarker?.els || (current?.featuredKeyword ? [current.featuredKeyword] : []);
  const focus = (response.focus || []).map(({ node }) => {
    const visibleGlyphs = visibleGlyphCount(node, host);
    const validTarget = Boolean(current?.el?.contains(node) && expectedFocus.includes(node));
    const inline = scalePair(node.style.scale),
      actual = scalePair(view.getComputedStyle(node).scale);
    const expected = node === track && spotlight ? expectedTrackScale : [focusScale, focusScale];
    const stylesMatch =
      validTarget &&
      inline.every((value, index) => close(value, expected[index])) &&
      actual.every((value, index) => close(value, expected[index]));
    return { stylesMatch, visible: validTarget && visibleGlyphs > 0, scale: actual[0], visibleGlyphs };
  });
  const focusStylesMatch = focus.every((node) => node.stylesMatch),
    focusVisible = focus.some((node) => node.stylesMatch && node.visible),
    trackMotion = trackStylesMatch && trackVisible ? amplitude(pose) : 0,
    focusMotion = Math.max(
      0,
      ...focus
        .filter((node) => node.stylesMatch && node.visible)
        .map((node) => Math.abs(node.scale - 1) * 100),
    );
  return {
    stylesMatch: trackStylesMatch && focusStylesMatch,
    trackStylesMatch,
    trackVisible,
    focusStylesMatch,
    focusVisible,
    focusNodes: focus.length,
    visibleFocusGlyphs: focus.reduce((sum, node) => sum + node.visibleGlyphs, 0),
    trackMotion,
    focusMotion,
    visibleMotion: Math.max(trackMotion, focusMotion),
    eventMotion: eventKind === 'tick' ? focusMotion : Math.max(trackMotion, focusMotion),
    trackStyles: {
      inline: { scale: track.style.scale, translate: track.style.translate, filter: track.style.filter },
      computed: {
        scale: computed.scale,
        translate: computed.translate,
        filter: computed.filter,
        animationName: computed.animationName,
      },
      expectedScale: expectedTrackScale,
      expectedTranslateY: pose.y,
      expectedBrightness: pose.brightness,
      parsedComputedFilter: filter,
    },
  };
}
const canvasAmplitude = (accent) => {
  const poses = accent?.pose ? [accent.pose.group, ...accent.pose.glyphs] : [];
  return Math.max(
    0,
    ...poses.flatMap((pose) => [
      Math.abs(pose.x),
      Math.abs(pose.y),
      Math.abs(pose.rotation),
      Math.abs(pose.scaleX - 1),
      Math.abs(pose.scaleY - 1),
    ]),
  );
};

export function drumCaptionScript() {
  // This positive audio test measures existing visible targets. At the hard
  // reading cap even 15s cannot reach a new line with an unread keyword. Sentence
  // progression and unread-target negatives have their own independent tests.
  const text =
    '重鼓落下，轻鼓点亮，文字跟着声音呼吸。' +
    '保持阅读，把连续变化连成舒服的动作。观察声音轻重，比较重点文字的缩放与回落。'.repeat(3);
  return {
    id: 'qa-drum-reading',
    lines: Array.from({ length: 30 }, () => ({ text, keyword: '重鼓', holdBeats: 1 })),
  };
}

function captionFixture(stage) {
  stage.setAutoDirection(false);
  stage.setEffect('stack');
  stage.setRate(2);
  stage.setScript(drumCaptionScript());
}

/** Native test-only hook. Audio receives bytes; no reference hits or BPM labels. */
export function installDrumQA(app) {
  const target = app.window || globalThis.window;
  if (!target?.desktop?.testMode) return false;
  let installed = true,
    running = false;

  async function actualAudio(fixtures) {
    assert(installed && !app.destroyed && !running, 'application/fixture unavailable');
    assert(Array.isArray(fixtures) && fixtures.length === 4, 'four bounded audio fixtures required');
    running = true;
    target.__wadDrumNativeEvidence = null;
    const saved = {
      onFrame: app.playback.onFrame,
      onNextTrack: app.audio.onNextTrack,
      onLine: app.knowledge.onLine,
      onKeyword: app.knowledge.onKeyword,
      onComplete: app.knowledge.onComplete,
      rate: app.knowledge.rate,
    };
    const results = [];
    let capture = null,
      pauseStable = false,
      lastTrack = -1,
      recorder;
    try {
      app.setPlaying(false);
      await app.audio.setPaused(true);
      app.pendingTopic = null;
      app.audio.onNextTrack = () => false;
      app.knowledge.onLine = app.knowledge.onComplete = () => {};
      app.knowledge.onKeyword = (word, relation, duration) =>
        app.dance.setWord(word, relation, { beatDuration: duration });
      recorder = (frame) => {
        saved.onFrame(frame);
        if (!capture || !frame.playing) return;
        const musicTime = app.audio.context.currentTime - app.audio.startedAt;
        const motion = app.dance.getMotionState(),
          knowledge = app.knowledge.getState();
        const drum = frame.rendering.drum;
        capture.frameCount++;
        if (!frame.measured.silent) capture.voicedFrames++;
        if (capture.sampleCount < 150 && musicTime - capture.lastSampleTime >= 0.08) {
          capture.sampleCount++;
          capture.lastSampleTime = musicTime;
          capture.samples.push({
            musicTime,
            bpm: frame.grid.bpm,
            drive: frame.rendering.delivery?.drive || 0,
            density: frame.rendering.delivery?.density || 0,
            effectiveCharsPerBeat: knowledge.effectiveCharsPerBeat,
            cursor: knowledge.cursor,
            lineIndex: knowledge.lineIndex,
          });
        }
        if (drum?.hit && capture.events.size < 240)
          capture.events.set(drum.sequence, {
            sequence: drum.sequence,
            time: musicTime,
            weight: drum.weight,
            kind: drum.kind,
            confidence: drum.confidence,
            peakCanvasAccent: 0,
            peakKnowledgeMotion: 0,
            peakKnowledgeTrackMotion: 0,
            peakKnowledgeFocusMotion: 0,
            canvasFrames: 0,
            knowledgeFrames: 0,
            knowledgeActiveFrames: 0,
            visibleFocusFrames: 0,
            finiteCanvas: true,
            captionStyleMatches: true,
            canvasWithinBounds: true,
          });
        else if (drum?.hit) capture.eventOverflow = true;
        const row = capture.events.get(motion.accent?.sequence);
        if (row && motion.accent?.source === 'drum' && motion.accent.active) {
          row.peakCanvasAccent = Math.max(row.peakCanvasAccent, canvasAmplitude(motion.accent));
          row.canvasFrames++;
          row.finiteCanvas &&= Boolean(
            motion.poses &&
            [motion.poses.group, ...motion.poses.glyphs].every((pose) =>
              Object.values(pose).every(Number.isFinite),
            ),
          );
          const { bounds, canvas } = motion.constraints || {};
          row.canvasWithinBounds &&= Boolean(
            bounds &&
            canvas &&
            bounds.left >= -1 &&
            bounds.top >= -1 &&
            bounds.right <= canvas.width + 1 &&
            bounds.bottom <= canvas.height + 1,
          );
        }
        const reading = capture.events.get(knowledge.drum?.sequence);
        if (reading && knowledge.drum.active) {
          const presentation = measureKnowledgeDrumPresentation(app.knowledge, knowledge.drum, reading.kind);
          reading.knowledgeActiveFrames++;
          if (presentation.eventMotion > 0) reading.knowledgeFrames++;
          if (presentation.focusVisible && presentation.focusMotion > 0) reading.visibleFocusFrames++;
          reading.peakKnowledgeMotion = Math.max(reading.peakKnowledgeMotion, presentation.eventMotion);
          reading.peakKnowledgeTrackMotion = Math.max(
            reading.peakKnowledgeTrackMotion,
            presentation.trackMotion,
          );
          reading.peakKnowledgeFocusMotion = Math.max(
            reading.peakKnowledgeFocusMotion,
            presentation.focusMotion,
          );
          reading.captionStyleMatches &&= presentation.stylesMatch;
          if (!presentation.stylesMatch && !reading.firstStyleMismatch)
            reading.firstStyleMismatch = presentation.trackStyles;
          if (!(presentation.eventMotion > 0) && !reading.firstInvisibleKnowledge)
            reading.firstInvisibleKnowledge = {
              time: musicTime,
              lineIndex: knowledge.lineIndex,
              cursor: knowledge.cursor,
              kind: reading.kind,
              focusNodes: presentation.focusNodes,
              focusVisible: presentation.focusVisible,
              trackVisible: presentation.trackVisible,
              stylesMatch: presentation.stylesMatch,
            };
        }
      };
      app.playback.onFrame = recorder;

      for (let index = 0; index < 3; index++) {
        const fixture = fixtures[index];
        assert(
          typeof fixture.base64 === 'string' &&
            fixture.base64.length < 3000000 &&
            fixture.seconds >= 1 &&
            fixture.seconds <= 15,
          'invalid PCM fixture',
          { name: fixture.name, seconds: fixture.seconds },
        );
        const bytes = Uint8Array.from(atob(fixture.base64), (char) => char.charCodeAt(0));
        const track = await app.audio.addTrack(fixture.name, bytes);
        lastTrack = track;
        captionFixture(app.knowledge);
        app.dance.setWord('鼓点', {}, { immediate: true });
        capture = {
          name: fixture.name,
          frameCount: 0,
          voicedFrames: 0,
          sampleCount: 0,
          lastSampleTime: -Infinity,
          eventOverflow: false,
          samples: [],
          events: new Map(),
        };
        await app.changeSource(() => app.audio.playTrack(track));
        const deadline = performance.now() + (fixture.seconds + 4) * 1000;
        let paused = false;
        while (app.audio.context.currentTime - app.audio.startedAt < fixture.seconds - 0.12) {
          assert(
            installed && !app.destroyed && performance.now() < deadline,
            'actual file playback timed out',
            fixture.name,
          );
          if (index === 0 && !paused && capture.events.size >= 4 && app.knowledge.getState().drum.active) {
            app.setPlaying(false);
            await app.audio.setPaused(true);
            await wait(35);
            const before = {
              dance: app.dance.getMotionState().poses,
              knowledge: app.knowledge.getState().drum.pose,
            };
            await wait(120);
            const after = {
              dance: app.dance.getMotionState().poses,
              knowledge: app.knowledge.getState().drum.pose,
            };
            pauseStable = same(before, after);
            await app.audio.setPaused(false);
            app.setPlaying(true);
            paused = true;
          }
          await new Promise((resolve) => target.requestAnimationFrame(resolve));
        }
        const events = [...capture.events.values()];
        const bothStages = events.filter(
          (row) =>
            row.canvasFrames > 0 &&
            row.knowledgeFrames > 0 &&
            row.peakCanvasAccent > 0 &&
            row.peakKnowledgeMotion > 0,
        );
        assert(
          !capture.eventOverflow &&
            capture.voicedFrames > 10 &&
            events.length > 5 &&
            bothStages.length >= events.length * 0.85,
          'actual audio must visibly reach both renderers',
          { frames: capture.frameCount, events: events.length, both: bothStages.length },
        );
        assert(
          events.every((row) => row.finiteCanvas && row.canvasWithinBounds && row.captionStyleMatches),
          'post-draw poses/styles must be finite and bounded',
          events.filter((row) => !row.finiteCanvas || !row.canvasWithinBounds || !row.captionStyleMatches),
        );
        results.push({
          name: fixture.name,
          frameCount: capture.frameCount,
          voicedFrames: capture.voicedFrames,
          events,
          samples: capture.samples,
          bothStages: bothStages.length,
        });
        capture = null;
        app.setPlaying(false);
        await app.audio.setPaused(true);
      }

      // Commit a quiet source through the real source transaction. Old drum
      // commands must be removed, without turning a new internal tick into one.
      const quiet = Uint8Array.from(atob(fixtures[3].base64), (char) => char.charCodeAt(0));
      const quietTrack = await app.audio.addTrack(fixtures[3].name, quiet);
      await app.changeSource(() => app.audio.playTrack(lastTrack));
      const guardDeadline = performance.now() + 2500;
      while (!app.dance.getMotionState().accent.active || !app.knowledge.getState().drum.active) {
        assert(performance.now() < guardDeadline, 'source guard requires a genuinely active old drum');
        await new Promise((resolve) => target.requestAnimationFrame(resolve));
      }
      const beforeGeneration = app.audio.committedSourceGeneration;
      await app.changeSource(() => app.audio.playTrack(quietTrack));
      await wait(180);
      const sourceGuard =
        app.audio.committedSourceGeneration > beforeGeneration &&
        !app.dance.getMotionState().accent.active &&
        !app.knowledge.getState().drum.active;
      const delivery = results.find((row) => row.name === 'same-bpm-delivery');
      const early = delivery.samples.filter((row) => row.musicTime > 1.6 && row.musicTime < 4.2);
      const later = delivery.samples.filter((row) => row.musicTime > 6.2 && row.musicTime < 8.8);
      const deliveryEvidence = {
        earlyDrive: mean(early.map((row) => row.drive)),
        laterDrive: mean(later.map((row) => row.drive)),
        earlyRate: mean(early.map((row) => row.effectiveCharsPerBeat)),
        laterRate: mean(later.map((row) => row.effectiveCharsPerBeat)),
        earlyBpm: mean(early.map((row) => row.bpm)),
        laterBpm: mean(later.map((row) => row.bpm)),
      };
      deliveryEvidence.pass =
        early.length > 5 &&
        later.length > 5 &&
        deliveryEvidence.laterDrive > deliveryEvidence.earlyDrive + 0.15 &&
        deliveryEvidence.laterRate > deliveryEvidence.earlyRate + 0.25 &&
        Math.abs(deliveryEvidence.earlyBpm - deliveryEvidence.laterBpm) < deliveryEvidence.earlyBpm * 0.15;
      return {
        pass: pauseStable && sourceGuard && deliveryEvidence.pass,
        actualWebAudio: true,
        inputSource: 'actual-WebAudio-file',
        syntheticAudio: true,
        referenceLabelsFedToDetector: false,
        pauseStable,
        sourceGuard,
        deliveryEvidence,
        files: results,
      };
    } finally {
      target.__wadDrumNativeEvidence = {
        files: results,
        partial: capture
          ? {
              name: capture.name,
              frameCount: capture.frameCount,
              voicedFrames: capture.voicedFrames,
              events: [...capture.events.values()],
              samples: capture.samples,
            }
          : null,
      };
      capture = null;
      app.setPlaying(false);
      await app.audio.setPaused(true);
      if (!app.audio.destroyed) app.audio.onNextTrack = saved.onNextTrack;
      if (!app.playback.destroyed && app.playback.onFrame === recorder) app.playback.onFrame = saved.onFrame;
      if (!app.destroyed) {
        app.knowledge.onLine = saved.onLine;
        app.knowledge.onKeyword = saved.onKeyword;
        app.knowledge.onComplete = saved.onComplete;
        app.knowledge.setRate(saved.rate);
      }
      running = false;
    }
  }

  async function readability() {
    assert(installed && !app.destroyed && !running, 'application/fixture unavailable');
    running = true;
    const playback = app.playback,
      stage = app.knowledge;
    const wasStarted = playback.started;
    const saved = {
      onLine: stage.onLine,
      onKeyword: stage.onKeyword,
      onComplete: stage.onComplete,
      rate: stage.rate,
    };
    playback.started = false;
    if (playback.raf !== null) target.cancelAnimationFrame(playback.raf);
    playback.raf = null;
    const cases = [];
    try {
      app.setPlaying(false);
      await app.audio.setPaused(true);
      stage.onLine = stage.onKeyword = stage.onComplete = () => {};
      const start = performance.now() / 1000 + 2;
      let sequence = 200000;
      const modes = [...EFFECTS.filter((row) => row.implemented), { id: 'scene-zoom', automatic: true }];
      for (const [index, effect] of modes.entries()) {
        stage.setPaused(false);
        stage.setAutoDirection(Boolean(effect.automatic));
        stage.setEffect(effect.automatic ? 'tunnel' : effect.id);
        stage.setRate(4);
        stage.setScript({
          id: `qa-drum-${effect.id}`,
          lines: [
            effect.automatic
              ? {
                  text: 'Focus makes a clear beginning.',
                  keyword: 'Focus',
                  sentenceType: 'opening',
                  holdBeats: 32,
                }
              : { text: '重鼓强调重点，轻鼓保持阅读。', keyword: '重点', holdBeats: 32 },
          ],
        });
        const time = start + index * 2;
        const features = {
          time,
          sourceGeneration: -8,
          bpm: 120,
          silent: 0,
          audioSilent: 0,
          signalValid: 1,
          drum: { hit: false, sequence, weight: 0 },
          delivery: { drive: 0, readingMultiplier: 1 },
        };
        stage.setFeatures(features);
        let beatIndex = index * 1000 + 40000;
        for (let beat = 0; beat < 20 && stage.cursor < (stage.current?.chars.length ?? Infinity); beat++) {
          for (let sub = 0; sub < 4; sub++)
            stage.onTick(
              {
                kind: sub ? 'subdivision' : 'beat',
                beatIndex: beatIndex + beat,
                subdivisionIndex: sub,
                bpm: 120,
                time,
                testOnly: true,
                source: 'test-fixture',
              },
              features,
            );
        }
        await wait(100);
        stage.frame({ beatIndex, phase: 0.5, time });
        if (effect.automatic)
          assert(
            stage.el.dataset.presentation === 'scene' && stage.el.dataset.entrance === 'zoom',
            'automatic zoom fixture must use the real directed entrance',
            { presentation: stage.el.dataset.presentation, entrance: stage.el.dataset.entrance },
          );
        const before = rectangle(stage.drumResponse.track),
          host = rectangle(stage.el);
        const baselineOverflow = overflow(before, host);
        const peaks = [];
        for (const kind of ['thump', 'snap', 'tick']) {
          const eventTime = time + peaks.length * 0.3;
          stage.setFeatures({
            ...features,
            time: eventTime,
            drum: { hit: true, sequence: ++sequence, kind, weight: 1, confidence: 1, strength: 1 },
          });
          stage.frame({ beatIndex, phase: 0.5, time: eventTime + 0.024 });
          const state = stage.getState().drum,
            targetTrack = stage.drumResponse.track,
            box = rectangle(targetTrack);
          const presentation = measureKnowledgeDrumPresentation(stage, state);
          const afterOverflow = overflow(box, host);
          const cssScale = parseFloat(targetTrack.style.scale.trim().split(/\s+/).at(-1));
          const computed = stage.document.defaultView.getComputedStyle(targetTrack);
          const visible =
            box?.width > 0 &&
            box?.height > 0 &&
            computed.display !== 'none' &&
            computed.visibility !== 'hidden' &&
            Number(computed.opacity) > 0.001;
          const pass =
            visible &&
            presentation.stylesMatch &&
            Number.isFinite(state.pose.y) &&
            Math.abs(state.pose.y) <= state.maxTravelPx + 0.001 &&
            state.pose.scaleY <= 1 &&
            state.pose.scaleY >= 0.8 &&
            cssScale <= state.pose.focusScale + 0.00002 &&
            cssScale >= 0.8 &&
            (kind !== 'tick' || (presentation.focusVisible && presentation.focusMotion > 0)) &&
            afterOverflow <= baselineOverflow + 1.2;
          peaks.push({
            kind,
            pass,
            visible,
            target: targetTrack.className,
            pose: state.pose,
            presentation,
            maxTravelPx: state.maxTravelPx,
            baselineOverflow,
            afterOverflow,
          });
        }
        cases.push({
          effect: effect.id,
          automatic: Boolean(effect.automatic),
          pass: peaks.every((row) => row.pass),
          peaks,
        });
      }
      return {
        pass: cases.every((row) => row.pass),
        testOnly: true,
        source: 'controlled-renderer-fixture',
        audioAccuracyClaim: false,
        checkedEffects: cases.filter((row) => !row.automatic).length,
        checkedAutomaticEntrances: cases.filter((row) => row.automatic).length,
        stage: rectangle(stage.el),
        cases,
      };
    } finally {
      stage.setPaused(true);
      if (!app.destroyed) {
        stage.onLine = saved.onLine;
        stage.onKeyword = saved.onKeyword;
        stage.onComplete = saved.onComplete;
        stage.setRate(saved.rate);
        if (wasStarted && !playback.destroyed) {
          playback.started = true;
          playback.scheduleFrame();
        }
      }
      running = false;
    }
  }

  target.__wadDrumSmokeTest = actualAudio;
  target.__wadDrumReadabilityTest = readability;
  const dispose = () => {
    installed = false;
    if (target.__wadDrumSmokeTest === actualAudio) delete target.__wadDrumSmokeTest;
    if (target.__wadDrumReadabilityTest === readability) delete target.__wadDrumReadabilityTest;
    delete target.__wadDrumNativeEvidence;
    target.removeEventListener?.('beforeunload', dispose);
  };
  target.addEventListener?.('beforeunload', dispose, { once: true });
  return dispose;
}
