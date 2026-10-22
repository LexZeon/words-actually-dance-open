import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeDrumResponse } from '../src/visuals/knowledge-drum-response.js';

const hit = (time, sequence = 1, kind = 'thump', weight = 0.8, extra = {}) => ({
  time,
  sourceGeneration: 1,
  audioSilent: 0,
  signalValid: 1,
  drum: { hit: true, sequence, kind, weight, strength: 0.8, confidence: 0.8 },
  ...extra,
});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function surface({
  reducedMotion = false,
  trackBox = { top: 40, bottom: 80 },
  stageBox = { top: 0, bottom: 140 },
} = {}) {
  const element = () => ({
    style: { transform: 'rotate(8deg)', translate: '', scale: '', filter: '' },
    getBoundingClientRect: () => ({ ...trackBox }),
  });
  const track = element(),
    spotlight = element();
  const host = {
    getBoundingClientRect: () => ({ ...stageBox }),
    ownerDocument: { defaultView: { matchMedia: () => ({ matches: reducedMotion }) } },
  };
  return { track, spotlight, current: { track, spotlight }, host };
}

test('knowledge drum kinds produce different restrained reading poses with stronger heavy impacts', () => {
  const poses = {};
  for (const kind of ['thump', 'snap', 'tick']) {
    const response = new KnowledgeDrumResponse();
    response.update(hit(1, 1, kind));
    poses[kind] = response.sample(1.024);
    assert.ok(poses[kind].scaleY > 0.9 && poses[kind].scaleY <= 1);
    assert.ok(poses[kind].brightness > 1 && poses[kind].brightness <= 1.24);
    assert.ok(Math.abs(poses[kind].y) <= 5.5);
  }
  assert.ok(poses.thump.y > 0 && poses.snap.y < 0 && poses.tick.y < 0);
  assert.ok(Math.abs(poses.tick.y) < Math.abs(poses.snap.y));
  assert.ok(poses.thump.scaleY < poses.snap.scaleY && poses.snap.scaleY < poses.tick.scaleY);
  const light = new KnowledgeDrumResponse(),
    heavy = new KnowledgeDrumResponse();
  light.update(hit(1, 1, 'thump', 0.15));
  heavy.update(hit(1, 1, 'thump', 0.95));
  assert.ok(heavy.sample(1.024).y > light.sample(1.024).y * 2);
});

test('finite knowledge accents peak promptly and never restart for a cached sequence', () => {
  const response = new KnowledgeDrumResponse();
  response.update(hit(1));
  close(response.sample(1).envelope, 0);
  assert.ok(response.sample(1.016).envelope > 0.7);
  close(response.sample(1.024).envelope, 1);
  const before = response.sample(1.1);
  response.update(hit(1.1));
  assert.deepEqual(response.sample(1.1), before);
  assert.equal(response.sample(2).envelope, 0);
  assert.equal(response.sample(20).envelope, 0);
});

test('a following dense hit inherits the current pose continuously and then moves into its own kind', () => {
  const response = new KnowledgeDrumResponse();
  response.update(hit(1, 1, 'thump', 0.9));
  const before = response.sample(1.08);
  response.update(hit(1.08, 2, 'snap', 0.6));
  const initial = response.sample(1.08);
  close(initial.y, before.y);
  close(initial.scaleY, before.scaleY);
  close(initial.brightness, before.brightness);
  assert.ok(response.sample(1.104).y < 0);
});

test('knowledge pause freezes the exact pose and consumes hits that must not replay after resume', () => {
  const response = new KnowledgeDrumResponse();
  response.update(hit(1));
  response.update({ ...hit(1.024), drum: { hit: false, sequence: 1 } });
  const before = response.sample(1.024);
  response.update(hit(5, 2, 'snap'), { paused: true });
  assert.deepEqual(response.sample(100), before);
  response.update(hit(100, 2, 'snap'));
  assert.deepEqual(response.sample(100), before);
  response.update(hit(100.02, 3, 'snap'));
  assert.equal(response.sample(100.044).kind, 'snap');
  assert.ok(response.sample(100.044).y < 0);
});

