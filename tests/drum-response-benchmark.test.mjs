import test from 'node:test';
import assert from 'node:assert/strict';
import { drumPcmFixture, pcm16Wav } from './helpers/drum-pcm-fixtures.mjs';
import {
  measureDrumFixture,
  measureDrumMotionFixture,
  measureMusicDeliveryFixture,
  scoreDrumEvents,
} from '../scripts/drum-response-benchmark.mjs';

test('drum PCM scoring matches each independent audible attack once and exposes duplicate responses', () => {
  const score = scoreDrumEvents(
    [
      { time: 0.52, kind: 'thump', weight: 0.5 },
      { time: 0.55, kind: 'thump', weight: 0.5 },
    ],
    [{ time: 0.5, kind: 'thump', role: 'primary' }],
  );
  assert.equal(score.matchedHits, 1);
  assert.equal(score.unmatchedEvents, 1);
  assert.equal(score.precision, 0.5);
  assert.equal(scoreDrumEvents([{ time: 0.45 }], [{ time: 0.5 }]).matchedHits, 0);
});

test('fixture frame only exposes causal PCM/FFT and WAV output carries no knowledge of attack labels', () => {
  const fixture = drumPcmFixture();
  const frame = fixture.frame(0.6);
  assert.deepEqual(Object.keys(frame), ['time', 'spectrum', 'wave', 'rms']);
  assert.ok(frame.rms > 0);
  assert.ok(frame.spectrum.some((value) => value > 0));
  const wav = pcm16Wav(fixture);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(wav.length, 44 + fixture.samples.length * 2);
});

test('actual alternating light/heavy PCM attacks yield prompt distinct weights without duplicate hits', () => {
  const { score } = measureDrumFixture('alternating-weight');
  assert.equal(score.missedHits, 0);
  assert.equal(score.unmatchedEvents, 0);
  assert.ok(score.delayP95Ms <= 70, `causal FFT attack delay ${score.delayP95Ms} ms`);
  assert.ok(
    score.weightsByRole.heavy.mean > score.weightsByRole.light.mean + 0.12,
    `heavy ${score.weightsByRole.heavy.mean}, light ${score.weightsByRole.light.mean}`,
  );
});

test('different analysis cadences and frame phases preserve hit identity and light/heavy response order', () => {
  for (const [analysisHz, frameOffsetSeconds] of [
    [50, 0],
    [60, 0.003],
    [90, 0.007],
    [120, 0.001],
  ]) {
    const { score } = measureDrumFixture('alternating-weight', { analysisHz, frameOffsetSeconds });
    const label = `${analysisHz}Hz phase ${frameOffsetSeconds}s`;
    assert.equal(score.missedHits, 0, label);
    assert.equal(score.unmatchedEvents, 0, label);
    assert.ok(score.delayP95Ms <= 80, `${label}: ${score.delayP95Ms}ms`);
    assert.ok(score.classifiedFraction >= 0.9, `${label}: ${score.classifiedFraction}`);
    assert.ok(score.weightsByRole.heavy.mean > score.weightsByRole.light.mean + 0.12, label);
  }
});

test('actual low/mid/high percussion produces distinct thump/snap/tick categories', () => {
  const { score } = measureDrumFixture('different-drum-bands');
  assert.equal(score.missedHits, 0);
  assert.equal(score.unmatchedEvents, 0);
  assert.ok(score.classifiedFraction >= 0.9, `category fraction ${score.classifiedFraction}`);
});

test('dense measured double hits are not lost in a quarter-note refractory window', () => {
  const { score } = measureDrumFixture('dense-double-hits');
  assert.equal(score.missedHits, 0);
  assert.equal(score.unmatchedEvents, 0);
  assert.equal(score.classifiedFraction, 1);
  assert.ok(score.delayP95Ms <= 70);
});

