import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackCoordinator } from '../src/playback/playback-coordinator.js';
import { BeatClock } from '../src/audio/beat-clock.js';
import { MotionDirector } from '../src/visuals/dance-motion.js';
import { createEventBus, EVENTS } from '../src/core/events.js';

// This is a shared-grid/rendering integration fixture, not an audio-detection
// accuracy test. Measurements are steady; the real BeatClock alone emits ticks.
function fixture({ initialPrivateCount = 0 } = {}) {
  const measured = {
    beat: 0,
    bpm: 0,
    confidence: 0,
    silent: 0,
    signalValid: 1,
    bass: 0.15,
    mid: 0.4,
    treble: 0.15,
    brightness: 0.35,
    timbreBrightness: 0.35,
    attack: 0.2,
    amplitude: 0.1,
    rms: 0.1,
    frequencyHz: 1200,
    energy: 0.35,
    strength: 0.3,
    noisiness: 0.03,
    amplitudeTrend: 0,
    frequencyTrend: 0,
    pitchTrend: 0,
  };
  let quiet = false,
    paused = true,
    features;
  const clock = new BeatClock(),
    motion = new MotionDirector(),
    bus = createEventBus();
  motion.beatCount = initialPrivateCount;
  const frames = [],
    ticks = [],
    gridEvents = [];
  const audio = {
    mode: 'fixture',
    committedSourceGeneration: 1,
    sample: () =>
      quiet ? { ...measured, silent: 1, signalValid: 0, amplitude: 0, rms: 0 } : { ...measured },
  };
  bus.on(EVENTS.BEAT_GRID, (event) => gridEvents.push(event));
  const coordinator = new PlaybackCoordinator({
    audio,
    clock,
    bus,
    dance: {
      setPaused(value) {
        paused = value;
      },
      setFeatures(value) {
        features = { ...value };
        motion.update(value, value.time, { paused, glyphCount: 4 });
      },
      frame(time) {
        const options = { glyphCount: 4, beatPhase: features.beatPhase };
        frames.push({
          time,
          features: { ...features },
          clock: clock.getState(),
          pose: motion.sample(time, options),
          cycle: motion.getState(time, options).cycle,
        });
      },
      getMotionState: () => motion.getState(frames.at(-1)?.time ?? 0),
    },
    knowledge: {
      setPaused() {},
      frame() {},
      getState: () => ({}),
      onTick(event) {
        assert.equal(event.beatIndex, features.beatIndex, 'knowledge and dance receive the same global beat');
        ticks.push(event);
      },
    },
  });
  return {
    coordinator,
    motion,
    audio,
    clock,
    frames,
    ticks,
    gridEvents,
    setQuiet: (value) => {
      quiet = value;
    },
    frame: (seconds) => coordinator.frame(seconds * 1000),
    run(from, to) {
      for (let step = 0; step <= Math.round((to - from) * 90); step++) this.frame(from + step / 90);
    },
  };
}

function midBeatFrames(frames) {
  const chosen = new Map();
  for (const frame of frames) {
    if (frame.features.beatIndex < 0 || frame.features.beatPhase < 0.4 || frame.features.beatPhase > 0.6)
      continue;
    const previous = chosen.get(frame.features.beatIndex);
    if (!previous || Math.abs(frame.features.beatPhase - 0.5) < Math.abs(previous.features.beatPhase - 0.5))
      chosen.set(frame.features.beatIndex, frame);
  }
  return [...chosen.values()];
}

function assertAlternatingPose(frame) {
  const beat = frame.features.beatIndex,
    left = beat % 2 === 0;
  assert.ok(frame.cycle, 'cycle state is exposed by the production director');
  assert.equal(frame.cycle.beatIndex, beat);
  assert.equal(frame.cycle.beatWithinCycle, beat % 2);
  assert.equal(frame.cycle.durationBeats, 2);
  assert.equal(frame.cycle.direction, left ? 'left' : 'right');
  assert.equal(frame.cycle.source, 'internal-grid');
  assert.ok(
    left ? frame.pose.group.x < 0 : frame.pose.group.x > 0,
    `Beat ${beat}: actual group x=${frame.pose.group.x} must turn ${left ? 'left' : 'right'}`,
  );
  assert.ok(
    left ? frame.pose.group.rotation < 0 : frame.pose.group.rotation > 0,
    `Beat ${beat}: actual rotation=${frame.pose.group.rotation} must turn ${left ? 'left' : 'right'}`,
  );
}

