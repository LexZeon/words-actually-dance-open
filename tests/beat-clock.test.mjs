import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatClock } from '../src/audio/beat-clock.js';

const features = (beat = 0, overrides = {}) => ({ beat, bpm: 120, confidence: 0.9, silent: 0, ...overrides });
function run(clock, { seconds = 6, bpm = 0, confidence = 0.9, silent = 0, start = 0 } = {}) {
  const events = [];
  let previousBeat = -1;
  for (let frame = 0; frame < seconds * 120; frame++) {
    const time = start + frame / 120;
    const index = bpm ? Math.floor((time - start) / (60 / bpm)) : -1;
    const beat = bpm && index !== previousBeat ? 1 : 0;
    previousBeat = index;
    events.push(...clock.update(features(beat, { bpm, confidence, silent }), time));
  }
  return events;
}

test('default grid continues without audio and labels every event internal', () => {
  const clock = new BeatClock();
  const events = run(clock, { silent: 1, seconds: 4 });
  assert.ok(events.length >= 28);
  events.forEach((event, index) => {
    assert.equal(event.beatIndex, Math.floor(index / 4));
    assert.equal(event.subdivisionIndex, index % 4);
    assert.equal(event.source, 'internal');
    assert.equal(event.tempoSource, 'default');
    assert.equal(event.bpm, 108);
  });
});

test('uncertain or fluctuating candidates do not stop or retime the grid', () => {
  const clock = new BeatClock();
  const events = run(clock, { bpm: 170, confidence: 0.2, seconds: 6 });
  assert.ok(events.length > 40);
  assert.equal(clock.getState().bpm, 108);
  assert.equal(clock.getState().targetBpm, 108);
});

test('meaningful repeated observed evidence changes tempo progressively', () => {
  const clock = new BeatClock();
  run(clock, { bpm: 150, seconds: 2 });
  let state = clock.getState();
  assert.equal(state.targetBpm, 150);
  assert.ok(state.bpm > 108 && state.bpm < 150, 'BPM ' + state.bpm);
  const events = run(clock, { bpm: 150, seconds: 8, start: 2 });
  state = clock.getState();
  assert.ok(state.bpm > 148 && state.bpm <= 150);
  assert.equal(state.tempoSource, 'audio');
  assert.ok(events.every((event) => event.source === 'internal'));
});

test('moderate cold-start evidence keeps the held grid for a small tempo difference', () => {
  const clock = new BeatClock();
  run(clock, { bpm: 113, confidence: 0.5, seconds: 8 });
  assert.equal(clock.getState().bpm, 108);
  assert.equal(clock.getState().targetBpm, 108);
});

test('strong coherent cold-start onsets resolve the tempo and phase gap around the default', () => {
  for (const bpm of [101, 104, 112, 113, 116]) {
    const clock = new BeatClock();
    const events = run(clock, { bpm, seconds: 12 });
    const state = clock.getState();
    assert.equal(state.targetBpm, bpm, 'cold-start target ' + bpm);
    assert.ok(Math.abs(state.bpm - bpm) < 0.1);
    assert.equal(state.tempoSource, 'audio');
    assert.equal(state.phaseLockSource, 'observed-onsets');
    assert.ok(events.every((event) => event.source === 'internal'));
    for (let i = 1; i < events.length; i++)
      assert.ok(
        events[i].beatIndex * 4 + events[i].subdivisionIndex >
          events[i - 1].beatIndex * 4 + events[i - 1].subdivisionIndex,
      );
  }
});

test('confident irregular cold-start attacks do not establish a nearby default tempo', () => {
  const clock = new BeatClock();
  let next = 0,
    count = 0;
  for (let frame = 0; frame < 12 * 120; frame++) {
    const time = frame / 120;
    const beat = time >= next;
    if (beat) next += count++ % 2 ? 0.46 : 0.64;
    clock.update(features(beat ? 1 : 0, { bpm: 113, confidence: 0.95 }), time);
  }
  assert.equal(clock.getState().targetBpm, 108);
  assert.equal(clock.getState().bpm, 108);
  assert.notEqual(clock.getState().phaseLockSource, 'observed-onsets');
});

test('an established tempo can follow a trustworthy smaller drift through the old tempo/phase dead band', () => {
  const clock = new BeatClock();
  run(clock, { bpm: 126, seconds: 12 });
  assert.equal(clock.getState().targetBpm, 126);
  assert.equal(clock.getState().tempoSource, 'audio');
  run(clock, { bpm: 132, seconds: 12, start: 12 });
  assert.equal(
    clock.getState().targetBpm,
    132,
    '6 BPM is below the coarse 8% gate but above the old 3% phase gate',
  );
  assert.ok(Math.abs(clock.getState().bpm - 132) < 0.1);
  assert.equal(clock.getState().phaseLockSource, 'observed-onsets');
});

