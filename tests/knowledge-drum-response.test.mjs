import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
    assert.ok(poses[kind].brightness >= 1 && poses[kind].brightness <= 1.24);
    assert.ok(Math.abs(poses[kind].y) <= 5.5);
  }
  assert.ok(poses.thump.y > 0 && poses.snap.y < 0 && poses.tick.y === 0);
  assert.ok(
    poses.tick.focusScale > 1,
    'A tick stays on the focused keyword instead of moving the whole sentence',
  );
  assert.equal(poses.tick.brightness, 1, 'A hat cannot flash the entire reading track');
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
  close(response.sample(1).envelope, 1);
  assert.ok(response.sample(1.016).envelope > 0.7);
  assert.ok(response.sample(1.024).envelope < response.sample(1).envelope);
  const before = response.sample(1.1);
  response.update(hit(1.1));
  assert.deepEqual(response.sample(1.1), before);
  assert.equal(response.sample(2).envelope, 0);
  assert.equal(response.sample(20).envelope, 0);
});

test('a following real body hit responds in its own direction immediately without stacking previous impacts', () => {
  const response = new KnowledgeDrumResponse();
  response.update(hit(1, 1, 'thump', 0.9));
  const before = response.sample(1.08);
  response.update(hit(1.08, 2, 'snap', 0.6));
  const initial = response.sample(1.08);
  assert.ok(before.y > 0 && initial.y < 0);
  const isolated = new KnowledgeDrumResponse();
  isolated.update(hit(1.08, 2, 'snap', 0.6));
  assert.deepEqual(initial, isolated.sample(1.08));
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
  for (const key of ['y', 'scaleY', 'focusScale', 'brightness', 'envelope'])
    close(response.sample(100)[key], before[key]);
  assert.equal(response.sample(100).kind, before.kind);
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
  close(response.sample(10.04).envelope, 1);
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

test('pure ticks in pop and flash scale the actually visible fragment instead of a hidden keyword wrapper', () => {
  for (const effect of ['pop', 'flash']) {
    const response = new KnowledgeDrumResponse(),
      { current, host, track, spotlight } = surface();
    track.style.opacity = '0'; // The real effect CSS hides this entire reading tree.
    const hiddenKeyword = { style: { scale: '1.09' } };
    current.featuredMarker = { els: [hiddenKeyword] };
    spotlight.textContent = '节拍';
    response.update(hit(1, 1, 'tick', 0.8));
    response.frame(current, host, 1, effect);
    const [x, y] = spotlight.style.scale.split(' ').map(Number);
    assert.ok(x > 1.005 && x <= 1.018, 'A pure tick visibly changes the displayed fragment width');
    close(x, y);
    assert.equal(spotlight.style.translate, '0px 0.0000px', 'A hat cannot move a whole sentence');
    assert.equal(spotlight.style.filter, 'brightness(1.00000)');
    assert.equal(hiddenKeyword.style.scale, '1.09', 'A hidden keyword must not count as the focus target');
    assert.equal(track.style.scale, '');
    assert.deepEqual(
      response.focus.map(({ node }) => node),
      [spotlight],
    );
    assert.equal(response.getState().presentation.target, 'spotlight');
    close(response.getState().presentation.scaleX, response.pose.focusScale);
    response.clear();
    assert.equal(spotlight.style.scale, '');
    assert.equal(hiddenKeyword.style.scale, '1.09');
  }
});

test('spotlight body compression and local focus compose once, and changing modes restores both real targets', () => {
  const response = new KnowledgeDrumResponse(),
    { current, host, track, spotlight } = surface();
  const keyword = { style: { scale: '1.03' } };
  current.featuredMarker = { els: [keyword] };
  Object.assign(spotlight.style, { scale: '1.04 1.02', filter: 'blur(1px)', translate: '2px 3px' });
  const saved = { ...spotlight.style };
  response.update(hit(1, 1, 'thump', 0.9));
  response.frame(current, host, 1, 'pop');
  const actual = spotlight.style.scale.split(' ').map(Number);
  const pose = response.getState().pose;
  assert.ok(Math.abs(actual[0] - pose.focusScale) < 0.00001);
  assert.ok(Math.abs(actual[1] - pose.focusScale * pose.scaleY) < 0.00001);
  assert.ok(actual[1] < actual[0], 'The focus write cannot overwrite the grounded compression');
  assert.equal(spotlight.style.transform, saved.transform, 'Existing CSS transforms remain independent');
  assert.equal(keyword.style.scale, '1.03');
  response.frame(current, host, 1.02, 'typewriter');
  assert.deepEqual(spotlight.style, saved);
  assert.equal(response.getState().presentation.target, 'reading-track');
  assert.ok(Number(keyword.style.scale) > 1.03);
  assert.equal(
    Number(track.style.scale.split(' ')[0]),
    1,
    'Normal reading keeps local and track scale separate',
  );
  response.frame(current, host, 1.04, 'flash');
  assert.equal(keyword.style.scale, '1.03', 'Returning to spotlight restores the retired keyword style');
  assert.equal(track.style.scale, '');
  response.clear();
  assert.deepEqual(spotlight.style, saved);
  assert.equal(response.getState().presentation, null);
});

test('visible spotlight emphasis freezes on pause, reduces motion, and retires on source and line replacement', () => {
  const make = (reducedMotion) => {
    const s = surface({ reducedMotion }),
      response = new KnowledgeDrumResponse();
    response.update(hit(1, 1, 'snap', 0.9));
    response.frame(s.current, s.host, 1, 'flash');
    return { ...s, response };
  };
  const normal = make(false),
    reduced = make(true);
  const scale = (s) => Number(s.spotlight.style.scale.split(' ')[0]) - 1;
  assert.ok(scale(reduced) > 0 && scale(reduced) < scale(normal) * 0.15);
  const { response, current, host, spotlight } = normal;
  const frozen = { ...spotlight.style };
  response.update(hit(5, 2, 'thump'), { paused: true });
  response.frame(current, host, 5, 'flash');
  assert.deepEqual(spotlight.style, frozen);
  response.update(hit(6, 2, 'thump'));
  response.frame(current, host, 6, 'flash');
  assert.deepEqual(spotlight.style, frozen, 'A paused incoming hit cannot replay on resume');
  const next = surface();
  response.frame(next.current, next.host, 6.01, 'flash');
  assert.equal(spotlight.style.scale, '', 'The retired line retains no spotlight scale');
  response.update(hit(6.02, 2, 'thump', 0.8, { sourceGeneration: 2, drum: { hit: false, sequence: 2 } }));
  response.frame(next.current, next.host, 6.02, 'flash');
  assert.deepEqual(next.spotlight.style.scale.split(' ').map(Number), [1, 1]);
  response.clear();
  assert.equal(next.spotlight.style.scale, '');
});

test('spotlight growth respects measured viewport room and recalculates when its visible typed fragment changes', () => {
  const response = new KnowledgeDrumResponse();
  const { current, host, spotlight } = surface();
  let width = 50;
  Object.defineProperty(spotlight, 'offsetWidth', { get: () => width });
  spotlight.offsetHeight = 30;
  spotlight.getBoundingClientRect = () => ({
    left: 100 - width / 2,
    right: 100 + width / 2,
    top: 50,
    bottom: 80,
    width,
    height: 30,
  });
  host.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0, bottom: 140 });
  spotlight.textContent = '短词';
  response.update(hit(1, 1, 'thump', 1));
  response.frame(current, host, 1, 'pop');
  assert.ok(Number(spotlight.style.scale.split(' ')[0]) > 1.1);
  width = 180;
  spotlight.textContent = '同一节点里的长一些的片段';
  response.frame(current, host, 1.01, 'pop');
  const presentation = response.getState().presentation;
  assert.equal(
    presentation.focusScale,
    1,
    'Existing entrance peak already consumes the narrow horizontal budget',
  );
  assert.equal(Number(spotlight.style.scale.split(' ')[0]), 1);
  assert.ok(
    Number(spotlight.style.scale.split(' ')[1]) < 1,
    'Body compression remains independent of the focus fit',
  );
});

