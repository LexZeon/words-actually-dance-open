import test from 'node:test';
import assert from 'node:assert/strict';
import { DanceStage } from '../src/visuals/dance-stage.js';
import { neutralMotion } from '../src/visuals/dance-motion.js';
import { MotionFeatures } from '../src/audio/motion-features.js';
import { toneStylePcm } from './helpers/tone-style-pcm.mjs';
import {
  GHOST_EFFECTS,
  GhostMotionDirector,
  GHOST_HISTORY_LIMIT,
  styleGhostMain,
  constrainGhostPair,
} from '../src/visuals/ghost-motion.js';

const features = {
  energy: 0.7,
  amplitude: 0.25,
  brightness: 0.65,
  bass: 0.5,
  mid: 0.4,
  treble: 0.45,
  amplitudeTrend: 0.5,
  frequencyTrend: 0.3,
  attack: 0.7,
  bpm: 120,
  silent: 0,
  audioSilent: 0,
  signalValid: 1,
};
const tone = (kind, sequence = 1, hit = false) => ({
  kind,
  sequence,
  hit,
  confidence: 0.9,
  intensity: 0.7,
  strength: 0.8,
  trend: 0.3,
  valid: true,
  source: 'envelope-spectrum-proxy',
});
const keys = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];
const distance = (one, two) =>
  keys.reduce((total, key) => total + Math.abs(one.group[key] - two.group[key]), 0) +
  one.glyphs.reduce(
    (total, glyph, index) =>
      total + keys.reduce((sum, key) => sum + Math.abs(glyph[key] - two.glyphs[index][key]), 0),
    0,
  );

test('five ghost mechanisms deform different physical channels and preserve the legacy input pose', () => {
  const original = neutralMotion(5);
  original.envelope = 0.75;
  original.accent = { source: 'drum', envelope: 1, weight: 0.8 };
  const before = structuredClone(original);
  const sampled = Object.fromEntries(
    GHOST_EFFECTS.map(({ id }) => [
      id,
      styleGhostMain(original, features, id, { beatIndex: 0, beatPhase: 0.3 }),
    ]),
  );
  assert.deepEqual(original, before);
  assert.equal(GHOST_EFFECTS.length, 5);
  assert.ok(sampled['scale-echo'].group.scaleX > 1.2 && sampled['scale-echo'].group.scaleY > 1.2);
  assert.ok(sampled['twist-shadow'].group.rotation < -0.1);
  assert.ok(sampled['vertical-lift'].group.y < -0.06);
  assert.ok(
    sampled['horizontal-stretch'].group.scaleX > 1.2 && sampled['horizontal-stretch'].group.scaleY < 0.9,
  );
  assert.equal(sampled['glyph-wave'].group.scaleX, 1);
  assert.ok(new Set(sampled['glyph-wave'].glyphs.map((glyph) => glyph.y.toFixed(4))).size > 2);
  for (const a of GHOST_EFFECTS)
    for (const b of GHOST_EFFECTS) if (a.id !== b.id) assert.ok(distance(sampled[a.id], sampled[b.id]) > 0.1);
  const right = styleGhostMain(original, features, 'twist-shadow', { beatIndex: 1, beatPhase: 0.3 });
  assert.ok(right.group.rotation > 0.1, 'The second global beat twists in the opposite direction');
});

test('weight and measured rise or fall continuously reshape the current effect', () => {
  const original = neutralMotion(4);
  original.accent = { source: 'drum', envelope: 1, weight: 0.2 };
  const light = styleGhostMain(original, features, 'horizontal-stretch');
  original.accent.weight = 0.95;
  const heavy = styleGhostMain(original, features, 'horizontal-stretch');
  assert.ok(heavy.group.scaleX > light.group.scaleX + 0.15);
  const up = styleGhostMain(original, features, 'vertical-lift');
  const down = styleGhostMain(
    original,
    { ...features, amplitudeTrend: -0.8, frequencyTrend: -0.8 },
    'vertical-lift',
  );
  assert.ok(down.group.y > up.group.y + 0.09);
  assert.ok(
    distance(
      styleGhostMain(original, { ...features, brightness: 0.1 }, 'glyph-wave', { beatPhase: 0.3 }),
      styleGhostMain(original, { ...features, brightness: 0.9 }, 'glyph-wave', { beatPhase: 0.3 }),
    ) > 0.06,
  );
});