test('fine retargeting requires stronger repeated onset evidence and never expands phase reliability', () => {
  const clock = new BeatClock();
  run(clock, { bpm: 126, seconds: 12 });
  run(clock, { bpm: 132, confidence: 0.5, seconds: 8, start: 12 });
  assert.equal(clock.getState().targetBpm, 126);
  assert.notEqual(clock.getState().phaseLockSource, 'observed-onsets');
  let next = 20,
    pulse = 0;
  for (let frame = 0; frame < 8 * 120; frame++) {
    const time = 20 + frame / 120;
    const beat = time >= next;
    if (beat) {
      next += pulse++ % 2 ? 0.51 : 0.43;
    }
    clock.update(features(beat ? 1 : 0, { bpm: 132, confidence: 0.9 }), time);
  }
  assert.equal(clock.getState().targetBpm, 126);
  assert.notEqual(clock.getState().phaseLockSource, 'observed-onsets');
});

test('one strong onset cannot borrow weak phase history to fine-tune an established tempo', () => {
  const clock = new BeatClock();
  run(clock, { bpm: 126, seconds: 12 });
  const period = 60 / 132;
  let previous = -1;
  for (let frame = 0; frame < 5 * 120; frame++) {
    const time = 12 + frame / 120,
      index = Math.floor((time - 12) / period),
      confidence = index < 4 ? 0.5 : 0.9,
      pulse = index !== previous;
    previous = index;
    clock.update(features(pulse ? 1 : 0, { bpm: 132, confidence }), time);
    if (pulse && index === 4)
      assert.equal(clock.getState().targetBpm, 126, 'all four phase observations must be strong');
  }
  assert.equal(clock.getState().targetBpm, 132);
});

test('duplicate beat flags cannot provide repeated evidence', () => {
  const clock = new BeatClock();
  for (let frame = 0; frame < 600; frame++) clock.update(features(1, { bpm: 160 }), frame / 120);
  assert.equal(clock.getState().targetBpm, 108);
});

test('silence holds accepted tempo while internal beats keep advancing', () => {
  const clock = new BeatClock();
  run(clock, { bpm: 150, seconds: 10 });
  const before = clock.getState();
  const events = run(clock, { silent: 1, seconds: 3, start: 10 });
  const after = clock.getState();
  assert.ok(events.length > 20);
  assert.equal(after.tempoSource, 'held');
  assert.equal(after.targetBpm, 150);
  assert.ok(after.bpm >= before.bpm);
});

test('pause freezes phase and resume does not replay missed time', () => {
  const clock = new BeatClock();
  run(clock, { seconds: 1 });
  clock.setPaused(true);
  const before = clock.getState();
  assert.deepEqual(clock.update(features(1), 3), []);
  assert.deepEqual(clock.update(features(0), 9), []);
  assert.equal(clock.getState().phase, before.phase);
  clock.setPaused(false);
  assert.deepEqual(clock.update(features(0), 10), []);
  const events = run(clock, { seconds: 1, start: 10.01 });
  assert.ok(events.length >= 6 && events.length <= 8);
  assert.equal(
    events[0].beatIndex * 4 + events[0].subdivisionIndex,
    before.beatIndex * 4 + before.subdivisionIndex + 1,
  );
});

test('long frame gaps cannot produce bursts or skip ordered subdivisions', () => {
  const clock = new BeatClock();
  const events = [clock.update({}, 0)[0]];
  for (let time = 1; time < 12; time++) {
    const next = clock.update({}, time);
    assert.ok(next.length <= 1);
    events.push(...next);
  }
  events.forEach((event, index) => assert.equal(event.beatIndex * 4 + event.subdivisionIndex, index));
});

test('source reset preserves current tempo and can explicitly restore defaults', () => {
  const clock = new BeatClock();
  run(clock, { bpm: 150, seconds: 10 });
  const previous = clock.getState().bpm;
  clock.reset();
  assert.equal(clock.getState().bpm, previous);
  assert.equal(clock.getState().tempoSource, 'held');
  const first = clock.update({}, 0)[0];
  assert.equal(first.beatIndex, 0);
  clock.reset({ preserveTempo: false });
  assert.equal(clock.getState().bpm, 108);
  assert.equal(clock.getState().tempoSource, 'default');
});

test('repeating pause state preserves the current internal phase', () => {
  const clock = new BeatClock();
  clock.update({}, 0);
  clock.update({}, 0.1);
  const before = clock.getState().phase;
  clock.setPaused(false);
  assert.equal(clock.getState().phase, before);
});

test('an isolated estimate and inconsistent observed intervals cannot retime the grid', () => {
  const clock = new BeatClock();
  clock.update(features(1, { bpm: 180 }), 0);
  for (const time of [0.1, 0.7, 1.5, 2.6]) {
    clock.update(features(0, { bpm: 180 }), time - 0.01);
    clock.update(features(1, { bpm: 180 }), time);
  }
  assert.equal(clock.getState().targetBpm, 108);
});