test('flash composes its original animated blur with real brightness instead of letting a keyframe mask the drum', async () => {
  const css = await readFile(new URL('../src/visuals/extra-effects.css', import.meta.url), 'utf8');
  const flash = css.slice(
    css.indexOf('@keyframes spotlight-flash'),
    css.indexOf('@keyframes knowledge-wave'),
  );
  assert.match(flash, /filter:\s*blur\(2px\)\s+brightness\(var\(--wad-drum-brightness,\s*1\)\)/);
  assert.match(flash, /filter:\s*blur\(0\)\s+brightness\(var\(--wad-drum-brightness,\s*1\)\)/);
  const response = new KnowledgeDrumResponse(),
    { current, host, spotlight } = surface();
  response.update(hit(1, 1, 'thump', 0.9));
  response.frame(current, host, 1, 'flash');
  const value = Number(spotlight.style['--wad-drum-brightness']);
  assert.ok(value > 1.2 && Math.abs(value - response.pose.brightness) < 0.00001);
  response.update(hit(1.1, 1, 'thump', 0.9, { drum: { ...hit(1).drum, hit: false } }));
  response.frame(current, host, 1.1, 'flash');
  assert.ok(Number(spotlight.style['--wad-drum-brightness']) < value);
  response.clear();
  assert.equal(
    spotlight.style['--wad-drum-brightness'],
    undefined,
    'An originally absent custom property is removed',
  );
});