test('the delayed layer interpolates actual historical poses instead of copying the present impact', () => {
  const ghost = new GhostMotionDirector({ effect: 'scale-echo' });
  for (let frame = 0; frame <= 60; frame++) {
    const time = frame / 60,
      pose = neutralMotion(2);
    pose.group.x = time * 0.2;
    pose.group.scaleX = 1 + time * 0.5;
    ghost.record(time, pose);
  }
  const value = ghost.sample(1);
  assert.equal(value.metadata.active, true);
  assert.ok(value.metadata.delaySeconds >= 0.08 && value.metadata.delaySeconds <= 0.16);
  assert.ok(Math.abs(value.pose.group.x - value.metadata.sourceTime * 0.2) < 1e-12);
  assert.ok(Math.abs(value.pose.group.scaleX - (1 + value.metadata.sourceTime * 0.5)) < 1e-12);
  assert.notEqual(value.pose.group.x, ghost.history.at(-1).pose.group.x);
  value.pose.group.x = 100;
  assert.ok(ghost.sample(1).pose.group.x < 1, 'Consumers cannot mutate retained history');
});

test('bounded timestamp history follows the same delay at 30, 60 and 144 FPS, without stale extrapolation after a dropped frame', () => {
  const values = [30, 60, 144].map((fps) => {
    const director = new GhostMotionDirector({ effect: 'glyph-wave' });
    for (let frame = 0; frame <= fps * 20; frame++) {
      const time = frame / fps,
        pose = neutralMotion(3);
      pose.group.y = time * 0.01;
      director.record(time, pose);
    }
    assert.ok(director.history.length <= GHOST_HISTORY_LIMIT);
    assert.ok(director.history.at(-1).time - director.history[0].time < 0.5);
    assert.equal(director.sample(21).pose, null, 'An old pose cannot be held through a sampling gap');
    return director.sample(20).pose.group.y;
  });
  assert.ok(Math.max(...values) - Math.min(...values) < 1e-12);
  const highRate = new GhostMotionDirector();
  for (let frame = 0; frame <= 10000; frame++) highRate.record(frame / 1000, neutralMotion(2));
  assert.ok(highRate.history.length <= 128);
  assert.ok(highRate.sample(10).metadata.active);
});

test('drumless tone candidates select and hold a style while unstable candidates and internal beats cannot rotate styles', () => {
  const director = new GhostMotionDirector();
  director.observe({ ...features, toneStyle: tone('pad') }, 0);
  assert.equal(director.effect, 'twist-shadow');
  for (let frame = 1; frame <= 12; frame++)
    director.observe(
      { ...features, beat: frame % 2, toneStyle: tone(frame % 2 ? 'noise' : 'lead') },
      frame / 60,
    );
  assert.equal(director.effect, 'twist-shadow');
  for (let frame = 13; frame <= 80; frame++)
    director.observe({ ...features, toneStyle: tone('lead') }, frame / 60);
  assert.equal(director.effect, 'vertical-lift');
  for (let frame = 81; frame <= 180; frame++) director.observe({ ...features, beat: frame % 2 }, frame / 60);
  assert.equal(director.effect, 'vertical-lift');
});

test('separated real drum cues keep a candidate across intervening quiet frames without selecting from cached hits', () => {
  const director = new GhostMotionDirector();
  const drum = (sequence, kind, hit = true) => ({ sequence, kind, hit, weight: 0.9, confidence: 0.9 });
  director.observe({ ...features, drum: drum(1, 'thump') }, 0);
  director.observe({ ...features, drum: drum(2, 'snap') }, 1);
  for (let frame = 1; frame < 30; frame++)
    director.observe({ ...features, drum: drum(2, 'snap', false) }, 1 + frame / 60);
  assert.equal(director.effect, 'scale-echo');
  director.observe({ ...features, drum: drum(3, 'snap') }, 1.5);
  assert.equal(director.effect, 'horizontal-stretch');
});

test('a first real tone attack moves immediately even before kind classification becomes confident', () => {
  const director = new GhostMotionDirector();
  const pose = neutralMotion(3);
  director.observe({ ...features, toneStyle: { ...tone(null, 1, true), confidence: 0, strength: 0.8 } }, 0);
  assert.equal(director.toneCue.sequence, 1);
  assert.equal(director.toneCue.time, 0);
  assert.equal(director.effect, 'scale-echo', 'Unknown classification cannot select a new style');
  const firstMovement = director.styleMain(pose, features, 0.006);
  assert.ok(
    distance(firstMovement, pose) > 0.06,
    'Physical envelope response starts within six milliseconds',
  );
  const peak = director.styleMain(pose, features, 0.018);
  assert.ok(distance(peak, pose) > distance(firstMovement, pose));
});

