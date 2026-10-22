import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BeatDetector } from '../src/audio/beat-detector.js';
import { BeatClock } from '../src/audio/beat-clock.js';
import { DrumDetector } from '../src/audio/drum-detector.js';
import { BlackmanFft } from './helpers/pcm-rhythm.mjs';
const { createDrumQAFixtures } = createRequire(import.meta.url)('../electron/native-qa.cjs');
const fixtures = await createDrumQAFixtures(fileURLToPath(new URL('..', import.meta.url)));
const bytes = Buffer.from(fixtures.payload[1].base64, 'base64');
const samples = Float32Array.from(
  { length: (bytes.length - 44) / 2 },
  (_, index) => bytes.readInt16LE(44 + index * 2) / 32768,
);

function replay(renderHz) {
  const fft = new BlackmanFft(2048),
    wave = new Float32Array(2048),
    raw = new Float32Array(1024),
    spectrum = new Float32Array(1024);
  const detector = new BeatDetector(),
    clock = new BeatClock(),
    drum = new DrumDetector();
  let lastAnalysis = -Infinity,
    measured = {},
    quietWithHistory = 0;
  const rows = [],
    hits = [];
  for (let frame = 0; frame < 10 * renderHz; frame++) {
    const wallTime = frame / renderHz;
    // WebAudio's 128-sample quantum and production's <=90 Hz analysis cache.
    const audioTime = Math.floor(wallTime * 375) / 375;
    if (audioTime - lastAnalysis >= 1 / 90) {
      lastAnalysis = audioTime;
      const end = Math.min(samples.length, Math.floor(audioTime * 48000)),
        start = Math.max(0, end - 2048);
      wave.fill(0);
      wave.set(samples.subarray(start, end), 2048 - (end - start));
      fft.process(wave, raw);
      for (let bin = 0; bin < spectrum.length; bin++) spectrum[bin] = spectrum[bin] * 0.45 + raw[bin] * 0.55;
      const rms = Math.sqrt(wave.reduce((sum, value) => sum + value ** 2, 0) / wave.length);
      measured = detector.process({ time: audioTime, spectrum, rms });
      const attack = drum.process({ time: audioTime, spectrum: raw, wave, rms });
      if (attack.hit) hits.push({ time: audioTime, kind: attack.kind, weight: attack.weight });
      if (measured.silent) {
        assert.equal(measured.beat, 0, 'quiet input cannot fabricate an observed pulse');
        assert.equal(measured.bpm, 0, 'remembered intervals are not current tempo measurement');
        assert.equal(measured.confidence, 0);
        if (detector.fullBpm > 0 && detector.rhythm.histories.bass.length) quietWithHistory++;
      }
    }
    clock.update(measured, wallTime);
    rows.push({ time: audioTime, bpm: clock.getState().bpm, targetBpm: clock.getState().targetBpm });
  }
  return { detector, clock, rows, hits, quietWithHistory };
}

for (const renderHz of [60, 280])
  test(`actual sparse primary PCM survives rests and dense high-band articulation at ${renderHz} renderer Hz`, () => {
    const result = replay(renderHz);
    const mean = (low, high) => {
      const rows = result.rows.filter((row) => row.time > low && row.time < high);
      return rows.reduce((sum, row) => sum + row.bpm, 0) / rows.length;
    };
    const early = mean(1.6, 4.2),
      late = mean(6.2, 8.8);
    assert.ok(result.quietWithHistory > 10, 'short rests keep genuine interval and zero-envelope history');
    assert.ok(Math.abs(late - early) < early * 0.15, `sparse ${early}, dense ${late}`);
    assert.ok(
      Math.abs(result.clock.getState().targetBpm - 60 / 0.65) < 2,
      JSON.stringify(result.clock.getState()),
    );
    assert.equal(
      result.hits.length,
      fixtures.references[1].hits.length,
      'independent instantaneous drum response remains intact',
    );
    assert.ok(
      result.hits.every(
        (row, index) =>
          row.time >= fixtures.references[1].hits[index].time - 0.005 &&
          row.time - fixtures.references[1].hits[index].time < 0.075,
      ),
    );
  });

test('long actual silence and explicit source reset still remove remembered primary evidence', () => {
  const { detector } = replay(60);
  let result;
  for (let frame = 0; frame < 3 * 90; frame++)
    result = detector.process({ spectrum: new Float32Array(1024), rms: 0, time: 10 + frame / 90 });
  assert.equal(result.silent, 1);
  assert.equal(result.bpm, 0);
  assert.equal(result.beat, 0);
  assert.equal(detector.fullBpm, 0);
  assert.equal(detector.fullOnsetObservations.length, 0);
  assert.ok(Object.values(detector.rhythm.histories).every((history) => !history.length));
  const supported = replay(60).detector;
  assert.ok(supported.fullBpm > 0);
  supported.reset();
  assert.equal(supported.fullBpm, 0);
  assert.equal(supported.primaryTempoPrior, null);
  assert.ok(Object.values(supported.rhythm.histories).every((history) => !history.length));
});
