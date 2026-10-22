import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicSectionDetector } from '../src/audio/music-section.js';

const base = {
  amplitude: 0.08,
  brightness: 0.25,
  bass: 0.3,
  mid: 0.3,
  treble: 0.1,
  noisiness: 0.05,
  signalValid: 1,
  audioSilent: 0,
};
const high = { ...base, amplitude: 0.3, brightness: 0.85, treble: 0.8, noisiness: 0.4 };
const invalid = { ...high, signalValid: 0, audioSilent: 1 };

function run(seconds, signal, fps = 60, detector = new MusicSectionDetector(), start = 0) {
  const entries = [];
  let episodes = detector.getState().episodes;
  for (let frame = 0; frame <= Math.round(seconds * fps); frame++) {
    const time = start + frame / fps;
    const state = detector.update(signal(time, frame, fps), time);
    if (state.episodes > episodes) entries.push(time);
    episodes = state.episodes;
  }
  return { detector, entries, state: detector.getState() };
}

function periodCrossed(time, frame, fps, rate) {
  return frame > 0 && Math.floor(time * rate + 1e-8) > Math.floor((time - 1 / fps) * rate + 1e-8);
}

test('sustained spectral energy evidence triggers one episode across sample rates', () => {
  const timings = [15, 30, 60, 90, 144].map((fps) => {
    const result = run(35, (time) => (time < 5 ? base : high), fps);
    assert.equal(result.state.episodes, 1, `no frame-by-frame retrigger at ${fps} Hz`);
    assert.equal(result.state.high, false, 'long baseline adapts without starting another episode');
    assert.equal(result.entries.length, 1);
    return result.entries[0];
  });
  assert.ok(
    timings.every((time) => time >= 6.2 && time < 7),
    JSON.stringify(timings),
  );
  assert.ok(Math.max(...timings) - Math.min(...timings) < 0.1, JSON.stringify(timings));
});

test('jittered sampling preserves the sustained-change response', () => {
  const detector = new MusicSectionDetector();
  let time = 0;
  let onset;
  const steps = [0.008, 0.027, 0.016, 0.011, 0.042];
  for (let frame = 0; time <= 10; frame++) {
    const state = detector.update(time < 5 ? base : high, time);
    if (onset === undefined && state.high) onset = time;
    time += steps[frame % steps.length];
  }
  assert.ok(onset >= 6.2 && onset < 7, `jittered onset ${onset}`);
  assert.equal(detector.getState().episodes, 1);
});

test('distinct sustained rises can rearm after a real lower-energy interval', () => {
  const result = run(35, (time) => ((time >= 5 && time < 11) || (time >= 20 && time < 26) ? high : base));
  assert.equal(result.state.episodes, 2);
  assert.ok(result.entries[0] >= 6.2 && result.entries[0] < 7);
  assert.ok(result.entries[1] >= 21.2 && result.entries[1] < 22);
});

test('a startup that is already loud warms its baseline rather than declaring a rise', () => {
  const result = run(20, () => high);
  assert.equal(result.state.episodes, 0);
  assert.equal(result.state.high, false);
  assert.equal(result.state.probability, 0);
});

test('manual gain changes with unchanged relative spectrum and attack timing do not declare a section', () => {
  for (const fps of [30, 60, 90, 144]) {
    for (const amplitude of [
      (time) => (time < 5 ? 0.08 : 0.3),
      (time) => 0.08 + Math.min(1, Math.max(0, (time - 5) / 2)) * 0.22,
    ]) {
      const result = run(
        20,
        (time, frame) => ({
          ...base,
          amplitude: amplitude(time),
          observedBeat: frame % (fps / 2) === 0,
        }),
        fps,
      );
      assert.equal(result.state.episodes, 0, `gain at ${fps} Hz`);
    }
  }
});

test('an increase in measured attack density can corroborate a sustained amplitude rise', () => {
  const result = run(10, (time, frame, fps) => ({
    ...base,
    amplitude: time < 5 ? base.amplitude : high.amplitude,
    observedBeat: frame % (time < 5 ? fps : fps / 4) === 0,
  }));
  assert.equal(result.state.episodes, 1);
  assert.ok(result.entries[0] >= 6.2 && result.entries[0] < 7.5);
});