test('high classification confidence without a fresh physical hit cannot manufacture an attack', () => {
  const director = new GhostMotionDirector();
  const pose = neutralMotion(3);
  for (let frame = 0; frame < 60; frame++) {
    const time = frame / 60;
    director.observe(
      { ...features, attack: 1, toneStyle: { ...tone('pulse', 8, false), confidence: 1, strength: 1 } },
      time,
    );
    assert.equal(director.toneCue, null);
    assert.deepEqual(director.styleMain(pose, features, time), pose);
  }
  for (const [index, strength] of [0, -0.5, NaN, Infinity].entries()) {
    director.observe(
      { ...features, toneStyle: { ...tone('pulse', 9 + index, true), confidence: 1, strength } },
      2 + index * 0.2,
    );
    assert.equal(director.toneCue, null, 'A nonpositive or nonfinite attack strength cannot start a cue');
  }
});

test('cached real cue identities cannot renew attacks and paused or silent arrivals are consumed', () => {
  const director = new GhostMotionDirector({ effect: 'scale-echo' });
  const pose = neutralMotion(2),
    incoming = { ...features, toneStyle: tone('pulse', 3, true) };
  director.observe(incoming, 0);
  const peak = director.styleMain(pose, features, 0.018);
  director.observe(incoming, 0.12);
  assert.equal(director.toneCue.time, 0);
  assert.ok(distance(peak, pose) > 0.1);
  assert.ok(distance(director.styleMain(pose, features, 0.2), pose) < 1e-12);
  director.observe({ ...incoming, toneStyle: tone('pulse', 4, true) }, 0.21, { paused: true });
  director.observe({ ...incoming, toneStyle: tone('pulse', 4, true) }, 0.3);
  assert.equal(director.toneCue.sequence, 3);
  director.observe({ ...incoming, toneStyle: tone('pulse', 5, true), audioSilent: 1 }, 0.4);
  director.observe({ ...incoming, toneStyle: tone('pulse', 5, true) }, 0.5);
  assert.equal(director.toneCue.sequence, 3);
  assert.deepEqual(
    director.styleMain(pose, features, 0.5),
    pose,
    'A consumed quiet cue cannot replay; the earlier real cue has naturally ended',
  );
  director.observe({ ...incoming, toneStyle: tone('pulse', 6, true) }, 0.6);
  assert.equal(director.toneCue.sequence, 6);
});

test('source commits, explicit clear, off and reduced motion reject old delayed poses', () => {
  const director = new GhostMotionDirector();
  director.observe({ ...features, sourceGeneration: 1 }, 0);
  for (let frame = 0; frame <= 20; frame++) director.record(frame / 60, neutralMotion(4));
  assert.ok(director.sample(0.3).metadata.active);
  assert.equal(director.sample(0.3, { reducedMotion: true }).pose, null);
  director.observe({ ...features, sourceGeneration: 2 }, 0.34);
  assert.equal(director.sample(0.34).pose, null);
  assert.equal(director.history.length, 0);
  assert.equal(director.setEffect('off'), 'off');
  director.record(0.4, neutralMotion(4));
  assert.equal(director.history.length, 0);
  director.setEffect('glyph-wave');
  director.record(0.5, neutralMotion(4));
  director.clear();
  assert.equal(director.sample(0.6).pose, null);
});

test('a committed source owns independent cue watermarks, while word/history clearing preserves cached identities', () => {
  const director = new GhostMotionDirector();
  director.observe(
    {
      ...features,
      sourceGeneration: 1,
      toneStyle: tone('pad', 99, true),
      drum: { sequence: 99, hit: true, weight: 0.9, confidence: 0.9, kind: 'thump' },
    },
    0,
  );
  director.clear();
  director.observe({ ...features, sourceGeneration: 1, toneStyle: tone('lead', 99, true) }, 0.2);
  assert.equal(director.toneCue, null);
  director.observe(
    {
      ...features,
      sourceGeneration: 2,
      toneStyle: tone('lead', 1, true),
      drum: { sequence: 1, hit: true, weight: 0.8, confidence: 0.9, kind: 'snap' },
    },
    0.4,
  );
  assert.equal(director.toneCue.sequence, 1);
  assert.equal(director.lastDrumSequence, 1);
  assert.equal(director.delayWeight, 0.8);
  assert.equal(director.effect, 'horizontal-stretch');
});

