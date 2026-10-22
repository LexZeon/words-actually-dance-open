const SOURCE = 'test-fixture';
const BPM = 120;
const PHASES = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 0.999];
const STYLE_FEATURES = Object.freeze({
  sway: {},
  twist: { brightness: 0.82, timbreBrightness: 0.82, noisiness: 0.38, frequencyTrend: 0.25 },
  stretch: { bass: 0.65, attack: 0.65 },
  spiral: { brightness: 0.82, timbreBrightness: 0.82, bass: 0.2 },
  wave: { treble: 0.55, mid: 0.5 },
});

function assert(condition, message, detail) {
  if (!condition) throw new Error(`Two-beat visual fixture: ${message}: ${JSON.stringify(detail)}`);
}

function stableFeatures(style, beatIndex, phase, time, { quiet = false } = {}) {
  assert(Object.hasOwn(STYLE_FEATURES, style), 'unknown style', style);
  return {
    energy: 0.35,
    strength: 0.3,
    bass: 0.15,
    mid: 0.4,
    treble: 0.15,
    brightness: 0.35,
    timbreBrightness: 0.35,
    attack: 0.2,
    noisiness: 0.12,
    amplitude: 0.1,
    frequencyHz: 1200,
    amplitudeTrend: 0,
    frequencyTrend: 0,
    pitchTrend: 0,
    pitchConfidence: 0,
    amplitudeRise: 0,
    observedBeat: 0,
    observedConfidence: 0,
    bpm: BPM,
    confidence: 0,
    signalValid: quiet ? 0 : 1,
    audioSilent: quiet ? 1 : 0,
    // Renderer keeps moving on its internal grid during quiet audio.
    silent: 0,
    beat: phase === 0 ? 1 : 0,
    beatIndex,
    phase,
    beatPhase: phase,
    time,
    sourceGeneration: -2,
    pulseSource: SOURCE,
    source: SOURCE,
    testOnly: true,
    ...STYLE_FEATURES[style],
    ...(quiet ? { amplitude: 0, energy: 0, strength: 0 } : {}),
  };
}

function snapshot(stage, beatIndex, phase, style, quiet = false) {
  const motion = stage.getMotionState();
  const poses = motion.poses;
  const constraints = motion.constraints;
  const finite =
    Boolean(poses && constraints) &&
    [poses.group, ...poses.glyphs].every((pose) => Object.values(pose).every(Number.isFinite)) &&
    Object.values(constraints.bounds).every(Number.isFinite) &&
    Object.values(constraints.canvas).every(Number.isFinite);
  const { bounds, canvas } = constraints || {};
  const withinCanvas =
    Boolean(bounds && canvas) &&
    bounds.left >= -1 &&
    bounds.top >= -1 &&
    bounds.right <= canvas.width + 1 &&
    bounds.bottom <= canvas.height + 1;
  assert(finite, 'rendered poses must be finite', { poses, constraints });
  assert(withinCanvas, 'rendered outline must remain inside Canvas', constraints);
  return {
    testOnly: true,
    pulseSource: SOURCE,
    beatIndex,
    phase,
    style,
    quiet,
    finite,
    withinCanvas,
    word: stage.word,
    primary: motion.primary,
    secondary: motion.secondary,
    cycle: motion.cycle,
    poses,
    constraints,
    translationXPx: poses.group.x * canvas.width,
    rotationRadians: poses.group.rotation,
  };
}

function samePoses(first, second, tolerance = 1e-8) {
  const a = [first.group, ...first.glyphs];
  const b = [second.group, ...second.glyphs];
  return (
    a.length === b.length &&
    a.every((pose, index) =>
      Object.keys(pose).every((key) => Math.abs(pose[key] - b[index][key]) <= tolerance),
    )
  );
}