function offsetMusic(clock, { seconds = 25, offset = 0.175, confidence = 0.95, bpm = 120 } = {}) {
  let previousObserved = -1,
    previousPosition = clock.position;
  const errors = [],
    events = [];
  for (let frame = 0; frame < seconds * 120; frame++) {
    const time = frame / 120;
    const index = time >= offset ? Math.floor((time - offset) / (60 / bpm) + 1e-9) : -1;
    const beat = index >= 0 && index !== previousObserved ? 1 : 0;
    previousObserved = index;
    events.push(...clock.update(features(beat, { bpm, confidence }), time));
    const state = clock.getState();
    assert.ok(clock.position >= previousPosition, 'phase correction cannot rewind musical position');
    assert.ok(Math.abs(state.phaseCorrectionRate) <= Math.min(0.28, (state.bpm / 60) * 0.12) + 1e-3);
    previousPosition = clock.position;
    if (beat) errors.push(Math.min(state.phase, 1 - state.phase));
  }
  return { errors, events };
}

test('consistent 120 BPM music with a real phase offset gently aligns the internal grid', () => {
  const clock = new BeatClock({ defaultBpm: 120 });
  const { errors, events } = offsetMusic(clock);
  assert.ok(errors[0] > 0.3, 'the initial grid is meaningfully off beat');
  assert.ok(
    errors.slice(-10).every((error) => error < 0.015),
    'must converge toward the observed onset phase',
  );
  events.forEach((event, index) => {
    assert.equal(event.beatIndex * 4 + event.subdivisionIndex, index);
    assert.equal(event.source, 'internal');
    assert.equal(event.phaseSource, 'internal-grid');
  });
  assert.equal(clock.getState().phaseLockSource, 'observed-onsets');
});

test('default tempo acquisition and phase locking converge without a grid jump', () => {
  const clock = new BeatClock();
  const { errors } = offsetMusic(clock, { seconds: 30 });
  assert.ok(clock.getState().bpm > 119.9);
  assert.ok(errors.slice(-8).every((error) => error < 0.025));
});

test('weak periodic evidence cannot pull phase toward its arbitrary onset offset', () => {
  const clock = new BeatClock({ defaultBpm: 120 });
  const { errors } = offsetMusic(clock, { seconds: 15, confidence: 0.35 });
  assert.ok(errors.every((error) => Math.abs(error - 0.35) < 0.0001));
  assert.equal(clock.getState().phaseCorrectionRate, 0);
  assert.equal(clock.getState().phaseLockSource, 'none');
});

test('moderate-confidence periodic evidence locks only after tighter actual onset coherence', () => {
  const clock = new BeatClock({ defaultBpm: 120 });
  const { errors } = offsetMusic(clock, { seconds: 15, confidence: 0.5 });
  assert.ok(errors.slice(-6).every((error) => error < 0.015));
  assert.equal(clock.getState().phaseLockSource, 'observed-onsets');
  clock.update(features(0, { confidence: 0.35 }), 15);
  assert.equal(clock.getState().phaseCorrectionRate, 0, 'weak current evidence must not continue pulling');
});

test('confident but inconsistent vocal-style attacks cannot establish a phase lock', () => {
  const clock = new BeatClock({ defaultBpm: 120 });
  const hits = [0.175];
  for (let index = 0; index < 30; index++) hits.push(hits.at(-1) + (index % 2 ? 0.6 : 0.4));
  let next = 0;
  for (let frame = 0; frame < 15 * 120; frame++) {
    const time = frame / 120;
    const beat = time >= hits[next] ? 1 : 0;
    if (beat) next++;
    clock.update(features(beat, { bpm: 120, confidence: 0.95 }), time);
    assert.equal(clock.getState().phaseCorrectionRate, 0);
  }
});

test('pause and silence stop phase pulling; reset keeps tempo but clears old phase evidence', () => {
  const clock = new BeatClock({ defaultBpm: 120 });
  offsetMusic(clock, { seconds: 4 });
  assert.notEqual(clock.getState().phaseCorrectionRate, 0);
  clock.setPaused(true);
  const phase = clock.getState().phase;
  assert.deepEqual(clock.update(features(), 10), []);
  assert.equal(clock.getState().phase, phase);
  assert.equal(clock.getState().phaseCorrectionRate, 0);
  clock.setPaused(false);
  assert.deepEqual(clock.update(features(0, { silent: 1, confidence: 0 }), 12), []);
  const after = clock.update(features(0, { silent: 1, confidence: 0 }), 12.02);
  assert.ok(after.length <= 1);
  assert.equal(clock.getState().phaseCorrectionRate, 0);
  clock.reset();
  assert.equal(clock.getState().bpm, 120);
  assert.equal(clock.getState().phase, 0);
  assert.equal(clock.getState().phaseError, 0);
  assert.equal(clock.getState().phaseCorrectionRate, 0);
});