test('shadow weight and delay follow elapsed time smoothly, keeping sourceTime forward at 30, 60 and 144 FPS', () => {
  const results = [30, 60, 144].map((fps) => {
    const director = new GhostMotionDirector({ effect: 'scale-echo' });
    const rows = [];
    for (let frame = 0; frame <= fps * 3; frame++) {
      const time = frame / fps,
        sequence = Math.floor((time + 1e-9) * 4),
        weight = sequence % 2 ? 0.05 : 0.95;
      director.observe(
        { ...features, drum: { sequence, hit: true, weight, confidence: 0.9, kind: 'thump' } },
        time,
      );
      const value = director.sample(time);
      if (value.metadata.active) rows.push({ time, ...value.metadata });
      const pose = neutralMotion(2);
      pose.group.x = time * 0.01;
      director.record(time, pose);
    }
    assert.ok(rows.length > fps * 2);
    for (let index = 1; index < rows.length; index++) {
      const before = rows[index - 1],
        now = rows[index],
        dt = now.time - before.time;
      assert.ok(now.sourceTime > before.sourceTime, `${fps}FPS sourceTime must not replay a past peak`);
      assert.ok(now.delaySeconds >= 0.08 && now.delaySeconds <= 0.16);
      assert.ok(Math.abs(now.opacity - before.opacity) < 0.07 * (1 - Math.exp(-dt / 0.09)) + 1e-10);
    }
    const before = director.delayWeight;
    director.observe({ ...features, drum: { sequence: 99, hit: true, weight: 0, confidence: 0.9 } }, 3, {
      paused: true,
    });
    director.sample(3);
    assert.equal(director.delayWeight, before, 'Pause freezes the weight filter');
    const clock = director.delaySampleTime;
    director.clear();
    assert.equal(director.delaySampleTime, clock, 'Changing a word does not restart elapsed time');
    return rows.at(-1);
  });
  assert.ok(
    Math.max(...results.map((row) => row.delaySeconds)) -
      Math.min(...results.map((row) => row.delaySeconds)) <
      0.002,
  );
  assert.ok(
    Math.max(...results.map((row) => row.opacity)) - Math.min(...results.map((row) => row.opacity)) < 0.007,
  );
});

test('auto style delay changes cannot move historical sample time backward and source commits retire old weight', () => {
  const director = new GhostMotionDirector();
  let previous = null;
  for (let frame = 0; frame <= 180; frame++) {
    const time = frame / 60;
    director.observe(
      {
        ...features,
        sourceGeneration: 1,
        toneStyle: tone(time < 0.5 ? 'pulse' : 'pluck', 1, false),
        drum: { sequence: 1, hit: frame === 0, weight: 0.95, confidence: 0.9, kind: 'thump' },
      },
      time,
    );
    const value = director.sample(time);
    if (value.metadata.active) {
      if (previous !== null) assert.ok(value.metadata.sourceTime > previous);
      previous = value.metadata.sourceTime;
    }
    director.record(time, neutralMotion(2));
  }
  assert.equal(director.effect, 'glyph-wave');
  director.observe({ ...features, sourceGeneration: 2, toneStyle: tone('pad', 1, false) }, 3.1);
  assert.equal(director.delayWeight, 0);
  assert.equal(director.delayWeightTarget, 0);
  assert.equal(director.history.length, 0);
});

test('a short real cue retains a finite faded historical tail through zero audio, without quiet or grid-generated hits', () => {
  const director = new GhostMotionDirector({ effect: 'glyph-wave' });
  for (let frame = 0; frame <= 14; frame++) {
    const time = frame / 120;
    director.observe({ ...features, toneStyle: tone('pluck', 1, frame === 0) }, time);
    director.sample(time);
    const pose = neutralMotion(2);
    pose.group.y = -0.1 * Math.sin((time / 0.12) * Math.PI);
    director.record(time, pose);
  }
  const rows = [];
  for (let frame = 15; frame <= 100; frame++) {
    const time = frame / 120;
    director.observe(
      {
        ...features,
        audioSilent: 1,
        signalValid: 0,
        beat: frame % 2,
        toneStyle: { ...tone('pluck', 2, true), valid: false, strength: 0 },
      },
      time,
    );
    rows.push({ time, ...director.sample(time).metadata });
  }
  const visible = rows.filter((row) => row.active);
  assert.ok(visible.length > 10, 'A 160ms delay still shows the 120ms note during its following rest');
  assert.ok(visible.every((row) => row.sourceTime >= 0 && row.sourceTime <= 14 / 120));
  assert.ok(visible.at(-1).time < 0.28);
  assert.ok(visible.at(-1).opacity < visible[0].opacity, 'The finite past-pose tail fades out');
  assert.equal(director.lastToneSequence, 2, 'Quiet cached identities are still consumed');
  assert.equal(director.toneCue, null, 'Long quiet clears the bounded old cue');
  assert.equal(director.history.length, 0);
});

