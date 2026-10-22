import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreInternalGrid } from './helpers/grid-alignment-score.mjs';

const beats = Array.from({ length: 12 }, (_, index) => ({ time: 0.175 + index * 0.5, bpm: 120 }));
const grid = (times, bpm = 120) =>
  times.map((time) => ({ kind: 'beat', time, bpm, phaseLockSource: 'observed-onsets' }));

test('alignment scoring uses independent timestamps despite a claimed observed phase lock', () => {
  const score = scoreInternalGrid(grid(beats.map((beat) => beat.time + 0.2)), beats);
  assert.ok(Math.abs(score.absoluteErrorP95Ms - 200) < 1e-9);
  assert.equal(score.withinToleranceFraction, 0);
  assert.equal(score.firstFourBeatLock, null);
});

test('one-to-one matching exposes duplicate pulses even when every nearest error is small', () => {
  const times = beats.flatMap((beat) => [beat.time, beat.time + 0.015]);
  const score = scoreInternalGrid(
    times,
    beats.map((beat) => beat.time),
  );
  assert.equal(score.within40msFraction, 1);
  assert.equal(score.matching40.precision, 0.5);
  assert.equal(score.matching40.recall, 1);
  assert.equal(score.matching40.falsePositives, 12);
  assert.equal(score.matching40.f1, 2 / 3);
});

test('timestamp-only annotations retain variable spacing rather than assuming a fixed tempo', () => {
  const times = [0.2, 0.8, 1.4, 1.95, 2.5, 3.0, 3.5, 3.95, 4.4];
  const score = scoreInternalGrid(times, times);
  assert.equal(score.absoluteErrorP95Ms, 0);
  assert.equal(score.matching40.f1, 1);
  assert.equal(score.matching70.f1, 1);
  assert.equal(score.matching40.missedReferences, 0);
  assert.equal(score.matching40.falsePositives, 0);
});

test('missing annotations return explicit unavailable scores rather than claiming alignment', () => {
  const score = scoreInternalGrid([0.5, 1, 1.5], []);
  assert.equal(score.evaluationAvailable, false);
  assert.equal(score.absoluteErrorP95Ms, null);
  assert.equal(score.gridBeats, 3);
  assert.equal(score.matching40.f1, null);
});

test('four matching independent beats establish a measured lock and two misses lose it', () => {
  const times = beats.map((beat, index) => beat.time + (index >= 6 ? 0.2 : 0.01));
  const score = scoreInternalGrid(grid(times), beats);
  assert.ok(Math.abs(score.firstFourBeatLock.time - (beats[3].time + 0.01)) < 1e-9);
  assert.equal(score.lossEpisodes.length, 1);
  assert.equal(score.lossEpisodes[0].reason, 'phase');
  assert.equal(score.lockedAtEnd, false);
});

test('a half-speed grid has perfect phase at emitted beats but misses references and cannot establish full lock', () => {
  const score = scoreInternalGrid(
    grid(
      beats.filter((_, index) => index % 2 === 0).map((beat) => beat.time),
      60,
    ),
    beats,
  );
  assert.equal(score.absoluteErrorP95Ms, 0);
  assert.equal(score.withinToleranceFraction, 1);
  assert.equal(score.referenceCoverageFraction, 0.5);
  assert.equal(score.halfTempoFraction, 1);
  assert.equal(score.firstFourBeatLock, null);
});

test('a double-speed grid cannot hide extra offbeat pulses behind correct matched primary beats', () => {
  const times = beats.flatMap((beat) => [beat.time, beat.time + 0.25]).slice(0, -1);
  const score = scoreInternalGrid(grid(times, 240), beats);
  assert.equal(score.referenceCoverageFraction, 1);
  assert.ok(score.withinToleranceFraction < 0.55);
  assert.equal(score.absoluteErrorP95Ms, 250);
  assert.equal(score.doubleTempoFraction, 1);
  assert.equal(score.firstFourBeatLock, null);
});