test('flash restores the previous variable value and priority through same-node mode changes, line replacement and clear', () => {
  const response = new KnowledgeDrumResponse(),
    first = surface(),
    next = surface();
  const bindProperties = (style) => {
    const priorities = new Map();
    style.getPropertyValue = function (name) {
      return this[name] || '';
    };
    style.getPropertyPriority = (name) => priorities.get(name) || '';
    style.setProperty = function (name, value, priority = '') {
      this[name] = value;
      priorities.set(name, priority);
    };
    style.removeProperty = function (name) {
      const old = this[name];
      delete this[name];
      priorities.delete(name);
      return old;
    };
  };
  bindProperties(first.spotlight.style);
  bindProperties(next.spotlight.style);
  first.spotlight.style.setProperty('--wad-drum-brightness', '0.83', 'important');
  next.spotlight.style.setProperty('--wad-drum-brightness', '0.91');
  response.update(hit(1));
  response.frame(first.current, first.host, 1, 'flash');
  assert.ok(Number(first.spotlight.style.getPropertyValue('--wad-drum-brightness')) > 1);
  assert.equal(first.spotlight.style.getPropertyPriority('--wad-drum-brightness'), '');
  response.frame(first.current, first.host, 1.01, 'pop');
  assert.equal(first.spotlight.style.getPropertyValue('--wad-drum-brightness'), '0.83');
  assert.equal(first.spotlight.style.getPropertyPriority('--wad-drum-brightness'), 'important');
  response.frame(first.current, first.host, 1.02, 'flash');
  response.frame(next.current, next.host, 1.03, 'flash');
  assert.equal(first.spotlight.style.getPropertyValue('--wad-drum-brightness'), '0.83');
  assert.equal(first.spotlight.style.getPropertyPriority('--wad-drum-brightness'), 'important');
  response.clear();
  assert.equal(next.spotlight.style.getPropertyValue('--wad-drum-brightness'), '0.91');
  assert.equal(next.spotlight.style.getPropertyPriority('--wad-drum-brightness'), '');
});

test('flash brightness freezes and resumes without replaying paused hits, while a pure tick stays brightness-neutral', () => {
  const response = new KnowledgeDrumResponse(),
    { current, host, spotlight } = surface();
  response.update(hit(1));
  response.frame(current, host, 1, 'flash');
  const initial = spotlight.style['--wad-drum-brightness'];
  response.update(hit(4, 2, 'snap'), { paused: true });
  response.frame(current, host, 4, 'flash');
  assert.equal(spotlight.style['--wad-drum-brightness'], initial);
  response.update(hit(5, 2, 'snap'));
  response.frame(current, host, 5, 'flash');
  assert.equal(spotlight.style['--wad-drum-brightness'], initial);
  response.update(hit(6, 3, 'tick'));
  response.frame(current, host, 6, 'flash');
  assert.equal(spotlight.style['--wad-drum-brightness'], '1.00000');
  assert.equal(spotlight.style.translate, '0px 0.0000px');
  response.clear();
});

