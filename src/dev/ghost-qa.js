import { GHOST_EFFECTS } from '../core/ghost-effects.js';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const assert = (condition, message) => {
  if (!condition) throw new Error(`Ghost QA: ${message}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const finitePose = (layer) =>
  Boolean(
    layer && [layer.group, ...layer.glyphs].every((part) => Object.values(part).every(Number.isFinite)),
  );
const distance = (a, b) => {
  const keys = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];
  const part = (left, right) => keys.reduce((sum, key) => sum + Math.abs(left[key] - right[key]), 0);
  return (
    part(a.group, b.group) +
    a.glyphs.reduce((sum, glyph, index) => sum + part(glyph, b.glyphs[index]), 0) /
      Math.max(1, a.glyphs.length)
  );
};

/** Validates actual post-draw layers and intercepted real Canvas paints. */
export function validateGhostFrame({ state, elapsed, width, height, paints }) {
  const white = (paint) => /^(?:#fff(?:fff)?|rgb\(255,\s*255,\s*255\))$/i.test(paint.color);
  const mainPaints = paints.filter((paint) => white(paint) && paint.alpha >= 0.99).length;
  const ghostPaints = paints.filter((paint) => white(paint) && paint.alpha > 0 && paint.alpha < 0.4).length;
  const bounds = state.combinedBounds;
  const bounded = Boolean(
    bounds &&
    bounds.left >= -1 &&
    bounds.top >= -1 &&
    bounds.right <= width + 1 &&
    bounds.bottom <= height + 1,
  );
  const visible = Boolean(state.active && state.layers.main && state.layers.ghost);
  return {
    visible,
    mainPaints,
    ghostPaints,
    bounded,
    finite: finitePose(state.layers.main) && (!visible || finitePose(state.layers.ghost)),
    sameAnchor:
      Math.abs(state.anchor.x - width / 2) < 0.00001 && Math.abs(state.anchor.y - height * 0.45) < 0.00001,
    boundedHistory: state.historySamples <= state.maxHistorySamples && state.maxHistorySamples <= 128,
    correctOpacity:
      visible &&
      state.layers.main.opacity === 1 &&
      state.layers.ghost.opacity > 0 &&
      state.layers.ghost.opacity < 0.4,
    delayed:
      visible &&
      state.delaySeconds >= 0.08 &&
      state.delaySeconds <= 0.25 &&
      state.sourceTime < elapsed &&
      Math.abs(elapsed - state.sourceTime - state.delaySeconds) < 0.05,
    poseDifference: visible ? distance(state.layers.main, state.layers.ghost) : 0,
  };
}

export function installGhostQA(app) {
  const target = app.window || globalThis.window;
  if (!target?.desktop?.testMode) return false;
  let installed = true,
    running = false;
  async function actualAudio(fixture, toneFixtures = []) {
    assert(installed && !app.destroyed && !running, 'application unavailable');
    assert(
      typeof fixture?.base64 === 'string' &&
        fixture.base64.length < 3000000 &&
        fixture.seconds >= 5 &&
        fixture.seconds <= 15,
      'bounded PCM payload required',
    );
    const stage = app.dance,
      context = stage.ctx;
    assert(typeof stage.getGhostState === 'function', 'actual ghost renderer unavailable');
    running = true;
    const saved = {
      onFrame: app.playback.onFrame,
      onNextTrack: app.audio.onNextTrack,
      onKeyword: app.knowledge.onKeyword,
      onComplete: app.knowledge.onComplete,
      effect: stage.getGhostState().mode,
      emoji: stage.emoji,
      reduced: stage.reducedMotion,
      fillText: context.fillText,
    };
    const cases = [],
      toneCases = [];
    let row = null,
      paints = [],
      pcmHistory = [],
      lastToneSequence = null,
      lastDrumSequence = null,
      recorder,
      sourceWatch = null;
    const lifecycle = {};
    try {
      app.setPlaying(false);
      await app.audio.setPaused(true);
      app.pendingTopic = null;
      app.audio.onNextTrack = () => false;
      app.knowledge.onKeyword = app.knowledge.onComplete = () => {};
      stage.setEmoji(false);
      stage.setWord('虚影', {}, { immediate: true });
      context.fillText = function (...args) {
        if (paints.length < 64) paints.push({ alpha: this.globalAlpha, color: String(this.fillStyle) });
        return saved.fillText.apply(this, args);
      };
      recorder = (frame) => {
        saved.onFrame(frame);
        const state = stage.getGhostState();
        if (sourceWatch && !sourceWatch.seen && state.sourceGeneration !== sourceWatch.oldGeneration) {
          sourceWatch.seen = true;
          sourceWatch.pass = state.historySamples <= 2 && !state.active && !state.layers.ghost;
        }
        if (row && frame.playing) {
          row.frames++;
          if (!frame.measured.silent) row.voicedFrames++;
          if (frame.rendering.drum?.hit) row.actualDrumHits++;
          const tone = frame.measured.toneStyle;
          const drum = frame.measured.drum;
          const freshTone =
            Number.isSafeInteger(tone?.sequence) &&
            (lastToneSequence === null || tone.sequence > lastToneSequence);
          const freshDrum =
            Number.isSafeInteger(drum?.sequence) &&
            (lastDrumSequence === null || drum.sequence > lastDrumSequence);
          if (freshTone) lastToneSequence = tone.sequence;
          if (freshDrum) lastDrumSequence = drum.sequence;
          const wave = app.audio.wave;
          const pcmRms = wave?.length
            ? Math.sqrt(wave.reduce((sum, value) => sum + value * value, 0) / wave.length)
            : Infinity;
          const quiet = pcmRms < 0.000001;
          pcmHistory.push({ time: stage.elapsed, voiced: !quiet });
          while (pcmHistory.length > 160 || pcmHistory[0]?.time < stage.elapsed - 1) pcmHistory.shift();
          if (quiet) {
            row.quietFrames = (row.quietFrames || 0) + 1;
            row.quietNewToneHits = (row.quietNewToneHits || 0) + Number(Boolean(freshTone && tone?.hit));
            row.quietNewDrumHits = (row.quietNewDrumHits || 0) + Number(Boolean(freshDrum && drum?.hit));
          }
          if (tone?.valid) {
            row.toneValidFrames = (row.toneValidFrames || 0) + 1;
            row.toneKinds ??= {};
            row.toneKinds[tone.kind] = (row.toneKinds[tone.kind] || 0) + 1;
          }
          const checked = validateGhostFrame({
            state,
            paints,
            elapsed: stage.elapsed,
            width: stage.width,
            height: stage.height,
          });
          row.finite &&= checked.finite;
          row.withinBounds &&= checked.bounded;
          row.sameAnchor &&= checked.sameAnchor;
          row.boundedHistory &&= checked.boundedHistory;
          if (checked.visible) {
            row.monotonicSourceTime &&=
              row.lastGhostSourceTime == null || state.sourceTime >= row.lastGhostSourceTime - 0.000001;
            row.lastGhostSourceTime = state.sourceTime;
            row.chosenEffects ??= {};
            row.chosenEffects[state.effect] = (row.chosenEffects[state.effect] || 0) + 1;
            row.visibleFrames++;
            row.opacityValid &&= checked.correctOpacity;
            row.delayValid &&= checked.delayed;
            if (checked.mainPaints > 0 && checked.ghostPaints > 0) row.actualLayerPaintFrames++;
            if (quiet && checked.mainPaints > 0 && checked.ghostPaints > 0) {
              row.quietLayerPaintFrames = (row.quietLayerPaintFrames || 0) + 1;
              if (
                pcmHistory.some((sample) => sample.voiced && Math.abs(sample.time - state.sourceTime) < 0.025)
              ) {
                row.quietVoicedTailFrames = (row.quietVoicedTailFrames || 0) + 1;
                if (!row.quietImage) {
                  row.quietImage = stage.canvas.toDataURL('image/png').split(',')[1];
                  row.quietImageFrame = {
                    pcmRms,
                    elapsed: stage.elapsed,
                    sourceTime: state.sourceTime,
                    delaySeconds: state.delaySeconds,
                  };
                }
              }
            }
            row.maximumPoseDifference = Math.max(row.maximumPoseDifference, checked.poseDifference);
            row.maximumHistorySamples = Math.max(row.maximumHistorySamples, state.historySamples);
            row.delaySeconds = state.delaySeconds;
            row.minimumDelaySeconds = Math.min(row.minimumDelaySeconds ?? Infinity, state.delaySeconds);
            row.maximumDelaySeconds = Math.max(row.maximumDelaySeconds ?? 0, state.delaySeconds);
            row.opacity = state.layers.ghost.opacity;
            const accent = stage.getMotionState().accent;
            if (
              !row.image &&
              ((accent.active && accent.weight > 0.65) || (row.effect === 'auto' && tone?.valid)) &&
              checked.poseDifference > 0.015
            )
              row.image = stage.canvas.toDataURL('image/png').split(',')[1];
          }
        }
        paints = [];
      };
      app.playback.onFrame = recorder;
      const bytes = Uint8Array.from(atob(fixture.base64), (character) => character.charCodeAt(0));
      const track = await app.audio.addTrack('ghost-actual-PCM', bytes);
      for (const effect of GHOST_EFFECTS) {
        pcmHistory = [];
        lastToneSequence = lastDrumSequence = null;
        stage.setGhostEffect(effect.id);
        row = {
          effect: effect.id,
          frames: 0,
          voicedFrames: 0,
          actualDrumHits: 0,
          visibleFrames: 0,
          actualLayerPaintFrames: 0,
          maximumPoseDifference: 0,
          maximumHistorySamples: 0,
          finite: true,
          withinBounds: true,
          sameAnchor: true,
          boundedHistory: true,
          opacityValid: true,
          delayValid: true,
          monotonicSourceTime: true,
          image: null,
        };
        await app.changeSource(() => app.audio.playTrack(track));
        const deadline = performance.now() + 6500;
        while (app.audio.context.currentTime - app.audio.startedAt < 4.3) {
          assert(installed && !app.destroyed && performance.now() < deadline, 'actual playback timed out');
          await new Promise((resolve) => target.requestAnimationFrame(resolve));
        }
        cases.push(row);
        row = null;
        app.setPlaying(false);
        await app.audio.setPaused(true);
      }
      await wait(35);
      const paused = stage.getGhostState();
      await wait(120);
      const held = stage.getGhostState();
      lifecycle.pauseStable =
        same(paused.layers, held.layers) &&
        paused.sourceTime === held.sourceTime &&
        paused.historySamples === held.historySamples;
      await app.audio.setPaused(false);
      app.setPlaying(true);
      await wait(300);
      const resumed = stage.getGhostState();
      lifecycle.resumeRetainsDelay =
        resumed.active &&
        resumed.sourceTime > held.sourceTime &&
        resumed.delaySeconds >= 0.08 &&
        resumed.delaySeconds <= 0.16 &&
        Math.abs(stage.elapsed - resumed.sourceTime - resumed.delaySeconds) < 0.05;
      app.setPlaying(false);
      await app.audio.setPaused(true);
      stage.setWord('换词', {}, { immediate: true });
      lifecycle.wordClearsHistory =
        stage.getGhostState().historySamples <= 1 && !stage.getGhostState().active;
      stage.resize();
      lifecycle.resizeClearsHistory =
        stage.getGhostState().historySamples <= 1 && !stage.getGhostState().active;
      stage.setGhostEffect('off');
      lifecycle.offRemovesLayer = !stage.getGhostState().active && !stage.getGhostState().layers.ghost;
      stage.setGhostEffect('scale-echo');
      await app.changeSource(() => app.audio.playTrack(track));
      await wait(600);
      stage.reducedMotion = true;
      stage.draw();
      lifecycle.reducedRemovesGhost =
        stage.getGhostState().reducedMotion &&
        !stage.getGhostState().active &&
        !stage.getGhostState().layers.ghost;
      stage.reducedMotion = saved.reduced;
      stage.draw();
      sourceWatch = { oldGeneration: stage.getGhostState().sourceGeneration, seen: false, pass: false };
      await app.changeSource(() => app.audio.playTrack(track));
      await new Promise((resolve) =>
        target.requestAnimationFrame(() => target.requestAnimationFrame(resolve)),
      );
      lifecycle.sourceClearsHistory = sourceWatch.seen && sourceWatch.pass;
      sourceWatch = null;
      for (const toneFixture of toneFixtures) {
        pcmHistory = [];
        lastToneSequence = lastDrumSequence = null;
        assert(
          typeof toneFixture.base64 === 'string' &&
            toneFixture.base64.length < 3000000 &&
            toneFixture.seconds >= 4 &&
            toneFixture.seconds <= 10,
          'invalid tone PCM payload',
        );
        stage.setWord('音色', {}, { immediate: true });
        stage.setGhostEffect('auto');
        const toneBytes = Uint8Array.from(atob(toneFixture.base64), (character) => character.charCodeAt(0));
        const toneTrack = await app.audio.addTrack(toneFixture.name, toneBytes);
        row = {
          name: toneFixture.name,
          effect: 'auto',
          frames: 0,
          voicedFrames: 0,
          actualDrumHits: 0,
          visibleFrames: 0,
          actualLayerPaintFrames: 0,
          maximumPoseDifference: 0,
          maximumHistorySamples: 0,
          finite: true,
          withinBounds: true,
          sameAnchor: true,
          boundedHistory: true,
          opacityValid: true,
          delayValid: true,
          monotonicSourceTime: true,
          image: null,
        };
        await app.changeSource(() => app.audio.playTrack(toneTrack));
        const deadline = performance.now() + 6500;
        while (app.audio.context.currentTime - app.audio.startedAt < 3.8) {
          assert(installed && !app.destroyed && performance.now() < deadline, 'tone playback timed out');
          await new Promise((resolve) => target.requestAnimationFrame(resolve));
        }
        toneCases.push(row);
        row = null;
        app.setPlaying(false);
        await app.audio.setPaused(true);
      }
      return {
        pass:
          cases.every(
            (item) =>
              item.voicedFrames > 10 &&
              item.actualDrumHits >= 4 &&
              item.visibleFrames > 10 &&
              item.actualLayerPaintFrames > 10 &&
              item.maximumPoseDifference > 0.005 &&
              item.finite &&
              item.withinBounds &&
              item.sameAnchor &&
              item.boundedHistory &&
              item.opacityValid &&
              item.delayValid &&
              item.monotonicSourceTime &&
              item.image,
          ) && Object.values(lifecycle).every(Boolean),
        actualWebAudio: true,
        actualCanvasPaint: true,
        syntheticAudio: true,
        labelsFedToDetector: false,
        cases,
        toneCases,
        lifecycle,
      };
    } finally {
      target.__wadGhostNativeEvidence = { cases, toneCases, lifecycle, partial: row };
      app.setPlaying(false);
      await app.audio.setPaused(true);
      context.fillText = saved.fillText;
      if (!app.playback.destroyed && app.playback.onFrame === recorder) app.playback.onFrame = saved.onFrame;
      if (!app.audio.destroyed) app.audio.onNextTrack = saved.onNextTrack;
      if (!app.destroyed) {
        app.knowledge.onKeyword = saved.onKeyword;
        app.knowledge.onComplete = saved.onComplete;
        stage.reducedMotion = saved.reduced;
        stage.setEmoji(saved.emoji);
        stage.setGhostEffect(saved.effect);
      }
      running = false;
    }
  }
  target.__wadGhostSmokeTest = actualAudio;
  const dispose = () => {
    installed = false;
    if (target.__wadGhostSmokeTest === actualAudio) delete target.__wadGhostSmokeTest;
    delete target.__wadGhostNativeEvidence;
    target.removeEventListener?.('beforeunload', dispose);
  };
  target.addEventListener?.('beforeunload', dispose, { once: true });
  return dispose;
}
