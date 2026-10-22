import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatClock } from '../src/audio/beat-clock.js';
import { PlaybackCoordinator } from '../src/playback/playback-coordinator.js';
import { createEventBus, EVENTS } from '../src/core/events.js';

test('repeated start schedules one frame loop, and destroy from a frame cannot schedule another', () => {
  const oldRAF = globalThis.requestAnimationFrame,
    oldCancel = globalThis.cancelAnimationFrame;
  const callbacks = new Map(),
    canceled = [];
  let next = 0,
    coordinator;
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.set(++next, callback);
    return next;
  };
  globalThis.cancelAnimationFrame = (id) => {
    canceled.push(id);
    callbacks.delete(id);
  };
  try {
    coordinator = new PlaybackCoordinator({
      audio: { sample: () => ({ beat: 0, silent: 1, confidence: 0 }) },
      clock: new BeatClock(),
      bus: createEventBus(),
      dance: { setPaused() {}, setFeatures() {} },
      knowledge: { setPaused() {}, onTick() {}, getState: () => ({}) },
      onFrame: () => coordinator.destroy(),
    });
    coordinator.start();
    coordinator.start();
    assert.equal(callbacks.size, 1, 'exactly one owner of the RAF loop');
    const [id, callback] = callbacks.entries().next().value;
    callbacks.delete(id);
    callback(0);
    assert.equal(coordinator.destroyed, true);
    assert.equal(callbacks.size, 0, 'closing during callback must not rearm');
    coordinator.start();
    assert.equal(callbacks.size, 0, 'a closed coordinator cannot restart');
  } finally {
    coordinator?.destroy();
    globalThis.requestAnimationFrame = oldRAF;
    globalThis.cancelAnimationFrame = oldCancel;
  }
});

test('closing from an audio or knowledge callback stops the current frame immediately', () => {
  const oldRAF = globalThis.requestAnimationFrame,
    oldCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    for (const closeAt of ['audio', 'knowledge']) {
      let coordinator;
      const calls = [],
        bus = createEventBus();
      bus.on(EVENTS.AUDIO_FRAME, () => {
        calls.push('audio');
        if (closeAt === 'audio') coordinator.destroy();
      });
      bus.on(EVENTS.BEAT_GRID, () => calls.push('grid-event'));
      coordinator = new PlaybackCoordinator({
        audio: { sample: () => ({ beat: 0, silent: 1, confidence: 0 }) },
        clock: new BeatClock(),
        bus,
        dance: {
          setPaused() {},
          setFeatures: () => calls.push('features'),
          frame: () => calls.push('render'),
        },
        knowledge: {
          setPaused() {},
          onTick: () => {
            calls.push('tick');
            coordinator.destroy();
          },
          getState: () => ({}),
        },
        onFrame: () => calls.push('finished'),
      });
      coordinator.setPlaying(true);
      coordinator.frame(0);
      assert.deepEqual(calls, closeAt === 'audio' ? ['audio'] : ['audio', 'features', 'tick']);
      assert.equal(coordinator.destroyed, true);
    }
  } finally {
    globalThis.requestAnimationFrame = oldRAF;
    globalThis.cancelAnimationFrame = oldCancel;
  }
});

