import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoPcm } from '../src/audio/demo-music.js';
test('three original music styles are finite, bounded and reproducible', () => {
  for (const profile of ['bass', 'balanced', 'bright']) {
    const result = createDemoPcm(profile, 12000),
      again = createDemoPcm(profile, 12000);
    assert.deepEqual(result.samples, again.samples);
    assert.ok(result.samples.every((x) => Number.isFinite(x) && Math.abs(x) <= 0.48));
    assert.ok(result.samples.some((x) => Math.abs(x) > 0.05));
    assert.equal(Math.abs(result.samples[0]), 0);
    assert.ok(Math.abs(result.samples.at(-1)) < 0.005);
    assert.ok(Math.abs(result.duration - (60 / result.bpm) * 16) < 0.001);
  }
});
test('styles contain measurably distinct waveforms and evolving energy', () => {
  const results = ['bass', 'balanced', 'bright'].map((p) => createDemoPcm(p, 16000));
  const roughness = ({ samples: s }) => {
    let v = 0,
      n = 0;
    for (let i = 1; i < s.length; i++) {
      v += Math.abs(s[i] - s[i - 1]);
      n += Math.abs(s[i]);
    }
    return v / n;
  };
  assert.ok(roughness(results[2]) > roughness(results[0]) * 1.3);
  for (const { samples: s } of results) {
    let first = 0,
      last = 0;
    for (let i = 0; i < s.length; i++) {
      if (i < s.length / 2) first += s[i] * s[i];
      else last += s[i] * s[i];
    }
    assert.ok(last > first * 1.4);
  }
});