async function readableCaption(app) {
  const stage = app.knowledge;
  const saved = {
    onLine: stage.onLine,
    onKeyword: stage.onKeyword,
    onComplete: stage.onComplete,
    rate: stage.rate,
  };
  const text = '第一拍向左，第二拍向右，动作连成两拍。';
  try {
    // This fixture does not change the application's topic, preferences or storage.
    stage.onLine = stage.onKeyword = stage.onComplete = () => {};
    stage.setPaused(false);
    stage.setAutoDirection(false);
    stage.setEffect('stack');
    stage.setScript({ id: 'qa-two-beat-caption', lines: [{ text, keyword: '两拍', holdBeats: 1 }] });
    stage.setRate(4);
    for (let beatIndex = 0; beatIndex < 20; beatIndex++) {
      for (let subdivisionIndex = 0; subdivisionIndex < 4; subdivisionIndex++) {
        stage.onTick(
          {
            kind: subdivisionIndex === 0 ? 'beat' : 'subdivision',
            beatIndex,
            subdivisionIndex,
            bpm: BPM,
            time: ((beatIndex + subdivisionIndex / 4) * 60) / BPM,
            source: SOURCE,
            testOnly: true,
          },
          { bpm: BPM, silent: 0 },
        );
        if (stage.current && stage.cursor === stage.current.chars.length) {
          app.ui.setLine(0, 1, { text });
          // DOM text alone is not visual evidence: let its real CSS entrance
          // finish before pausing, so the still capture cannot freeze at opacity 0.
          await new Promise((resolve) => setTimeout(resolve, 1100));
          return;
        }
      }
    }
    throw new Error('Two-beat visual fixture caption did not finish.');
  } finally {
    // Closing during the settle wait must not reinstall application callbacks
    // that KnowledgeStage.destroy() has already released.
    if (!stage.destroyed) {
      stage.onLine = saved.onLine;
      stage.onKeyword = saved.onKeyword;
      stage.onComplete = saved.onComplete;
      stage.setRate(saved.rate);
      stage.setPaused(true);
    }
  }
}

