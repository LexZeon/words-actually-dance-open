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

function captionFixture(stage) {
  stage.setAutoDirection(false);
  stage.setEffect('stack');
  stage.setRate(2);
  stage.setScript({
    id: 'qa-drum-reading',
    lines: Array.from({ length: 30 }, (_, index) => ({
      text: '重鼓落下，轻鼓点亮，文字跟着声音呼吸。保持阅读，把连续变化连成舒服的动作。',
      keyword: index % 2 ? '轻鼓' : '重鼓',
      holdBeats: 1,
    })),
  });
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
        const track = app.knowledge.drumResponse?.track;
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
            canvasFrames: 0,
            knowledgeFrames: 0,
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
          reading.knowledgeFrames++;
          reading.peakKnowledgeMotion = Math.max(reading.peakKnowledgeMotion, amplitude(knowledge.drum.pose));
          reading.captionStyleMatches &&= Boolean(
            track &&
            Math.abs(parseFloat(track.style.scale.trim().split(/\s+/).at(-1)) - knowledge.drum.pose.scaleY) <
              0.00002 &&
            track.style.filter.includes('brightness('),
          );
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
      for (const [index, effect] of EFFECTS.filter((row) => row.implemented).entries()) {
        stage.setPaused(false);
        stage.setAutoDirection(false);
        stage.setEffect(effect.id);
        stage.setRate(4);
        stage.setScript({
          id: `qa-drum-${effect.id}`,
          lines: [{ text: '重鼓强调重点，轻鼓保持阅读。', keyword: '重点', holdBeats: 32 }],
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
            Number.isFinite(state.pose.y) &&
            Math.abs(state.pose.y) <= state.maxTravelPx + 0.001 &&
            cssScale <= 1 &&
            cssScale >= 0.8 &&
            afterOverflow <= baselineOverflow + 1.2;
          peaks.push({
            kind,
            pass,
            visible,
            target: targetTrack.className,
            pose: state.pose,
            maxTravelPx: state.maxTravelPx,
            baselineOverflow,
            afterOverflow,
          });
        }
        cases.push({ effect: effect.id, pass: peaks.every((row) => row.pass), peaks });
      }
      return {
        pass: cases.every((row) => row.pass),
        testOnly: true,
        source: 'controlled-renderer-fixture',
        audioAccuracyClaim: false,
        checkedEffects: cases.length,
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
