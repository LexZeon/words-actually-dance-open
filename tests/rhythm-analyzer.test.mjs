import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { RhythmAnalyzer } from '../src/audio/rhythm/rhythm-analyzer.js';
import { BeatDetector } from '../src/audio/beat-detector.js';

// Harmonic spectra with soft note crossfades and constant RMS: no kick, bass,
// snare or drum-envelope pulses. These are mechanics tests, not song accuracy.
function harmonicSpectrum(frequency) {
  const spectrum = new Float32Array(1024);
  for (let harmonic = 1; harmonic <= 6; harmonic++) {
    const position = (frequency * harmonic) / (48000 / 2048);
    const left = Math.floor(position),
      fraction = position - left;
    if (left + 1 < spectrum.length) {
      spectrum[left] += (0.2 / harmonic) * (1 - fraction);
      spectrum[left + 1] += (0.2 / harmonic) * fraction;
    }
  }
  return spectrum;
}

function melodicTrack({
  bpm = 96,
  secondBpm = bpm,
  switchAt = 12,
  seconds = 26,
  jitter = 0,
  irregular = false,
} = {}) {
  const notes = [261.63, 329.63, 392, 293.66, 440, 349.23];
  const onsets = [];
  let next = 0.3,
    index = 0,
    seed = 83216;
  while (next < seconds) {
    onsets.push(next + jitter * Math.sin(index * 1.7));
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    next += irregular ? 0.28 + (seed / 4294967296) * 0.85 : 60 / (next < switchAt ? bpm : secondBpm);
    index++;
  }
  const detector = new BeatDetector(),
    analyzer = new RhythmAnalyzer(),
    frames = [];
  let noteIndex = -1,
    previous = null;
  for (let frame = 0; frame < seconds * 60; frame++) {
    const time = frame / 60;
    while (onsets[noteIndex + 1] <= time) noteIndex++;
    const vibrato = 1 + 0.002 * Math.sin(time * 32);
    const old = harmonicSpectrum(notes[(noteIndex + notes.length - 1) % notes.length] * vibrato);
    const current = harmonicSpectrum(notes[Math.max(0, noteIndex) % notes.length] * vibrato);
    const blend = noteIndex < 0 ? 1 : Math.min(1, (time - onsets[noteIndex]) / 0.2);
    let spectrum = Float32Array.from(current, (value, bin) => old[bin] * (1 - blend) + value * blend);
    if (previous) spectrum = Float32Array.from(spectrum, (value, bin) => previous[bin] * 0.45 + value * 0.55);
    previous = spectrum;
    const input = { spectrum, time, rms: 0.15 };
    frames.push({ time, features: detector.process(input), analysis: analyzer.process(input) });
  }
  return { frames, detector, analyzer, onsets };
}

test('soft harmonic note changes support a rhythm without low-frequency drums', () => {
  const { frames, detector } = melodicTrack({ seconds: 18 });
  const final = frames.at(-1);
  assert.equal(final.analysis.candidates.bass, null);
  assert.ok(['spectral', 'harmonic'].includes(final.analysis.candidate?.source));
  assert.ok(Math.abs(final.features.bpm - 96) <= 2, 'BPM ' + final.features.bpm);
  assert.ok(final.features.confidence > 0.65);
  assert.ok(frames.filter((frame) => frame.features.beat).length > 18);
  assert.ok(['spectral', 'harmonic'].includes(detector.getDiagnostics().source));
});

test('melodic rhythm adapts after a genuine tempo change rather than holding its first period', () => {
  const { frames } = melodicTrack({ bpm: 96, secondBpm: 128, switchAt: 12, seconds: 27 });
  const before = frames[10 * 60].features;
  const final = frames.at(-1).features;
  assert.ok(Math.abs(before.bpm - 96) <= 3, 'first BPM ' + before.bpm);
  assert.ok(Math.abs(final.bpm - 128) <= 4, 'second BPM ' + final.bpm);
  assert.ok(final.confidence >= 0.5);
});

test('modest note timing jitter retains harmonic/spectral tempo support', () => {
  const { frames } = melodicTrack({ seconds: 18, jitter: 0.02 });
  const final = frames.at(-1).features;
  assert.ok(Math.abs(final.bpm - 96) <= 4, 'BPM ' + final.bpm);
  assert.ok(final.confidence > 0.5);
});

test('a sustained vibrato tone does not become a confident slower beat through octave aliasing', () => {
  const detector = new BeatDetector();
  let previous = null,
    beats = 0;
  for (let frame = 0; frame < 18 * 60; frame++) {
    const time = frame / 60;
    let spectrum = harmonicSpectrum(440 * (1 + 0.01 * Math.sin(2 * Math.PI * 5.5 * time)));
    if (previous) spectrum = Float32Array.from(spectrum, (value, bin) => previous[bin] * 0.45 + value * 0.55);
    previous = spectrum;
    const features = detector.process({ spectrum, time, rms: 0.15 });
    beats += features.beat;
    assert.equal(features.bpm, 0);
    assert.equal(features.confidence, 0);
  }
  assert.ok(beats <= 1, 'at most one initial measured attack');
});

test('irregular vocal-style note changes are not treated as a stable fixed meter', () => {
  const { frames } = melodicTrack({ seconds: 24, irregular: true });
  const confident = frames.filter((frame) => frame.features.confidence >= 0.5).length / frames.length;
  assert.ok(confident < 0.25, 'confident fraction ' + confident);
});

const isolatedTrace = new URL('../artifacts/live-music-qiansixi-isolated-trace.json', import.meta.url);
test(
  'optional specified-video trace does not briefly switch octaves during its supported steady segment',
  { skip: !existsSync(isolatedTrace) },
  () => {
    const rows = JSON.parse(readFileSync(isolatedTrace, 'utf8'));
    const detector = new BeatDetector({
      sampleRate: rows[0].sampleRate || 48000,
      fftSize: rows[0].fftSize || 2048,
    });
    const supported = [];
    for (const row of rows) {
      const features = detector.process({ ...row, spectrum: Float32Array.from(row.spectrum) });
      const relativeTime = row.time - rows[0].time;
      if (relativeTime >= 5 && relativeTime <= 25 && features.confidence >= 0.3) supported.push(features.bpm);
    }
    assert.ok(supported.length > 100);
    const sorted = [...supported].sort((a, b) => a - b),
      center = sorted[Math.floor(sorted.length / 2)];
    assert.ok(
      sorted[0] > center * 0.7 && sorted.at(-1) < center * 1.3,
      'a short cross-lane octave alternative must not replace the supported steady tempo',
    );
    // This verifies candidate stability, not a ground-truth song BPM or accuracy.
  },
);