test('a first paused source frame cannot replay its cached old impact after resume', () => {
  const response = new KnowledgeDrumResponse();
  response.update(hit(0, 7), { paused: true });
  response.update(hit(10, 7));
  assert.equal(response.sample(10.024).envelope, 0);
  response.update(hit(10.04, 8));
  assert.ok(response.sample(10.064).envelope > 0.99);
});

test('actual track styles retain existing effect transforms and restore on track change and clear', () => {
  const response = new KnowledgeDrumResponse(),
    { current, host, track } = surface();
  Object.assign(track.style, { translate: '2px 3px', scale: '1.05', filter: 'blur(1px)' });
  const saved = { ...track.style };
  response.update(hit(1));
  response.frame(current, host, 1.024);
  assert.equal(track.style.transform, 'rotate(8deg)');
  assert.notEqual(track.style.translate, saved.translate);
  assert.ok(Number(track.style.scale.split(' ')[1]) < 1);
  assert.ok(track.style.filter.startsWith('brightness('));
  const next = surface();
  response.frame(next.current, next.host, 1.04);
  assert.deepEqual(track.style, saved);
  response.clear();
  assert.equal(next.track.style.translate, '');
  assert.equal(next.track.style.scale, '');
  assert.equal(next.track.style.filter, '');
  assert.equal(response.getState().active, false);
});

test('pop and flash accents change their visible spotlight while normal text changes the reading track', () => {
  for (const effect of ['pop', 'flash', 'typewriter']) {
    const response = new KnowledgeDrumResponse(),
      { current, host, track, spotlight } = surface();
    response.update(hit(1));
    response.frame(current, host, 1.024, effect);
    const visible = effect === 'typewriter' ? track : spotlight,
      other = visible === track ? spotlight : track;
    assert.notEqual(visible.style.scale, '');
    assert.equal(other.style.scale, '');
    response.clear();
    assert.equal(visible.style.scale, '');
  }
});

test('available viewport space limits movement and reduced motion keeps a smaller visible accent', () => {
  const tight = surface({ trackBox: { top: 3, bottom: 138 }, stageBox: { top: 0, bottom: 140 } });
  const normal = surface(),
    reduced = surface({ reducedMotion: true });
  const make = (s) => {
    const response = new KnowledgeDrumResponse();
    response.update(hit(1, 1, 'thump', 1));
    response.frame(s.current, s.host, 1.024);
    return response.getState();
  };
  const a = make(tight),
    b = make(normal),
    c = make(reduced);
  assert.equal(a.pose.y, 0);
  assert.equal(a.maxTravelPx, 0);
  assert.ok(Math.abs(c.pose.y) < Math.abs(b.pose.y) * 0.2);
  assert.ok(c.pose.scaleY > b.pose.scaleY && c.pose.scaleY <= 1);
});

test('silent signal clears a visible accent and a source change cannot inherit the previous pose', () => {
  const response = new KnowledgeDrumResponse();
  response.update(hit(1));
  response.update(hit(1.05, 1, 'thump', 0.8, { audioSilent: 1 }));
  assert.equal(response.sample(1.05).envelope, 0);
  response.update(hit(2, 2, 'snap', 0.6, { sourceGeneration: 2 }));
  close(response.sample(2).y, 0);
  assert.ok(response.sample(2.024).y < 0);
});

test('an impact observed on an invalid signal is consumed and never becomes a delayed valid accent', () => {
  const response = new KnowledgeDrumResponse();
  response.update(hit(1, 7, 'thump', 0.8, { signalValid: 0 }));
  assert.equal(response.sample(1.024).envelope, 0);
  response.update(hit(2, 7));
  assert.equal(response.sample(2.024).envelope, 0);
  response.update(hit(2.05, 8));
  assert.ok(response.sample(2.074).envelope > 0.99);
});