test('internal grid pulses and cached measured flags do not create artificial attack density', () => {
  for (const flags of [
    { beat: 1, observedBeat: 0 },
    { beat: 0, observedBeat: 1 },
  ]) {
    const result = run(10, (time) => ({
      ...base,
      ...flags,
      amplitude: time < 5 ? base.amplitude : high.amplitude,
    }));
    assert.equal(result.state.episodes, 0);
  }
  const pulse = (width) =>
    run(10, (time, frame, fps) => ({
      ...base,
      amplitude: time < 5 ? base.amplitude : high.amplitude,
      observedBeat: frame % (time < 5 ? fps : fps / 4) < width,
    }));
  const oneFrame = pulse(1);
  const cachedFrames = pulse(3);
  assert.deepEqual(cachedFrames.entries, oneFrame.entries);
  assert.equal(cachedFrames.state.probability, oneFrame.state.probability);
});

test('a short dropout fades evidence without retriggering the same episode', () => {
  const result = run(35, (time) => (time < 5 ? base : time >= 6.5 && time < 6.6 ? invalid : high));
  assert.equal(result.state.episodes, 1);
  assert.equal(result.entries.length, 1);
});

test('sustained silence clears the stale baseline and the returning sound must warm up', () => {
  const result = run(15, (time) => (time < 5 ? base : time < 6.5 ? high : time < 9 ? invalid : high));
  assert.equal(result.state.episodes, 1);
  assert.equal(result.state.high, false);
  assert.equal(result.state.probability, 0);
  assert.ok(result.state.validSeconds > 5.9 && result.state.validSeconds < 6.1);
});

test('a sampling gap or clock rewind cannot turn its first returning frame into dwell evidence', () => {
  for (const returningTime of [30, 1]) {
    const detector = run(5, () => base).detector;
    const first = detector.update(high, returningTime);
    assert.equal(first.high, false);
    assert.equal(first.probability, 0);
    assert.equal(first.validSeconds, 0);
    const result = run(5, () => high, 60, detector, returningTime);
    assert.equal(result.state.episodes, 0);
  }
});

test('holdTime preserves paused evidence and excludes the paused interval on resume', () => {
  const paused = run(6, (time) => (time < 5 ? base : high)).detector;
  const control = run(6, (time) => (time < 5 ? base : high)).detector;
  const before = paused.getState();
  paused.holdTime(100);
  assert.deepEqual(paused.update(high, 100), before);
  const resumed = paused.update(high, 100.125);
  const continued = control.update(high, 6.125);
  assertNearState(resumed, continued);
});

test('explicit source reset starts independent evidence rather than comparing unrelated volume levels', () => {
  const detector = run(7, (time) => (time < 5 ? base : high)).detector;
  assert.equal(detector.getState().episodes, 1);
  detector.reset();
  const result = run(8, () => high, 60, detector, 7.5);
  assert.equal(result.state.episodes, 0);
  assert.equal(result.state.probability, 0);
});

test('duplicate timestamps and invalid time do not add measured events or advance evidence', () => {
  const control = run(6, (time) => (time < 5 ? base : high)).detector;
  const duplicate = run(6, (time) => (time < 5 ? base : high)).detector;
  const before = duplicate.getState();
  for (let frame = 0; frame < 100; frame++) duplicate.update({ ...high, observedBeat: frame % 2 }, 6);
  duplicate.holdTime(NaN);
  duplicate.update(high, Infinity);
  assert.deepEqual(duplicate.getState(), before);
  assert.deepEqual(duplicate.update(high, 6.125), control.update(high, 6.125));
});

function assertNearState(actual, expected) {
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const key of Object.keys(expected)) {
    if (typeof expected[key] === 'number')
      assert.ok(Math.abs(actual[key] - expected[key]) < 1e-10, `${key}: ${actual[key]} != ${expected[key]}`);
    else if (expected[key] && typeof expected[key] === 'object') assertNearState(actual[key], expected[key]);
    else assert.deepEqual(actual[key], expected[key]);
  }
}

