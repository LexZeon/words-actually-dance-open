import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { BeatDetector } from '../src/audio/beat-detector.js';

// These are deterministic synthetic FFT streams. They verify mechanics and
// bounds, not the accuracy of beat tracking on recordings of real music.
function track({
  bpm = 120,
  seconds = 12,
  jitter = 0,
  amplitude = () => 0.8,
  gain = 1,
  fftSmoothing = 0,
} = {}) {
  const detector = new BeatDetector();
  const period = 60 / bpm;
  const hits = [];
  for (let i = 0; i < seconds / period; i++) hits.push(0.3 + i * period + jitter * Math.sin(i * 1.7));
  const results = [];
  let hitIndex = 0;
  let lastHit = -Infinity;
  let previousSpectrum = new Float32Array(1024);
  for (let frame = 0; frame < seconds * 60; frame++) {
    const time = frame / 60;
    while (hits[hitIndex] <= time) lastHit = hits[hitIndex++];
    const pulse = Math.exp(-(time - lastHit) / 0.075) * amplitude(hitIndex);
    const spectrum = new Float32Array(1024);
    for (let bin = 2; bin <= 9; bin++) spectrum[bin] = pulse * gain;
    for (let bin = 20; bin <= 40; bin++) spectrum[bin] = pulse * 0.25 * gain;
    if (fftSmoothing) {
      for (let bin = 0; bin < spectrum.length; bin++)
        spectrum[bin] = previousSpectrum[bin] * fftSmoothing + spectrum[bin] * (1 - fftSmoothing);
      previousSpectrum = spectrum;
    }
    results.push(detector.process({ spectrum, time, rms: (0.025 + pulse * 0.4) * gain }));
  }
  return { detector, results, hitCount: hits.length };
}

for (const bpm of [120, 90]) {
  test(`synthetic ${bpm} BPM pulses settle to the correct tempo`, () => {
    const { results, hitCount } = track({ bpm });
    const final = results.at(-1);
    const beats = results.filter((result) => result.beat).length;
    assert.ok(Math.abs(final.bpm - bpm) < 2, `BPM ${final.bpm}`);
    assert.ok(final.confidence > 0.8, `confidence ${final.confidence}`);
    assert.ok(Math.abs(beats - hitCount) <= 1, `detected ${beats} of ${hitCount}`);
    const initial = results.find((result) => result.bpm > 0);
    assert.ok(initial.confidence < 0.3);
  });
}

test('silence never creates beats or a tempo', () => {
  const detector = new BeatDetector();
  for (let frame = 0; frame < 600; frame++) {
    const result = detector.process({ spectrum: new Float32Array(1024), time: frame / 60, rms: 0 });
    assert.equal(result.beat, 0);
    assert.equal(result.bpm, 0);
    assert.equal(result.phase, 0);
    assert.equal(result.silent, 1);
  }
});

test('a sustained single tone does not become a train of beats', () => {
  const detector = new BeatDetector();
  const spectrum = new Float32Array(1024);
  spectrum[19] = 0.7;
  for (let frame = 0; frame < 600; frame++) {
    const result = detector.process({ spectrum, time: frame / 60, rms: 0.2 });
    assert.equal(result.beat, 0);
    assert.equal(result.bpm, 0);
  }
});

test('varying pulse amplitude and modest timing jitter retain useful tempo confidence', () => {
  const { results } = track({ jitter: 0.025, amplitude: (i) => 0.35 + (0.4 * (1 + Math.sin(i * 0.8))) / 2 });
  const result = results.at(-1);
  assert.ok(Math.abs(result.bpm - 120) < 4, `BPM ${result.bpm}`);
  assert.ok(result.confidence > 0.6, `confidence ${result.confidence}`);
});

test('silence after a rhythm suppresses prediction and clears stale tempo', () => {
  const { detector } = track();
  let result;
  for (let frame = 0; frame < 120; frame++) {
    result = detector.process({ spectrum: new Float32Array(1024), time: 12 + frame / 60, rms: 0 });
    assert.equal(result.beat, 0);
  }
  assert.equal(result.silent, 1);
  assert.equal(result.bpm, 0);
  assert.equal(result.phase, 0);
  assert.equal(result.confidence, 0);
});

test('all feature values stay finite and normalized', () => {
  const { results } = track();
  for (const result of results) {
    for (const [key, value] of Object.entries(result)) {
      assert.ok(Number.isFinite(value), `${key} must be finite`);
      if (key !== 'bpm') assert.ok(value >= 0 && value <= 1, `${key} is ${value}`);
    }
  }
});

test('slow loudness drift and tiny FFT jitter do not produce false beats', () => {
  const detector = new BeatDetector();
  let beats = 0;
  for (let frame = 0; frame < 600; frame++) {
    const spectrum = new Float32Array(1024);
    const amplitude = 0.15 + frame * 0.0002;
    for (let bin = 2; bin <= 9; bin++) spectrum[bin] = amplitude + 0.0001 * Math.sin(frame * 0.7 + bin);
    const result = detector.process({ spectrum, time: frame / 60, rms: amplitude * 0.4 });
    beats += result.beat;
  }
  assert.equal(beats, 0);
});