test('a smooth sustained tonal sound does not manufacture repeated percussion impacts', () => {
  const { events } = measureDrumFixture('sustained-tones');
  assert.equal(events.filter((event) => event.time >= 1).length, 0);
  assert.ok(events.length <= 1, `${events.length} false tonal impacts`);
});

test('same-stream volume and timbre changes affect the immediately measured attacks', () => {
  const { score } = measureDrumFixture('same-stream-change');
  assert.equal(score.missedHits, 0);
  assert.equal(score.unmatchedEvents, 0);
  assert.ok(score.weightsByRole['heavy-section'].mean > score.weightsByRole['light-section'].mean + 0.1);
  const changed = score.matches.filter((row) => row.role === 'changed-timbre');
  assert.ok(changed.every((row) => row.measuredKind === 'snap'));
  assert.ok(changed[0].delayMs <= 70);
});

test('polyphonic PCM preserves primary drum response while retaining separate quieter subdivision weights', () => {
  const { score } = measureDrumFixture('polyphonic-syncopation');
  const primary = score.matches.filter((row) => row.role === 'primary');
  assert.equal(primary.length, 22);
  assert.equal(score.matches.filter((row) => row.role === 'subdivision').length, 66);
  assert.equal(score.missedHits, 0);
  assert.equal(score.unmatchedEvents, 0);
  assert.ok(score.classifiedFraction >= 0.8, `spectral proxy classification ${score.classifiedFraction}`);
  assert.ok(primary.every((row) => row.delayMs <= 80));
  assert.ok(score.weightsByRole.primary.mean > score.weightsByRole.subdivision.mean + 0.1);
});

test('polyphonic light subdivisions remain distinguishable at different native frame cadences', () => {
  for (const analysisHz of [50, 60, 120]) {
    const { score } = measureDrumFixture('polyphonic-syncopation', { analysisHz });
    assert.equal(score.missedHits, 0, `${analysisHz}Hz`);
    assert.equal(score.unmatchedEvents, 0, `${analysisHz}Hz`);
    assert.ok(score.delayP95Ms <= 80, `${analysisHz}Hz: ${score.delayP95Ms}ms`);
    assert.ok(score.weightsByRole.primary.mean > score.weightsByRole.subdivision.mean + 0.1);
  }
});

test('measured PCM creates prompt production dance poses of different amplitudes without inventing grid beats', () => {
  const result = measureDrumMotionFixture();
  assert.equal(result.matchedHits, 14);
  assert.equal(result.unrespondedHits, 0);
  assert.equal(result.internalBeatsCreatedByDrumHits, 0);
  assert.ok(result.audibleAttackToFirstPoseP95Ms <= 90, `${result.audibleAttackToFirstPoseP95Ms}ms`);
  assert.ok(result.audibleAttackToPeakPoseP95Ms <= 110, `${result.audibleAttackToPeakPoseP95Ms}ms`);
  const mean = (role) => {
    const values = result.responses.filter((row) => row.role === role).map((row) => row.maximumPoseDistance);
    return values.reduce((a, b) => a + b, 0) / values.length;
  };
  assert.ok(mean('heavy') > mean('light') * 2, `heavy pose ${mean('heavy')}, light pose ${mean('light')}`);
});

test('a denser actual PCM arrangement raises delivery drive at unchanged primary spacing without a BPM label', () => {
  const response = measureMusicDeliveryFixture();
  assert.equal(response.labelledBpmFedToDelivery, false);
  assert.equal(response.actualSpeechRateRecognition, false);
  assert.equal(response.multiplierWithinReadingLimit, true);
  assert.ok(
    response.dense.meanDrive > response.sparse.meanDrive + 0.35,
    `sparse ${response.sparse.meanDrive}, dense ${response.dense.meanDrive}`,
  );
  assert.ok(response.dense.meanDensity > response.sparse.meanDensity * 2);
  assert.ok(response.dense.meanReadingMultiplier > response.sparse.meanReadingMultiplier + 0.2);
  assert.ok(response.dense.intenseFrames > 0);
});