test('single loud hits and short multi-feature fills fail actual duration support', () => {
  for (const seconds of [0.08, 0.36, 0.65, 0.9]) {
    for (const fps of [30, 90, 144]) {
      const result = run(18, (time) => (time >= 7 && time < 7 + seconds ? high : base), fps);
      assert.equal(result.state.episodes, 0, `${seconds}s fill at ${fps}Hz`);
    }
  }
});

test('compressed unchanged RMS needs both persistent added texture and real onset density', () => {
  const compressed = { ...high, amplitude: base.amplitude };
  for (const fps of [30, 60, 90, 144]) {
    const signal = (time, frame) => ({
      ...(time < 7 ? base : compressed),
      observedBeat: periodCrossed(time, frame, fps, time < 7 ? 1 : 4),
    });
    const result = run(20, signal, fps);
    assert.equal(result.state.episodes, 1, `compressed layer at ${fps}Hz`);
    assert.ok(result.entries[0] >= 8.2 && result.entries[0] < 9.5, JSON.stringify(result.entries));
    assert.equal(result.state.evidence.armed, false, 'adaptation is not recovery');
  }
  assert.equal(run(20, (time) => (time < 7 ? base : compressed)).state.episodes, 0, 'texture alone');
  assert.equal(
    run(20, (time, frame, fps) => ({
      ...base,
      observedBeat: frame % (time < 7 ? fps : fps / 4) === 0,
    })).state.episodes,
    0,
    'density alone at unchanged RMS',
  );
});

test('an already strong DJ platform with repeated accents and micro-variation cannot retrigger', () => {
  const result = run(90, (time) => {
    if (time < 7) return base;
    const accent = (time - 7) % 0.5 < 0.07 ? 0.04 : 0;
    return {
      ...high,
      amplitude: 0.3 + accent,
      brightness: high.brightness + Math.sin(time * 1.4) * 0.025,
      treble: high.treble + Math.sin(time * 2.1) * 0.03,
    };
  });
  assert.equal(result.state.episodes, 1);
  assert.equal(result.state.high, false);
  assert.equal(result.state.evidence.armed, false, 'no real retreat from confirmed level');
  assert.ok(result.detector.buckets.length <= 56);
  assert.ok(result.detector.onsets.length <= 128);
});

test('compressed layers rearm only after density and texture truly recover', () => {
  const signal = (time, frame, fps) => {
    const raised = (time >= 7 && time < 15) || time >= 24;
    return {
      ...(raised ? { ...high, amplitude: base.amplitude } : base),
      observedBeat: frame % (raised ? fps / 4 : fps) === 0,
    };
  };
  const result = run(36, signal);
  assert.equal(result.state.episodes, 2);
  assert.ok(result.entries[0] >= 8.2 && result.entries[0] < 9.5);
  assert.ok(result.entries[1] >= 25.2 && result.entries[1] < 26.5);
});

test('persistent moderate layers can use a weak measured density rise instead of complete hat counts', () => {
  const layered = { ...base, brightness: 0.31, mid: 0.4, treble: 0.2 };
  for (const fps of [30, 59.94, 60, 90, 120]) {
    const result = run(
      20,
      (time, frame) => ({
        ...(time < 7 ? base : layered),
        observedBeat: periodCrossed(time, frame, fps, time < 7 ? 4 : 5),
      }),
      fps,
    );
    assert.equal(result.state.episodes, 1, `weak density at ${fps}Hz`);
    assert.ok(result.entries[0] >= 8.2 && result.entries[0] < 10);
  }
  assert.equal(
    run(20, (time) => (time < 7 ? base : layered)).state.episodes,
    0,
    'no actual density corroboration',
  );
  assert.equal(
    run(20, (time, frame, fps) => ({
      ...base,
      brightness: time < 7 ? base.brightness : layered.brightness,
      observedBeat: periodCrossed(time, frame, fps, time < 7 ? 4 : 5),
    })).state.episodes,
    0,
    'brightness alone with unchanged bands',
  );
});

