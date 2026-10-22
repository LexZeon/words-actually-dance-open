import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatDetector } from '../src/audio/beat-detector.js';
import { pcmRhythm } from './helpers/pcm-rhythm.mjs';

const fixtures = [
  { bpm: 120, subdivisionGain: 0.15, mainMidGain: 0.3, bassGain: 0.12 },
  { bpm: 80, subdivisionGain: 0.15, mainMidGain: 0.3, bassGain: 0.12 },
  { bpm: 67, subdivisionGain: 0.15, mainMidGain: 0.3, bassGain: 0.12 },
  { bpm: 67, subdivisionGain: 0.06, mainMidGain: 0.5, bassGain: 0 },
  { bpm: 160, subdivisionGain: 0, mainMidGain: 0.3, bassGain: 0 },
];
for (const options of fixtures)
  test(`PCM primary ${options.bpm} with ${options.subdivisionGain ? 'denser subdivisions' : 'genuine fast pulses'} keeps evidence-based primary tempo`, () => {
    const signal = pcmRhythm({ ...options, seconds: 30 });
    const detector = new BeatDetector();
    const settled = [],
      diagnostics = [];
    const observedErrors = [];
    for (let frame = 0; frame < 30 * 90; frame++) {
      const time = frame / 90,
        features = detector.process(signal.frame(time));
      if (time >= 24 && features.confidence >= 0.3) {
        settled.push(features);
        diagnostics.push(detector.getDiagnostics().tempoHypotheses);
        if (features.beat) observedErrors.push(Math.min(...signal.hits.map((hit) => Math.abs(time - hit))));
      }
    }
    assert.ok(settled.length > 500);
    assert.ok(
      settled.every((row) => Math.abs(row.bpm - options.bpm) < 3),
      'must not double all the weak-bass slow primary pulses or halve equal fast ones',
    );
    assert.equal(
      detector.getDiagnostics().tempoReacquisitions,
      0,
      'subdivisions cannot masquerade as a new song',
    );
    assert.ok(observedErrors.length >= 5, 'primary tempo must include measured primary attacks');
    assert.ok(
      observedErrors.every((error) => error < 0.06),
      'selected primary must land on audible primary attacks',
    );
    if (options.bpm < 110 && options.subdivisionGain) {
      assert.ok(
        diagnostics.some((row) => row.ambiguity && Math.abs(row.subdivisionBpm - options.bpm * 2) < 3),
      );
      assert.ok(diagnostics.some((row) => row.reason !== 'regular-pulse'));
    }
    if (options.bpm === 160) assert.ok(diagnostics.every((row) => row.reason === 'regular-pulse'));
  });