for (const gain of [0.01, 0.002]) {
  test(`low-volume synthetic pulses retain tempo with FFT smoothing at gain ${gain}`, () => {
    const { results, hitCount } = track({ bpm: 108, gain, fftSmoothing: 0.45 });
    const result = results.at(-1);
    const beats = results.filter((entry) => entry.beat).length;
    assert.ok(Math.abs(result.bpm - 108) < 2, `BPM ${result.bpm}`);
    assert.ok(result.confidence > 0.8, `confidence ${result.confidence}`);
    assert.ok(Math.abs(beats - hitCount) <= 1, `detected ${beats} of ${hitCount}`);
    assert.ok(
      results.slice(20).every((entry) => !entry.silent),
      'quiet inter-beat audio must not reset tempo',
    );
    assert.ok(result.bass > 0.1, 'perceptual band features should remain useful at low gain');
  });
}

test('noise below the RMS floor cannot produce beats from random spectral changes', () => {
  const detector = new BeatDetector();
  let seed = 12;
  for (let frame = 0; frame < 600; frame++) {
    const spectrum = new Float32Array(1024);
    for (let bin = 1; bin < spectrum.length; bin++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      spectrum[bin] = (seed / 0xffffffff) * 0.000001;
    }
    const result = detector.process({ spectrum, time: frame / 60, rms: 0.000004 });
    assert.equal(result.beat, 0);
    assert.equal(result.bpm, 0);
    assert.equal(result.silent, 1);
  }
});

test('a quiet sustained tone with FFT rounding jitter has no repeating beats', () => {
  const detector = new BeatDetector();
  for (let frame = 0; frame < 600; frame++) {
    const spectrum = new Float32Array(1024);
    spectrum[19] = 0.0002 + 0.00000005 * Math.sin(frame * 0.5);
    const result = detector.process({ spectrum, time: frame / 60, rms: 0.0003 });
    assert.equal(result.beat, 0);
    assert.equal(result.bpm, 0);
  }
});

test('undersampled one-second snapshots cannot alias into a false tempo', () => {
  const detector = new BeatDetector();
  for (let frame = 0; frame < 12; frame++) {
    const spectrum = new Float32Array(1024);
    for (let bin = 2; bin <= 9; bin++) spectrum[bin] = frame % 2 ? 0.01 : 0.003;
    const result = detector.process({ spectrum, time: frame, rms: frame % 2 ? 0.04 : 0.02 });
    assert.equal(result.bpm, 0);
    assert.equal(result.confidence, 0);
    assert.equal(result.beat, 0);
  }
});

test('independent bass rhythm resists irregular louder midrange attacks', () => {
  const detector = new BeatDetector();
  let previousSpectrum = new Float32Array(1024);
  const irregularHits = [
    0.12, 0.83, 1.21, 1.98, 2.43, 3.06, 3.4, 4.19, 4.53, 5.17, 5.93, 6.31, 7.1, 7.44, 8.15, 8.6, 9.21, 9.63,
    10.4, 10.73, 11.42,
  ];
  let lastNoise = -Infinity,
    noiseIndex = 0;
  let result;
  const observed = [];
  for (let frame = 0; frame < 12 * 60; frame++) {
    const time = frame / 60;
    while (irregularHits[noiseIndex] <= time) lastNoise = irregularHits[noiseIndex++];
    const age = (time + 0.5 - 0.3) % 0.5;
    const bass = time < 0.3 ? 0.003 : 0.003 + 0.17 * Math.exp(-age / 0.08);
    const noise = 0.004 + 0.7 * Math.exp(-(time - lastNoise) / 0.1);
    const spectrum = new Float32Array(1024);
    for (let bin = 2; bin <= 4; bin++) spectrum[bin] = bass;
    for (let bin = 8; bin <= 55; bin++) spectrum[bin] = noise;
    for (let bin = 0; bin < spectrum.length; bin++)
      spectrum[bin] = previousSpectrum[bin] * 0.45 + spectrum[bin] * 0.55;
    previousSpectrum = spectrum;
    result = detector.process({ spectrum, time, rms: Math.min(1, bass + noise) * 0.4 });
    if (result.beat && result.confidence >= 0.3) observed.push(time);
  }
  assert.ok(Math.abs(result.bpm - 120) <= 3, `BPM ${result.bpm}`);
  assert.ok(result.confidence >= 0.3, `confidence ${result.confidence}`);
  assert.ok(observed.length >= 5, 'must emit observed attacks after the bass candidate learns');

  // A learned periodic model may survive briefly, but it cannot turn a steady
  // spectrum into timed beats once actual rising attacks have stopped.
  for (let frame = 0; frame < 120; frame++) {
    const spectrum = previousSpectrum.slice();
    result = detector.process({ spectrum, time: 12 + frame / 60, rms: 0.04 });
    assert.equal(result.beat, 0);
  }
});

// This ignored local artifact contains a captured, self-generated reference
// mixed with the machine's output. Nothing from the capture is committed, and
// clean checkouts skip the optional regression rather than requiring user data.
const loopbackTrace = new URL('../artifacts/loopback-trace.json', import.meta.url);
test(
  'optional captured external 108 BPM reference retains its low-frequency rhythm',
  { skip: !existsSync(loopbackTrace) },
  () => {
    const rows = JSON.parse(readFileSync(loopbackTrace, 'utf8'));
    const detector = new BeatDetector();
    let result,
      observed = 0;
    for (const row of rows) {
      result = detector.process({ ...row, spectrum: Float32Array.from(row.spectrum) });
      if (result.beat && result.confidence >= 0.3) observed++;
    }
    assert.ok(Math.abs(result.bpm - 108) <= 4, `BPM ${result.bpm}`);
    assert.ok(result.confidence >= 0.4, `confidence ${result.confidence}`);
    assert.ok(observed >= 2, `observed ${observed} usable beats`);
  },
);