test('a genuinely stronger following section can escalate without first falling quiet', () => {
  const middle = { ...base, amplitude: 0.2, brightness: 0.5, treble: 0.4, noisiness: 0.2 };
  const strongest = { ...high, amplitude: 0.5 };
  const result = run(34, (time, frame, fps) => ({
    ...(time < 7 ? base : time < 19 ? middle : strongest),
    observedBeat: frame % (time < 19 ? fps : fps / 4) === 0,
  }));
  assert.equal(result.state.episodes, 2);
  assert.ok(result.entries[1] >= 20.2 && result.entries[1] < 21.5, JSON.stringify(result.entries));
});

test('actual drum identities own density, excluding repeated snapshots and internal grid', () => {
  for (const cachedFrames of [1, 3, 6]) {
    let sequence = 0;
    const result = run(20, (time, frame, fps) => {
      const cycle = time < 7 ? fps : fps / 4;
      if (frame % cycle === 0) sequence++;
      return {
        ...base,
        amplitude: time < 7 ? base.amplitude : high.amplitude,
        beat: 1,
        observedBeat: frame % 2,
        drum: { sequence, hit: frame % cycle < cachedFrames, weight: 0.6, confidence: 0.9 },
      };
    });
    assert.equal(result.state.episodes, 1, `cached ${cachedFrames} frames`);
    assert.ok(result.entries[0] >= 8.2 && result.entries[0] < 9.5);
  }
  const stale = run(20, (time, frame) => ({
    ...base,
    amplitude: time < 7 ? base.amplitude : high.amplitude,
    observedBeat: frame % 2,
    drum: { sequence: 8, hit: true, weight: 0.8, confidence: 0.9 },
  }));
  assert.equal(stale.state.episodes, 0, 'fallback flags do not supplement a supplied drum stream');
});

test('a pause during candidate confirmation excludes silence and preserves prior window evidence', () => {
  const paused = run(6.1, (time) => (time < 5 ? base : high)).detector;
  const control = run(6.1, (time) => (time < 5 ? base : high)).detector;
  const before = paused.getState();
  assert.ok(before.evidence.sustainSeconds > 0, 'pause inside real candidate dwell');
  paused.holdTime(160.1);
  assert.deepEqual(paused.update(high, 160.1), before);
  for (let frame = 1; frame <= 120; frame++) {
    assertNearState(paused.update(high, 160.1 + frame / 60), control.update(high, 6.1 + frame / 60));
  }
  assert.equal(paused.getState().episodes, 1);
});

test('a dropout cannot bridge partial dwell into a falsely sustained fill', () => {
  const result = run(18, (time) =>
    time >= 7 && time < 7.8 ? high : time >= 7.8 && time < 8 ? invalid : base,
  );
  assert.equal(result.state.episodes, 0);
});

test('silence and sampling gaps clear baseline without replaying consumed drum identities', () => {
  const cached = { ...base, observedBeat: 1, drum: { sequence: 3, hit: true, weight: 0.7, confidence: 0.9 } };
  for (const mode of ['silence', 'gap']) {
    const detector = new MusicSectionDetector();
    detector.update({ ...base, drum: { sequence: 0, hit: false } }, 0);
    detector.update(cached, 0.1);
    assert.equal(detector.onsets.length, 1);
    if (mode === 'silence') {
      for (let frame = 2; frame <= 11; frame++) detector.update({ ...cached, signalValid: 0 }, frame / 10);
      assert.equal(detector.buckets.length, 0);
      detector.update(cached, 1.2);
    } else detector.update(cached, 4);
    assert.equal(detector.lastDrumSequence, 3);
    assert.equal(detector.onsets.length, 0, `${mode} must not recount seq3`);
    assert.equal(detector.getState().episodes, 0);
  }
  const detector = new MusicSectionDetector();
  detector.update({ ...base, observedBeat: 0 }, 0);
  detector.update({ ...base, observedBeat: 1 }, 0.1);
  detector.update({ ...base, observedBeat: 1 }, 4);
  assert.equal(detector.onsets.length, 0, 'fallback held flag is preserved across gap');
  detector.reset();
  detector.update({ ...base, drum: { sequence: 0, hit: false } }, 5);
  detector.update(cached, 5.1);
  assert.equal(detector.onsets.length, 1, 'explicit new-source reset accepts independent sequence');
});