test('short real rests preserve an auto candidate until another actual note, without committing or counting quiet frames', () => {
  const director = new GhostMotionDirector();
  director.observe({ ...features, sourceGeneration: 1, toneStyle: tone('lead', 1, false) }, 0);
  director.observe({ ...features, sourceGeneration: 1, toneStyle: tone('pluck', 2, true) }, 1);
  assert.equal(director.pending.cues, 1);
  for (let frame = 1; frame <= 26; frame++)
    director.observe(
      { ...features, audioSilent: 1, signalValid: 0, toneStyle: { ...tone('pluck', 3, true), valid: false } },
      1 + frame / 60,
    );
  assert.equal(director.effect, 'vertical-lift');
  assert.equal(director.pending.cues, 1, 'A quiet sample cannot add a confirmation');
  director.observe({ ...features, sourceGeneration: 1, toneStyle: tone('pluck', 4, true) }, 1.55);
  assert.equal(director.effect, 'glyph-wave');
  assert.equal(director.pending, null);
  director.clear();
  director.observe({ ...features, toneStyle: tone('lead', 5, false) }, 3);
  assert.ok(director.pending);
  director.observe({ ...features, audioSilent: 1, signalValid: 0 }, 3.01);
  director.observe({ ...features, audioSilent: 1, signalValid: 0 }, 3.52);
  assert.equal(director.pending, null, 'Long quiet retires a candidate even without a drawable history');
});

test('known quiet separates real pose segments without erasing their tails or treating a dropped frame as silence', () => {
  const director = new GhostMotionDirector({ effect: 'glyph-wave' });
  const record = (time, x) => {
    director.observe(features, time);
    const pose = neutralMotion(2);
    pose.group.x = x;
    director.record(time, pose);
  };
  record(0, 0);
  record(0.1, 0.1);
  director.observe({ ...features, audioSilent: 1, signalValid: 0 }, 0.12);
  record(0.2, 1);
  record(0.22, 1.1);
  assert.equal(director.history[1].segment, 0);
  assert.equal(director.history[2].segment, 1);
  assert.equal(director.sample(0.34).pose, null, 'The source at 0.18 belongs to a known unrecorded rest');
  assert.ok(Math.abs(director.sample(0.26).pose.group.x - 0.1) < 1e-12, 'The last real point still exists');
  assert.equal(director.sample(0.36).pose.group.x, 1, 'The exact first point of the next note is valid');
  assert.ok(Math.abs(director.sample(0.37).pose.group.x - 1.05) < 1e-12);
  director.observe({ ...features, audioSilent: 1, signalValid: 0 }, 0.23, { paused: true });
  record(0.24, 1.2);
  assert.equal(director.history.at(-1).segment, 1, 'Paused wall time does not mark a musical rest');

  const dropped = new GhostMotionDirector({ effect: 'glyph-wave' });
  const one = neutralMotion(2),
    two = neutralMotion(2);
  two.group.x = 1;
  dropped.record(0, one);
  dropped.record(0.2, two);
  assert.ok(Math.abs(dropped.sample(0.26).pose.group.x - 0.5) < 1e-12);
});

