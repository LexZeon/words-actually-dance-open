import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicDelivery } from '../src/audio/music-delivery.js';

const features = (sequence, extra = {}) => ({
  silent: 0,
  signalValid: 1,
  energy: 0.5,
  attack: 0.7,
  amplitudeRise: 0,
  amplitudeTrend: 0,
  sourceGeneration: 1,
  drum: { hit: true, sequence },
  ...extra,
});

test('delivery follows observed density independently of claimed BPM and bounds its reading multiplier', () => {
  const sparse = new MusicDelivery(),
    dense = new MusicDelivery();
  let sparseSequence = 0,
    denseSequence = 0;
  for (let i = 0; i < 240; i++) {
    const time = i / 60;
    const sparseHit = i % 30 === 0,
      denseHit = i % 8 === 0;
    if (sparseHit) sparseSequence++;
    if (denseHit) denseSequence++;
    sparse.update(
      features(sparseSequence, { bpm: 300, drum: { sequence: sparseSequence, hit: sparseHit } }),
      time,
    );
    dense.update(
      features(denseSequence, { bpm: 30, drum: { sequence: denseSequence, hit: denseHit } }),
      time,
    );
  }
  assert.ok(dense.getState().drive > sparse.getState().drive + 0.5);
  assert.equal(dense.getState().mode, 'intense');
  assert.ok(dense.getState().readingMultiplier > 1 && dense.getState().readingMultiplier <= 1.75);
  assert.equal(dense.getState().source, 'observed-audio');
  assert.equal(dense.getState().interpretation, 'onset-density-and-energy-proxy');
});

test('cached drum frames and a sustained amplitude rise do not duplicate delivery onsets', () => {
  const delivery = new MusicDelivery();
  for (let i = 0; i < 30; i++) delivery.update(features(7, { amplitudeRise: 0.6 }), i / 60);
  assert.equal(delivery.getState().density, 1 / 1.6);
  delivery.update(features(8, { amplitudeRise: 0 }), 0.6);
  assert.equal(delivery.getState().density, 2 / 1.6);
  delivery.update(features(8, { amplitudeRise: 0.6, drum: { hit: false, sequence: 8 } }), 0.7);
  assert.equal(delivery.getState().density, 3 / 1.6);
});

test('manual pause preserves drive and resumes its prior density while discarding cached paused hits', () => {
  const delivery = new MusicDelivery();
  for (let i = 0; i < 18; i++) delivery.update(features(i), i * 0.09);
  const before = delivery.getState();
  delivery.update(features(20), 1.53, { paused: true });
  assert.deepEqual(delivery.getState(), before);
  delivery.update(features(21), 50, { paused: true });
  assert.deepEqual(delivery.getState(), before);
  delivery.update(features(21), 100);
  assert.deepEqual(delivery.getState(), before);
  delivery.update(features(22), 100.1);
  assert.ok(delivery.getState().drive > 0.6);
});

test('the first source observed while paused is consumed rather than replayed on resume', () => {
  const delivery = new MusicDelivery();
  delivery.update(features(7), 0, { paused: true });
  delivery.update(features(7), 10);
  assert.equal(delivery.getState().density, 0);
  delivery.update(features(8), 10.1);
  assert.equal(delivery.getState().density, 1 / 1.6);
});

test('invalid audio and internal pulses cannot raise delivery drive and source changes start independent evidence', () => {
  const delivery = new MusicDelivery();
  for (let i = 0; i < 10; i++) delivery.update(features(i), i * 0.1);
  const active = delivery.getState();
  delivery.update(features(12, { sourceGeneration: 2, drum: { hit: false, sequence: 12 } }), 2);
  assert.equal(delivery.getState().density, 0);
  assert.equal(delivery.getState().drive, 0);
  for (let i = 0; i < 180; i++)
    delivery.update(
      features(13, { signalValid: 0, beat: 1, amplitudeRise: 1, amplitudeTrend: 1 }),
      2 + i / 60,
    );
  assert.equal(delivery.getState().density, 0);
  assert.equal(delivery.getState().drive, 0);
  assert.ok(active.drive > 0);
});

test('silent decay is finite and invalid time never changes delivery state', () => {
  const delivery = new MusicDelivery();
  for (let i = 0; i < 10; i++) delivery.update(features(i), i * 0.1);
  const before = delivery.getState();
  delivery.update(features(999), NaN);
  assert.deepEqual(delivery.getState(), before);
  for (let i = 0; i < 300; i++)
    delivery.update(features(11, { silent: 1, drum: { hit: false, sequence: 11 } }), 1 + i / 60);
  assert.ok(delivery.getState().drive < 0.005);
  assert.equal(delivery.getState().density, 0);
});