test('pause from a beat hook cancels the remaining tick batch but retains a frozen UI frame', () => {
  const oldRAF = globalThis.requestAnimationFrame,
    oldCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    for (const pauseAt of ['before-beat', 'knowledge', 'grid-listener']) {
      const ticks = [],
        gridEvents = [],
        frames = [],
        calls = [];
      let coordinator,
        paused = false;
      const clock = {
        setPaused(value) {
          paused = value;
        },
        update: () => [
          { kind: 'beat', beatIndex: 1, subdivisionIndex: 0 },
          { kind: 'subdivision', beatIndex: 1, subdivisionIndex: 1 },
          { kind: 'beat', beatIndex: 2, subdivisionIndex: 0 },
        ],
        getState: () => ({ beatIndex: 1, phase: 0.25, bpm: 108, paused, source: 'internal' }),
      };
      const bus = createEventBus();
      bus.on(EVENTS.BEAT_GRID, (event) => {
        gridEvents.push(event);
        if (pauseAt === 'grid-listener') coordinator.setPlaying(false);
      });
      coordinator = new PlaybackCoordinator({
        audio: { sample: () => ({ beat: 0, silent: 1, confidence: 0 }) },
        clock,
        bus,
        beforeBeat: () => {
          if (pauseAt === 'before-beat') coordinator.setPlaying(false);
        },
        dance: { setPaused() {}, setFeatures() {}, frame: () => calls.push('dance-frame') },
        knowledge: {
          setPaused() {},
          getState: () => ({}),
          onTick: (event) => {
            ticks.push(event);
            if (pauseAt === 'knowledge') coordinator.setPlaying(false);
          },
          frame: (grid) => frames.push(grid),
        },
        onFrame: (frame) => {
          calls.push('ui-frame');
          assert.equal(frame.playing, false);
          assert.equal(frame.grid.paused, true);
          assert.equal(frame.rendering.beat, 0);
          assert.equal(frame.rendering.observedBeat, 0);
          assert.equal(frame.rendering.silent, 1);
        },
      });
      coordinator.setPlaying(true);
      coordinator.frame(1000);
      assert.equal(ticks.length, pauseAt === 'before-beat' ? 0 : 1, pauseAt);
      assert.equal(gridEvents.length, pauseAt === 'grid-listener' ? 1 : 0, pauseAt);
      assert.equal(
        coordinator.metrics.beats,
        ticks.length,
        'count only ticks already delivered to knowledge',
      );
      assert.equal(coordinator.metrics.subdivisions, 0);
      assert.equal(frames.length, 1);
      assert.equal(frames[0].phase, 0.25);
      assert.equal(frames[0].paused, true);
      assert.deepEqual(calls, ['dance-frame', 'ui-frame']);
      coordinator.destroy();
    }
  } finally {
    globalThis.requestAnimationFrame = oldRAF;
    globalThis.cancelAnimationFrame = oldCancel;
  }
});

test('silent playback shares one ordered musical grid without claiming observed audio beats', () => {
  const oldRAF = globalThis.requestAnimationFrame,
    oldCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    const ticks = [],
      observed = [],
      features = [];
    const bus = createEventBus();
    bus.on(EVENTS.BEAT, (event) => observed.push(event));
    const coordinator = new PlaybackCoordinator({
      audio: { sample: () => ({ bpm: 0, confidence: 0, silent: 1, beat: 0 }) },
      clock: new BeatClock(),
      bus,
      dance: { setPaused() {}, setFeatures: (frame) => features.push(frame) },
      knowledge: { setPaused() {}, onTick: (event) => ticks.push(event), getState: () => ({}) },
    });
    coordinator.setPlaying(true);
    for (let i = 0; i < 180; i++) coordinator.frame((i * 1000) / 60);
    assert.ok(ticks.filter((t) => t.kind === 'beat').length >= 5);
    assert.ok(ticks.every((t) => t.source === 'internal'));
    assert.equal(observed.length, 0);
    assert.ok(features.every((f) => f.audioSilent === 1 && f.silent === 0));
    assert.equal(features.filter((f) => f.beat).length, ticks.filter((t) => t.kind === 'beat').length);
    const cursor = ticks.length,
      phase = coordinator.clock.getState().phase;
    coordinator.setPlaying(false);
    coordinator.frame(10000);
    coordinator.frame(11000);
    assert.equal(ticks.length, cursor);
    assert.equal(coordinator.clock.getState().phase, phase);
    coordinator.setPlaying(true);
    coordinator.resetSource();
    coordinator.frame(12000);
    assert.ok(ticks.at(-1).beatIndex > ticks[cursor - 1].beatIndex);
    coordinator.destroy();
  } finally {
    globalThis.requestAnimationFrame = oldRAF;
    globalThis.cancelAnimationFrame = oldCancel;
  }
});

test('one observed onset retained across frames emits one observation, separately from internal pulses', () => {
  const oldRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  try {
    const bus = createEventBus(),
      observations = [];
    bus.on(EVENTS.BEAT, (e) => observations.push(e));
    let beat = 1;
    const coordinator = new PlaybackCoordinator({
      audio: { sample: () => ({ beat, silent: 0, bpm: 120, confidence: 0.8 }) },
      clock: new BeatClock(),
      bus,
      dance: { setPaused() {}, setFeatures() {} },
      knowledge: { setPaused() {}, onTick() {}, getState: () => ({}) },
    });
    coordinator.setPlaying(true);
    for (let i = 0; i < 10; i++) coordinator.frame(i * 16);
    beat = 0;
    coordinator.frame(160);
    beat = 1;
    coordinator.frame(176);
    assert.equal(observations.length, 2);
    assert.ok(observations.every((e) => e.source === 'observed'));
    assert.equal(coordinator.metrics.observedBeats, 2);
  } finally {
    globalThis.requestAnimationFrame = oldRAF;
  }
});