test('two-beat left/right poses follow the shared grid through audible and quiet playback despite a biased private count', () => {
  const run = fixture({ initialPrivateCount: 91 });
  try {
    run.coordinator.setPlaying(true);
    run.run(0, 3);
    run.setQuiet(true);
    run.run(3, 6);
    const midpoints = midBeatFrames(run.frames);
    assert.ok(midpoints.length >= 10);
    assert.ok(midpoints.some((frame) => frame.features.audioSilent === 1));
    for (const frame of midpoints) assertAlternatingPose(frame);
    assert.equal(run.motion.beatCount, 91 + run.gridEvents.filter((event) => event.kind === 'beat').length);
    for (const frame of run.frames) {
      assert.equal(frame.features.beatIndex, frame.clock.beatIndex + run.coordinator.beatOffset);
      assert.equal(frame.features.beatPhase, frame.clock.phase);
    }
  } finally {
    run.coordinator.destroy();
  }
});

test('pause freezes the actual two-beat pose and resume continues its side without replaying elapsed wall time', () => {
  const run = fixture({ initialPrivateCount: 43 });
  try {
    run.coordinator.setPlaying(true);
    run.run(0, 2.5);
    const before = run.frames.at(-1),
      ticks = run.ticks.length;
    assert.ok(Math.abs(before.features.beatPhase - 0.5) < 1e-8);
    run.coordinator.setPlaying(false);
    run.frame(10);
    run.frame(40);
    for (const frame of run.frames.slice(-2)) {
      assert.deepEqual(frame.pose.group, before.pose.group);
      assert.equal(frame.features.beatIndex, before.features.beatIndex);
      assert.equal(frame.cycle.phase, before.cycle.phase);
    }
    assert.equal(run.ticks.length, ticks);
    run.coordinator.setPlaying(true);
    run.frame(60);
    const resumed = run.frames.at(-1);
    assert.deepEqual(resumed.pose.group, before.pose.group);
    assert.equal(resumed.cycle.direction, before.cycle.direction);
    assert.equal(run.ticks.length, ticks);
    run.run(60, 61.5);
    for (const frame of midBeatFrames(run.frames.filter((entry) => entry.time > 60.1)))
      assertAlternatingPose(frame);
  } finally {
    run.coordinator.destroy();
  }
});

test('committed source reset rebases a new local beat zero onto the next global side', () => {
  const run = fixture();
  try {
    run.coordinator.setPlaying(true);
    run.run(0, 2.5);
    assert.equal(run.coordinator.lastGlobalBeat, 4);
    run.motion.beatCount = 100; // An even private count must not force the next global odd beat left.
    run.audio.committedSourceGeneration++;
    run.coordinator.resetSource();
    const previousTicks = run.ticks.length;
    run.run(50, 51.5);
    assert.equal(run.ticks[previousTicks].beatIndex, 5);
    const newFrames = run.frames.filter((frame) => frame.time >= 50);
    assert.equal(newFrames[0].clock.beatIndex, 0);
    assert.equal(newFrames[0].features.beatIndex, 5);
    const middle = midBeatFrames(newFrames);
    assert.equal(middle[0].features.beatIndex, 5);
    assert.ok(middle.length >= 2);
    for (const frame of middle) assertAlternatingPose(frame);
  } finally {
    run.coordinator.destroy();
  }
});

test('a dropped frame and cleared choreography cannot derive the next side from wall time or private beat count', () => {
  const run = fixture({ initialPrivateCount: 60 });
  try {
    run.coordinator.setPlaying(true);
    run.run(0, 2.5);
    run.motion.clear();
    run.motion.beatCount = 0;
    const oldGlobal = run.frames.at(-1).features.beatIndex;
    run.frame(30); // Real Clock caps elapsed musical time instead of burst-catching up.
    assert.equal(run.frames.at(-1).features.beatIndex, oldGlobal);
    run.run(30, 31.5);
    const future = midBeatFrames(
      run.frames.filter((frame) => frame.time > 30 && frame.features.beatIndex > oldGlobal),
    );
    assert.ok(future.length >= 2);
    assert.equal(future[0].features.beatIndex, oldGlobal + 1);
    for (const frame of future) assertAlternatingPose(frame);
  } finally {
    run.coordinator.destroy();
  }
});