test('automatic scene zoom preserves its own blur while composing drum brightness and restoring the same track on exit', async () => {
  const css = await readFile(new URL('../src/visuals/extra-effects.css', import.meta.url), 'utf8');
  const zoom = css.slice(css.indexOf('@keyframes scene-zoom'), css.indexOf('@keyframes scene-split'));
  assert.match(zoom, /filter:\s*blur\(3px\)\s+brightness\(var\(--wad-drum-brightness,\s*1\)\)/);
  assert.match(zoom, /filter:\s*blur\(0\)\s+brightness\(var\(--wad-drum-brightness,\s*1\)\)/);
  const response = new KnowledgeDrumResponse(),
    { current, host, track, spotlight } = surface();
  host.dataset = { presentation: 'scene', entrance: 'zoom' };
  track.style['--wad-drum-brightness'] = '0.87';
  response.update(hit(1, 1, 'snap', 0.9));
  response.frame(current, host, 1, 'stack');
  assert.equal(response.getState().presentation.target, 'reading-track');
  assert.ok(Number(track.style['--wad-drum-brightness']) > 1.2);
  assert.equal(
    spotlight.style['--wad-drum-brightness'],
    undefined,
    'A hidden spotlight cannot satisfy scene emphasis',
  );
  assert.ok(Math.abs(Number(track.style['--wad-drum-brightness']) - response.pose.brightness) < 0.00001);
  host.dataset.entrance = 'lift';
  response.frame(current, host, 1.01, 'stack');
  assert.equal(
    track.style['--wad-drum-brightness'],
    '0.87',
    'The same track restores its variable when the conflicting animation leaves',
  );
  assert.match(
    track.style.filter,
    /^brightness\(/,
    'Other entrances keep the existing inline brightness path',
  );
  host.dataset.entrance = 'zoom';
  response.frame(current, host, 1.02, 'stack');
  const next = surface();
  next.host.dataset = { presentation: 'scene', entrance: 'zoom' };
  response.frame(next.current, next.host, 1.03, 'stack');
  assert.equal(track.style['--wad-drum-brightness'], '0.87');
  assert.ok(Number(next.track.style['--wad-drum-brightness']) > 1);
  response.clear();
  assert.equal(next.track.style['--wad-drum-brightness'], undefined);
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
  assert.ok(
    response.sample(2).y < 0,
    'The newly confirmed source responds without inheriting old downward motion',
  );
  assert.ok(response.sample(2.024).y < 0);
});

test('an impact observed on an invalid signal is consumed and never becomes a delayed valid accent', () => {
  const response = new KnowledgeDrumResponse();
  response.update(hit(1, 7, 'thump', 0.8, { signalValid: 0 }));
  assert.equal(response.sample(1.024).envelope, 0);
  response.update(hit(2, 7));
  assert.equal(response.sample(2.024).envelope, 0);
  response.update(hit(2.05, 8));
  close(response.sample(2.05).envelope, 1);
});

test('focus scale is immediate, weight ordered, confined to known keyword elements and restored on clear', () => {
  const magnitudes = [];
  for (const weight of [0.15, 0.5, 0.95]) {
    const response = new KnowledgeDrumResponse(),
      { current, host } = surface();
    const focus = { style: { scale: '1.01' } };
    current.featuredMarker = { els: [focus] };
    response.update(
      hit(1, 1, 'thump', weight, {
        drum: {
          ...hit(1).drum,
          weight,
          ageSeconds: 0.018,
          time: 5000,
          attackTime: 4999.982,
          confirmedAt: 5000,
        },
      }),
    );
    response.frame(current, host, 1);
    magnitudes.push(Number(focus.style.scale));
    assert.ok(Number(focus.style.scale) > 1.025 && Number(focus.style.scale) <= 1.13);
    assert.ok(response.getState().pose.y > 0);
    assert.ok(response.command.started < 1 && response.command.started > 0.97);
    response.clear();
    assert.equal(focus.style.scale, '1.01');
  }
  assert.ok(magnitudes[0] < magnitudes[1] && magnitudes[1] < magnitudes[2]);
});

test('a light tick cannot erase the heavy reading response and priority freezes and expires without creating events', () => {
  const response = new KnowledgeDrumResponse();
  response.update(hit(1, 1, 'thump', 0.95));
  const before = response.sample(1.06);
  response.update(hit(1.06, 2, 'tick', 0.15));
  const after = response.sample(1.06);
  close(after.y, before.y);
  close(after.scaleY, before.scaleY);
  assert.equal(after.bodySequence, 1);
  assert.equal(response.getPriority(1.06), 1);
  response.update(hit(1.08, 2, 'tick', 0.15), { paused: true });
  assert.equal(response.getPriority(20), 1);
  response.update(hit(20, 2, 'tick', 0.15));
  assert.equal(response.getPriority(20), 1);
  assert.equal(response.getPriority(22), 0);
  assert.equal(response.sample(22).envelope, 0);
  assert.equal(response.lastSequence, 2);
});