test('one shared fit includes both rotated layers for long words on portrait and narrow canvases', () => {
  for (const { width, height } of [
    { width: 320, height: 180 },
    { width: 250, height: 480 },
    { width: 1200, height: 300 },
  ]) {
    const glyphs = Array.from({ length: 16 }, (_, index) => ({
      x: (index - 7.5) * 75,
      y: 0,
      width: 75,
      height: 110,
      visible: true,
    }));
    const main = neutralMotion(16),
      ghost = neutralMotion(16);
    Object.assign(main.group, { rotation: 0.65, scaleX: 2, scaleY: 1.7, x: 0.2, y: -0.3 });
    Object.assign(ghost.group, { rotation: -0.5, scaleX: 1.6, scaleY: 2, x: -0.2, y: 0.15 });
    const fitted = constrainGhostPair(main, ghost, glyphs, { width, height });
    assert.ok(fitted.fitScale < 1);
    for (const bounds of [fitted.main.bounds, fitted.ghost.bounds, fitted.combinedBounds]) {
      assert.ok(bounds.left >= -1e-7 && bounds.right <= width + 1e-7);
      assert.ok(bounds.top >= -1e-7 && bounds.bottom <= height * 0.88 + 1e-7);
    }
    assert.equal(fitted.main.fitScale, fitted.ghost.fitScale);
  }
});