test('managed dance renders after the exact shared features and knowledge ticks, in seconds', () => {
  const oldRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  try {
    const calls = [];
    const coordinator = new PlaybackCoordinator({
      audio: { sample: () => ({ beat: 0, silent: 1, confidence: 0 }) },
      clock: new BeatClock(),
      bus: createEventBus(),
      dance: {
        setPaused() {},
        setFeatures: (f) => calls.push(['features', f.time, f.beatPhase]),
        frame: (time) => calls.push(['render', time]),
      },
      knowledge: { setPaused() {}, onTick: () => calls.push(['tick']), getState: () => ({}) },
    });
    coordinator.setPlaying(true);
    coordinator.frame(1200);
    assert.deepEqual(
      calls.map((call) => call[0]),
      ['features', 'tick', 'render'],
    );
    assert.equal(calls[0][1], 1.2);
    assert.equal(calls.at(-1)[1], 1.2);
  } finally {
    globalThis.requestAnimationFrame = oldRAF;
  }
});

test('managed knowledge renders the same beat phase and globally rebased beat index as its ticks', () => {
  const oldRAF = globalThis.requestAnimationFrame,
    oldCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  let coordinator;
  try {
    const clock = new BeatClock();
    const frames = [],
      ticks = [],
      calls = [];
    let danceFeatures;
    coordinator = new PlaybackCoordinator({
      audio: { sample: () => ({ beat: 0, silent: 1, confidence: 0 }) },
      clock,
      bus: createEventBus(),
      dance: {
        setPaused() {},
        setFeatures: (features) => {
          danceFeatures = features;
          calls.push('features');
        },
        frame: () => calls.push('dance-frame'),
      },
      knowledge: {
        setPaused() {},
        onTick: (event) => {
          ticks.push(event);
          calls.push('knowledge-tick');
        },
        frame: (grid) => {
          frames.push({
            grid,
            clock: clock.getState(),
            offset: coordinator.beatOffset,
            dancePhase: danceFeatures.beatPhase,
            danceBeatIndex: danceFeatures.beatIndex,
          });
          calls.push('knowledge-frame');
        },
        getState: () => ({}),
      },
    });
    coordinator.setPlaying(true);
    coordinator.frame(0);
    assert.deepEqual(calls, ['features', 'knowledge-tick', 'dance-frame', 'knowledge-frame']);
    for (let index = 1; index < 180; index++) coordinator.frame((index * 1000) / 60);
    const lastBeat = ticks.at(-1).beatIndex;
    const beforeReset = frames.length;
    coordinator.resetSource();
    coordinator.frame(4000);
    for (let index = 1; index < 45; index++) coordinator.frame(4000 + (index * 1000) / 60);
    assert.equal(frames.length, 225);
    assert.equal(frames[beforeReset].grid.beatIndex, lastBeat + 1);
    assert.equal(frames[beforeReset].clock.beatIndex, 0);
    assert.equal(frames[beforeReset].grid.phase, 0);
    assert.ok(frames.some(({ grid }) => grid.phase > 0 && grid.phase < 0.25));
    for (const { grid, clock: local, offset, dancePhase, danceBeatIndex } of frames) {
      assert.equal(grid.beatIndex, local.beatIndex + offset);
      assert.equal(grid.phase, local.phase);
      assert.equal(grid.phase, dancePhase);
      assert.equal(grid.beatIndex, danceBeatIndex);
      assert.equal(grid.source, 'internal');
      assert.equal(grid.phaseSource, 'internal-grid');
    }
    assert.ok(ticks.slice(1).every((event, index) => event.beatIndex >= ticks[index].beatIndex));
  } finally {
    coordinator?.destroy();
    globalThis.requestAnimationFrame = oldRAF;
    globalThis.cancelAnimationFrame = oldCancel;
  }
});