/** Controlled renderer QA only: it does not capture audio or report beat-recognition accuracy. */
export function installDanceCycleQA(app) {
  const target = app.window || globalThis.window;
  if (!target?.desktop?.testMode) return false;
  let installed = true;
  let running = false;

  async function controlled(action, { style = 'sway' } = {}) {
    assert(installed && !app.destroyed, 'application is unavailable');
    assert(!running, 'another visual fixture is running');
    running = true;
    const playback = app.playback;
    const wasStarted = playback.started;
    playback.started = false;
    if (playback.raf !== null) target.cancelAnimationFrame(playback.raf);
    playback.raf = null;
    try {
      app.setPlaying(false);
      await app.audio.setPaused(true);
      assert(installed && !app.destroyed, 'application closed during fixture setup');
      app.pendingTopic = null;
      await readableCaption(app);
      assert(installed && !app.destroyed, 'application closed during caption setup');
      const stage = app.dance;
      stage.setIntensity(1.25);
      stage.setEmoji('');
      stage.setWord('两拍', {}, { immediate: true });
      stage.setPaused(false);
      // Manual samples use one monotonic frame-time origin supplied to the real renderer.
      const warmStart = Math.max(performance.now() / 1000, stage.lastWallTime || 0) + 1;
      stage.frame(warmStart);
      // clear() intentionally retains measured features. Warm their normal
      // filters without pulses before the first new command chooses a family.
      // This also makes repeated screenshots independent of the previous style.
      for (let frame = 1; frame <= 60; frame++) {
        const time = warmStart + frame / 60;
        stage.setFeatures({ ...stableFeatures(style, 0, 0, time), beat: 0 });
        stage.frame(time);
      }
      const baseTime = warmStart + 1;
      const render = (beatIndex, phase, style = 'sway', options = {}) => {
        const time = baseTime + ((beatIndex + phase) * 60) / BPM;
        stage.setFeatures(stableFeatures(style, beatIndex, phase, time, options));
        stage.frame(time);
        return snapshot(stage, beatIndex, phase, style, options.quiet);
      };
      return await action({ stage, render, baseTime });
    } finally {
      app.dance.setPaused(true);
      app.knowledge.setPaused(true);
      if (!app.destroyed && installed && !playback.destroyed && wasStarted) {
        playback.started = true;
        playback.scheduleFrame();
      }
      running = false;
    }
  }

  const prepare = async ({ beatIndex = 0, phase = 0.5, style = 'sway' } = {}) => {
    assert(
      Number.isSafeInteger(beatIndex) && beatIndex >= 0 && beatIndex <= 7,
      'invalid beat index',
      beatIndex,
    );
    assert(Number.isFinite(phase) && phase >= 0 && phase <= 1, 'invalid beat phase', phase);
    return controlled(
      async ({ stage, render }) => {
        let pose;
        for (let beat = 0; beat <= beatIndex; beat++) {
          for (const value of PHASES) {
            if (beat === beatIndex && value > phase) break;
            pose = render(beat, value, style);
          }
        }
        if (pose.phase !== phase) pose = render(beatIndex, phase, style);
        stage.setPaused(true);
        await new Promise((resolve) => target.requestAnimationFrame(resolve));
        return { pass: true, ...pose };
      },
      { style },
    );
  };

  const test = async () =>
    controlled(async ({ stage, render, baseTime }) => {
      const midpoints = [];
      const checked = [];
      const visibleTravel = stage.reducedMotion ? 0.05 : 4;
      let wordCyclePreserved = false;
      for (let beatIndex = 0; beatIndex < 4; beatIndex++) {
        for (const phase of PHASES) {
          const pose = render(beatIndex, phase);
          checked.push({ beatIndex, phase, finite: pose.finite, withinCanvas: pose.withinCanvas });
          if (phase !== 0.5) continue;
          midpoints.push(pose);
          const expected = beatIndex % 2 ? 'right' : 'left';
          assert(pose.cycle?.durationBeats === 2, 'cycle must span two beats', pose.cycle);
          assert(
            pose.cycle.beatWithinCycle === beatIndex % 2,
            'cycle must follow global beat parity',
            pose.cycle,
          );
          assert(pose.cycle.direction === expected, 'cycle direction metadata', pose.cycle);
          assert(
            beatIndex % 2 ? pose.translationXPx > visibleTravel : pose.translationXPx < -visibleTravel,
            'left and right must be visibly distinct in actual Canvas poses',
            pose,
          );
          if (beatIndex === 0) {
            const before = pose.cycle;
            stage.setWord('律动', { from: '两拍', to: '律动', type: 'related' }, { beatDuration: 60 / BPM });
            stage.frame(baseTime + (0.5 * 60) / BPM);
            const after = stage.getMotionState().cycle;
            wordCyclePreserved =
              before.id === after.id &&
              before.beatWithinCycle === after.beatWithinCycle &&
              before.phase === after.phase;
            assert(wordCyclePreserved, 'keyword handoff must not restart the dance cycle', { before, after });
          }
        }
      }
      stage.setPaused(true);
      const beforePause = stage.getMotionState();
      render(4, 0.5);
      render(5, 0.75);
      const afterPause = stage.getMotionState();
      const pauseStable =
        samePoses(beforePause.poses, afterPause.poses) && beforePause.cycle.phase === afterPause.cycle.phase;
      assert(pauseStable, 'pause must freeze real poses and musical cycle', {
        before: beforePause.cycle,
        after: afterPause.cycle,
      });
      stage.setPaused(false);
      const quiet = [];
      for (let beatIndex = 6; beatIndex < 8; beatIndex++) {
        for (const phase of PHASES) {
          const pose = render(beatIndex, phase, 'sway', { quiet: true });
          checked.push({ beatIndex, phase, finite: pose.finite, withinCanvas: pose.withinCanvas });
          if (phase === 0.5) quiet.push(pose);
        }
      }
      const quietContinues =
        quiet[0].translationXPx < -visibleTravel && quiet[1].translationXPx > visibleTravel;
      assert(quietContinues, 'quiet audio must preserve a moving two-beat internal cycle', quiet);
      // Select the twist family through musical features, not by forcing a renderer preset.
      // Feature smoothing and the director's change-evidence hold are production
      // behavior; provide bounded warm-up beats before inspecting the new family.
      stage.setWord('扭转', {}, { immediate: true });
      const twist = [];
      for (let beatIndex = 8; beatIndex < 18; beatIndex++) {
        for (const phase of PHASES) {
          const pose = render(beatIndex, phase, 'twist');
          checked.push({ beatIndex, phase, finite: pose.finite, withinCanvas: pose.withinCanvas });
          if (beatIndex >= 16 && phase === 0.5) twist.push(pose);
        }
      }
      assert(
        twist.every((pose) => pose.primary === 'twist'),
        'twist must be selected from fixture features',
        twist,
      );
      const visibleRotation = stage.reducedMotion ? 0.002 : 0.02;
      const twistAlternates =
        twist[0].rotationRadians < -visibleRotation && twist[1].rotationRadians > visibleRotation;
      assert(twistAlternates, 'actual twist rotates left then right', twist);
      stage.setPaused(true);
      await new Promise((resolve) => target.requestAnimationFrame(resolve));
      return {
        pass: true,
        testOnly: true,
        pulseSource: SOURCE,
        renderer: 'DanceStage Canvas',
        reducedMotion: stage.reducedMotion,
        checkedFrames: checked.length,
        finite: checked.every((pose) => pose.finite),
        withinCanvas: checked.every((pose) => pose.withinCanvas),
        wordCyclePreserved,
        pauseStable,
        quietContinues,
        twistAlternates,
        midpoints,
        quiet,
        twist,
      };
    });

  target.__wadTwoBeatDanceTest = test;
  target.__wadPrepareTwoBeatPose = prepare;
  const dispose = () => {
    installed = false;
    if (target.__wadTwoBeatDanceTest === test) delete target.__wadTwoBeatDanceTest;
    if (target.__wadPrepareTwoBeatPose === prepare) delete target.__wadPrepareTwoBeatPose;
    target.removeEventListener?.('beforeunload', dispose);
  };
  target.addEventListener?.('beforeunload', dispose, { once: true });
  return dispose;
}