function withStage(run) {
  const saved = {
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    ResizeObserver: globalThis.ResizeObserver,
  };
  const paints = [],
    stack = [];
  let resize;
  const bounds = { width: 600, height: 260 };
  const context = {
    font: '',
    fillStyle: '#fff',
    globalAlpha: 1,
    filter: 'none',
    shadowBlur: 0,
    save() {
      stack.push({
        font: this.font,
        fillStyle: this.fillStyle,
        globalAlpha: this.globalAlpha,
        filter: this.filter,
        shadowBlur: this.shadowBlur,
      });
    },
    restore() {
      Object.assign(this, stack.pop());
    },
    setTransform() {},
    fillRect() {},
    translate() {},
    rotate() {},
    scale() {},
    setLineDash() {},
    beginPath() {},
    moveTo() {},
    bezierCurveTo() {},
    stroke() {},
    fillText(text) {
      paints.push({
        text,
        alpha: this.globalAlpha,
        color: this.fillStyle,
        filter: this.filter,
        shadowBlur: this.shadowBlur,
      });
    },
    measureText(text) {
      return { width: (Number(this.font.match(/([\d.]+)px/)?.[1]) || 80) * [...text].length * 0.6 };
    },
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class {
    constructor(fn) {
      resize = fn;
    }
    observe() {}
    disconnect() {}
  };
  const stage = new DanceStage(
    { style: {}, getContext: () => context, getBoundingClientRect: () => bounds },
    { managedFrame: true },
  );
  stage.setWord('节拍舞动', {}, { immediate: true });
  const tick = (time, extra = {}) => {
    stage.setFeatures({
      ...features,
      time,
      beat: Math.abs(time * 2 - Math.round(time * 2)) < 1e-6,
      beatIndex: Math.floor(time * 2 + 1e-8),
      beatPhase: (time * 2) % 1,
      sourceGeneration: 1,
      ...extra,
    });
    stage.frame(time);
  };
  try {
    return run({ stage, paints, tick, bounds, resize: () => resize() });
  } finally {
    stage.destroy();
    Object.assign(globalThis, saved);
  }
}

test('actual zero-background 120ms plucks draw a finite past-pose tail during the following silent PCM', () => {
  withStage(({ stage, tick }) => {
    stage.setGhostEffect('glyph-wave');
    const fixture = toneStylePcm({ profile: 'pluck', background: 0, noteSeconds: 0.12, seconds: 2.4 });
    const analyzer = new MotionFeatures({ sampleRate: fixture.sampleRate, fftSize: fixture.fftSize });
    let tailFrames = 0,
      realHits = 0,
      quietHits = 0;
    for (let frame = 0; frame <= 90 * 3.2; frame++) {
      const time = frame / 90,
        input = fixture.frame(time);
      const measured = analyzer.process({ ...input, beatFeatures: { silent: input.rms < 0.00003 ? 1 : 0 } });
      tick(time, { ...measured, silent: 0, audioSilent: measured.signalValid ? 0 : 1 });
      const state = stage.getGhostState();
      if (state.active) {
        const after = stage.ghost.history.findIndex((point) => point.time >= state.sourceTime);
        const next = stage.ghost.history[after];
        const before =
          after === 0 || Math.abs(next.time - state.sourceTime) < 1e-9
            ? next
            : stage.ghost.history[after - 1];
        assert.equal(before.segment, next.segment, 'Every visible tail comes from a real continuous note');
      }
      if (measured.toneStyle.hit) realHits++;
      if (!measured.signalValid) {
        if (measured.toneStyle.hit) quietHits++;
        if (state.active) {
          tailFrames++;
          assert.ok(state.sourceTime <= stage.ghost.history.at(-1).time);
          assert.ok(state.opacity > 0 && state.opacity < 0.3);
        }
      }
    }
    assert.ok(realHits >= 3, 'Actual note envelopes produce independent tone hits');
    assert.ok(tailFrames > 20, 'Silence after short real notes does not erase the delayed layer');
    assert.equal(quietHits, 0);
    assert.equal(stage.getGhostState().active, false);
    assert.equal(stage.ghost.history.length, 0, 'Long quiet retires the finite history');
  });
});

test('the same real source changes auto style from lead to short zero-background plucks after two or three real notes', () => {
  withStage(({ stage, tick }) => {
    const fixture = toneStylePcm({ profile: 'pluck', background: 0, noteSeconds: 0.12, seconds: 5.5 });
    const lead = toneStylePcm({
      profile: 'lead',
      seconds: 2,
      sampleRate: fixture.sampleRate,
      fftSize: fixture.fftSize,
    });
    fixture.samples.set(lead.samples);
    const analyzer = new MotionFeatures({ sampleRate: fixture.sampleRate, fftSize: fixture.fftSize });
    let leadSelected = false,
      firstPluckSelection = null,
      realPluckHits = 0;
    for (let frame = 0; frame < 90 * 5.5; frame++) {
      const time = frame / 90,
        input = fixture.frame(time);
      const measured = analyzer.process({ ...input, beatFeatures: { silent: input.rms < 0.00003 ? 1 : 0 } });
      if (time >= 2 && measured.toneStyle.hit) realPluckHits++;
      tick(time, { ...measured, silent: 0, audioSilent: measured.signalValid ? 0 : 1, sourceGeneration: 1 });
      if (time < 2 && stage.ghost.effect === 'vertical-lift') leadSelected = true;
      if (leadSelected && time >= 2 && stage.ghost.effect === 'glyph-wave' && firstPluckSelection === null)
        firstPluckSelection = { time, notes: realPluckHits };
    }
    assert.ok(leadSelected, 'The real sustained lead first selected its measured style');
    assert.ok(firstPluckSelection, 'Short rests cannot permanently reset a later real pluck candidate');
    assert.ok(
      firstPluckSelection.notes >= 2 && firstPluckSelection.notes <= 3,
      JSON.stringify(firstPluckSelection),
    );
    assert.equal(stage.ghost.sourceGeneration, 1, 'This transition did not reset the source or global clock');
  });
});

test('the actual stage paints a clear white main layer above one low-opacity historical white layer', () => {
  withStage(({ stage, paints, tick }) => {
    stage.setGhostEffect('horizontal-stretch');
    for (let frame = 0; frame <= 24; frame++)
      tick(frame / 60, {
        drum: {
          sequence: frame >= 10 ? 1 : 0,
          hit: frame === 10,
          kind: 'thump',
          weight: 0.9,
          strength: 0.9,
          confidence: 0.9,
        },
      });
    paints.length = 0;
    tick(25 / 60);
    assert.equal(paints.length, 8);
    assert.ok(
      paints.slice(0, 4).every((paint) => paint.alpha > 0.1 && paint.alpha < 0.3 && paint.color === '#fff'),
    );
    assert.ok(
      paints
        .slice(4)
        .every(
          (paint) =>
            paint.alpha === 1 && paint.color === '#fff' && paint.filter === 'none' && paint.shadowBlur === 0,
        ),
    );
    const state = stage.getGhostState();
    assert.ok(state.active && state.layers.main && state.layers.ghost);
    assert.equal(state.anchor.x, 300);
    assert.equal(state.anchor.y, 117);
    assert.ok(Math.abs(stage.elapsed - state.sourceTime - state.delaySeconds) < 1e-12);
    assert.deepEqual(state.layers.main.group, stage.getMotionState().poses.group);
    assert.ok(distance(state.layers.main, state.layers.ghost) > 0.02);
    const retained = stage.ghost.history.at(-1);
    assert.deepEqual(
      retained.pose.group,
      state.layers.main.group,
      'History stores the actually fitted primary pose',
    );
  });
});

test('actual fitted historical layers retain the same scale on long words across frame rates instead of recursively shrinking', () => {
  const scales = [30, 60, 144].map((fps) =>
    withStage(({ stage, tick, bounds, resize }) => {
      bounds.width = 220;
      bounds.height = 150;
      resize();
      stage.setWord('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', {}, { immediate: true });
      stage.setGhostEffect('scale-echo');
      const held = neutralMotion(stage.glyphs.length);
      held.group.scaleX = 2;
      held.group.scaleY = 2;
      stage.motion.sample = () => structuredClone(held);
      for (let frame = 0; frame <= fps * 3; frame++) tick(frame / fps);
      const state = stage.getGhostState();
      assert.ok(state.active);
      assert.ok(state.historySamples <= 128);
      assert.ok(
        Math.abs(state.layers.main.group.scaleX - state.layers.ghost.group.scaleX) < 1e-10,
        'The old actual pose does not receive the current primary fit twice',
      );
      assert.ok(Math.abs(stage.elapsed - state.sourceTime - state.delaySeconds) < 1e-12);
      assert.ok(state.combinedBounds.left >= 0 && state.combinedBounds.right <= bounds.width + 1e-7);
      assert.ok(state.combinedBounds.top >= 0 && state.combinedBounds.bottom <= bounds.height * 0.88 + 1e-7);
      return state.layers.ghost.group.scaleX;
    }),
  );
  assert.ok(Math.max(...scales) - Math.min(...scales) < 1e-10);
});

test('actual moving historical poses remain consistent across display frame rates', () => {
  const values = [30, 60, 144].map((fps) =>
    withStage(({ stage, tick }) => {
      stage.setGhostEffect('vertical-lift');
      for (let frame = 0; frame <= fps * 3; frame++) tick(frame / fps);
      return stage.getGhostState();
    }),
  );
  for (const value of values) {
    assert.ok(value.active);
    assert.ok(value.combinedBounds.left >= 0 && value.combinedBounds.right <= 600 + 1e-7);
    assert.ok(value.delaySeconds >= 0.08 && value.delaySeconds <= 0.16);
  }
  assert.ok(distance(values[0].layers.main, values[2].layers.main) < 1e-10);
  assert.ok(
    distance(values[0].layers.ghost, values[2].layers.ghost) < 0.02,
    'Display sampling changes only bounded interpolation error, not the delayed cycle',
  );
});

test('paused invalid observations freeze the layered pose, while a committed source removes its old ghost', () => {
  withStage(({ stage, tick }) => {
    for (let frame = 0; frame <= 30; frame++) tick(frame / 60);
    assert.ok(stage.getGhostState().active);
    stage.setPaused(true);
    const held = stage.getGhostState().layers;
    tick(9, { audioSilent: 1, signalValid: 0 });
    assert.deepEqual(stage.getGhostState().layers, held);
    tick(10, { sourceGeneration: 2 });
    assert.equal(stage.getGhostState().layers.ghost, null);
    assert.equal(stage.ghost.history.length, 0);
  });
});

test('a paused ghost freezes exactly, clears on word/source/resize, and cannot show retired characters during handoff', () => {
  withStage(({ stage, paints, tick, bounds, resize }) => {
    for (let frame = 0; frame <= 30; frame++) tick(frame / 60);
    stage.setPaused(true);
    const before = stage.getGhostState();
    tick(50, { toneStyle: tone('noise', 10, true) });
    const after = stage.getGhostState();
    assert.deepEqual(after.layers, before.layers);
    assert.equal(after.sourceTime, before.sourceTime);
    assert.equal(after.historySamples, before.historySamples);
    stage.reducedMotion = true;
    stage.draw();
    assert.equal(stage.getGhostState().layers.ghost, null);
    stage.reducedMotion = false;
    stage.setPaused(false);
    tick(51);
    tick(51.02);
    stage.setWord('新字', { type: 'cause' });
    paints.length = 0;
    stage.draw();
    assert.equal(stage.getGhostState().active, false);
    assert.equal(stage.ghost.history.length, 0);
    tick(52);
    tick(52.02);
    assert.ok(paints.every((paint) => [...'节拍舞动新字'].includes(paint.text)));
    tick(52.04, { sourceGeneration: 2 });
    assert.equal(stage.getGhostState().active, false);
    bounds.width = 330;
    resize();
    assert.equal(stage.getGhostState().active, false);
    stage.setGhostEffect('off');
    assert.equal(stage.getGhostState().mode, 'off');
    assert.equal(stage.getGhostState().layers.ghost, null);
    assert.ok(stage.getMotionState().poses, 'Normal motion remains available when the effect is off');
  });
});