test('paused managed knowledge receives a frozen shared phase and resumes without wall-time catch-up', () => {
  const oldRAF = globalThis.requestAnimationFrame,
    oldCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  let coordinator;
  try {
    const frames = [],
      ticks = [],
      pauses = [];
    coordinator = new PlaybackCoordinator({
      audio: { sample: () => ({ beat: 0, silent: 1, confidence: 0 }) },
      clock: new BeatClock(),
      bus: createEventBus(),
      dance: { setPaused() {}, setFeatures() {} },
      knowledge: {
        setPaused: (paused) => pauses.push(paused),
        onTick: (event) => ticks.push(event),
        frame: (grid) => frames.push({ ...grid }),
        getState: () => ({}),
      },
    });
    coordinator.setPlaying(true);
    for (let index = 0; index <= 60; index++) coordinator.frame((index * 1000) / 60);
    const before = frames.at(-1),
      tickCount = ticks.length;
    coordinator.setPlaying(false);
    for (const time of [10000, 11000, 60000]) coordinator.frame(time);
    for (const grid of frames.slice(-3)) {
      assert.equal(grid.beatIndex, before.beatIndex);
      assert.equal(grid.phase, before.phase);
      assert.equal(grid.paused, true);
    }
    assert.equal(ticks.length, tickCount);
    coordinator.setPlaying(true);
    coordinator.frame(120000);
    const resumed = frames.at(-1);
    assert.equal(resumed.beatIndex, before.beatIndex);
    assert.equal(resumed.phase, before.phase);
    assert.equal(resumed.paused, false);
    assert.equal(ticks.length, tickCount);
    coordinator.frame(120016);
    const moving = frames.at(-1);
    const advance = moving.beatIndex + moving.phase - (resumed.beatIndex + resumed.phase);
    assert.ok(advance > 0 && advance < 0.05, `Unexpected resumed beat advance: ${advance}`);
    assert.deepEqual(pauses, [false, true, false]);
  } finally {
    coordinator?.destroy();
    globalThis.requestAnimationFrame = oldRAF;
    globalThis.cancelAnimationFrame = oldCancel;
  }
});

test('paused cached drum sequences never replay into either renderer or delivery after resume', () => {
  let sequence = 7;
  const audio = {
    committedSourceGeneration: 1,
    mode: 'file',
    sample: () => ({
      beat: 0,
      silent: 0,
      confidence: 0,
      energy: 0.5,
      amplitudeRise: 0,
      signalValid: 1,
      drum: { hit: true, sequence, kind: 'thump', weight: 0.8, strength: 0.8, confidence: 0.8 },
    }),
  };
  const bus = createEventBus(),
    events = [],
    dancing = [],
    reading = [];
  bus.on(EVENTS.DRUM_HIT, (event) => events.push(event));
  const coordinator = new PlaybackCoordinator({
    audio,
    clock: new BeatClock(),
    bus,
    dance: { setPaused() {}, setFeatures: (f) => dancing.push({ ...f.drum }) },
    knowledge: {
      setPaused() {},
      setFeatures: (f) => reading.push({ ...f.drum }),
      onTick() {},
      getState: () => ({}),
    },
  });
  try {
    coordinator.setPlaying(false);
    coordinator.frame(0);
    coordinator.setPlaying(true);
    coordinator.frame(16);
    assert.equal(events.length, 0);
    assert.equal(coordinator.metrics.drumHits, 0);
    assert.ok(dancing.every((drum) => !drum.hit));
    assert.ok(reading.every((drum) => !drum.hit));
    assert.equal(coordinator.delivery.getState().density, 0);
    sequence = 8;
    coordinator.frame(32);
    coordinator.frame(48);
    assert.equal(events.length, 1);
    assert.equal(events[0].sequence, 8);
    assert.deepEqual(
      dancing.map((drum) => drum.hit),
      [false, false, true, false],
    );
    assert.deepEqual(
      reading.map((drum) => drum.hit),
      [false, false, true, false],
    );
    assert.equal(coordinator.delivery.getState().density, 1 / 1.6);
    coordinator.setPlaying(false);
    sequence = 9;
    coordinator.frame(64);
    coordinator.setPlaying(true);
    coordinator.frame(80);
    assert.equal(events.length, 1);
    assert.equal(coordinator.metrics.drumHits, 1);
  } finally {
    coordinator.destroy();
  }
});
