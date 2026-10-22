import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTIONS,
  MOTION_CYCLES,
  createMotionCommand,
  sampleMotion,
  sampleMotionCycle,
  MotionDirector,
  constrainMotion,
  chooseMotionCandidate,
} from '../src/visuals/dance-motion.js';

const music = (overrides = {}) => ({
  beat: 1,
  silent: 0,
  bpm: 108,
  energy: 0.72,
  bass: 0.7,
  mid: 0.35,
  treble: 0.22,
  brightness: 0.35,
  attack: 0.7,
  strength: 0.7,
  amplitude: 0.1,
  frequencyHz: 1200,
  noisiness: 0.08,
  amplitudeTrend: 0,
  frequencyTrend: 0,
  beatPhase: 0,
  ...overrides,
});
const combination = { primary: 'toss', secondary: 'wave', trend: 0 };
const held = (overrides) => createMotionCommand(music(overrides), 0, combination);
const pose = (command, phase = 0.38, overrides = {}) =>
  sampleMotion(command, phase, { glyphCount: 4, intensity: 1.25, ...overrides });
const components = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];
const distance = (a, b) =>
  components.reduce((sum, key) => sum + Math.abs(a.group[key] - b.group[key]), 0) +
  a.glyphs.reduce(
    (sum, glyph, i) =>
      sum + components.reduce((part, key) => part + Math.abs(glyph[key] - b.glyphs[i][key]), 0),
    0,
  );
function pulse(director, features, time) {
  director.update({ ...features, beat: 0 }, time - 0.01);
  return director.update({ ...features, beat: 1 }, time, { glyphCount: 4 });
}

test('all eight finite trajectories start and end at rest with distinct visible motion', () => {
  const signatures = new Set();
  for (const motion of MOTIONS) {
    const command = createMotionCommand(music(), 1, { primary: motion.id, secondary: 'sway', trend: 0 });
    for (const phase of [0, 1, 2]) {
      const value = pose(command, phase);
      assert.deepEqual(value.group, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      assert.ok(value.glyphs.every((glyph) => glyph.x === 0 && glyph.y === 0 && glyph.rotation === 0));
    }
    const middle = pose(command, 0.32);
    signatures.add(JSON.stringify([middle.group, middle.glyphs]));
    assert.ok(distance(middle, pose(command, 0)) > 0.03, motion.id);
  }
  assert.equal(signatures.size, 8);
});

test('held combination changes its physical trajectory with all four musical dimensions', () => {
  const reference = pose(held({}));
  const cases = [
    ['frequency height', { frequencyHz: 120 }, { frequencyHz: 8500 }],
    ['frequency direction', { frequencyTrend: -0.8 }, { frequencyTrend: 0.8 }],
    ['absolute amplitude', { amplitude: 0.008 }, { amplitude: 0.3 }],
    ['amplitude direction', { amplitudeTrend: -0.8 }, { amplitudeTrend: 0.8 }],
    ['beat/character phase', { beatPhase: 0.05 }, { beatPhase: 0.85 }],
    ['brightness', { brightness: 0.05 }, { brightness: 0.95 }],
    ['noisy timbre', { noisiness: 0.01 }, { noisiness: 0.95 }],
    ['attack elasticity', { attack: 0.05 }, { attack: 0.95 }],
  ];
  for (const [dimension, low, high] of cases) {
    const difference = distance(pose(held(low)), pose(held(high)));
    assert.ok(difference > 0.01, `${dimension}: ${difference}`);
    assert.equal(pose(held(low)).primary, reference.primary);
  }
  const soft = pose(held({ amplitude: 0.008 }));
  const strong = pose(held({ amplitude: 0.3 }));
  assert.ok(Math.abs(strong.group.y) > Math.abs(soft.group.y) * 1.6);
});

test('trusted pitch direction adds lift while uncertain pitch cannot mislabel the spectrum', () => {
  const lowConfidence = pose(held({ pitchTrend: 1, pitchConfidence: 0.4 }));
  assert.deepEqual(lowConfidence, pose(held({ pitchTrend: 0, pitchConfidence: 0.4 })));
  const rising = pose(held({ pitchTrend: 0.8, pitchConfidence: 0.95 }));
  const falling = pose(held({ pitchTrend: -0.8, pitchConfidence: 0.95 }));
  assert.ok(rising.group.y < falling.group.y - 0.03);
});

test('louder intensity is visible and reduced motion significantly limits travel', () => {
  const command = held({});
  const subtle = pose(command, 0.4, { intensity: 0.85 });
  const normal = pose(command, 0.4, { intensity: 1.25 });
  const exaggerated = pose(command, 0.4, { intensity: 2.5 });
  const reduced = pose(command, 0.4, { intensity: 2.5, reducedMotion: true });
  assert.ok(Math.abs(subtle.group.y) > 0.06);
  assert.ok(Math.abs(normal.group.y) > Math.abs(subtle.group.y));
  assert.ok(Math.abs(exaggerated.group.y) > Math.abs(normal.group.y) * 1.8);
  assert.ok(Math.abs(reduced.group.y) < Math.abs(exaggerated.group.y) * 0.12);
});

test('music selection responds to directional and timbral evidence', () => {
  const candidates = [
    { amplitudeTrend: 0.8 },
    { amplitudeTrend: -0.8 },
    { bass: 0.1, mid: 0.4, treble: 0.1, attack: 0.1 },
    { bass: 0.1, brightness: 0.8, frequencyTrend: 0.18, attack: 0.1 },
    { bass: 0.8, attack: 0.8 },
    { bass: 0.1, mid: 0.7, treble: 0.7 },
    { noisiness: 0.9, attack: 0.8 },
    { bass: 0.1, mid: 0.1, treble: 0.2, brightness: 0.9, attack: 0.1 },
  ].map((overrides) => chooseMotionCandidate(music(overrides)).primary);
  assert.equal(new Set(candidates).size, 8);
});

test('provided internal beat phase controls pose even when render frame timing differs', () => {
  const director = new MotionDirector();
  pulse(director, music(), 0.1);
  const phasePose = director.sample(4, { glyphCount: 4, beatPhase: 0.25 });
  const expected = sampleMotion(director.command, 0.25 / 0.96, {
    glyphCount: 4,
    intensity: director.intensity,
    features: { ...director.features, beatPhase: 0.25 },
  });
  const cycle = sampleMotionCycle(director.command, {
    beatIndex: director.clockBeatIndex,
    beatPhase: 0.25,
    glyphCount: 4,
    intensity: director.intensity,
    features: { ...director.features, beatPhase: 0.25 },
  });
  for (const key of components) {
    expected.group[key] += cycle.group[key] - (key.startsWith('scale') ? 1 : 0);
    expected.glyphs.forEach((glyph, index) => {
      glyph[key] += cycle.glyphs[index][key] - (key.startsWith('scale') ? 1 : 0);
    });
  }
  assert.ok(distance(phasePose, expected) < 1e-10);
  assert.ok(distance(phasePose, director.sample(4, { glyphCount: 4, beatPhase: 0.75 })) > 0.05);
});

test('live musical dimensions reshape the same beat command without another pulse or combination change', () => {
  const cases = [
    ['absolute frequency', { frequencyHz: 150 }, { frequencyHz: 9000 }],
    ['frequency direction', { frequencyTrend: -0.9 }, { frequencyTrend: 0.9 }],
    ['absolute amplitude', { amplitude: 0.006 }, { amplitude: 0.3 }],
    ['relative energy', { energy: 0.05 }, { energy: 0.95 }],
    ['amplitude direction', { amplitudeTrend: -0.9 }, { amplitudeTrend: 0.9 }],
    ['brightness', { brightness: 0.03 }, { brightness: 0.95 }],
    ['noisy timbre', { noisiness: 0.01 }, { noisiness: 0.95 }],
    ['attack elasticity', { attack: 0.02 }, { attack: 0.98 }],
    [
      'trusted pitch direction',
      { pitchConfidence: 0.98, pitchTrend: -0.9 },
      { pitchConfidence: 0.98, pitchTrend: 0.9 },
    ],
  ];
  const modulated = (changes) => {
    const director = new MotionDirector();
    pulse(director, music(), 0.1);
    const command = director.command;
    const selection = { ...director.selection };
    for (let frame = 1; frame <= 24; frame++) {
      const triggered = director.update(music({ ...changes, beat: 0, beatPhase: 0.34 }), 0.1 + frame / 90, {
        glyphCount: 4,
      });
      assert.equal(triggered, false);
    }
    assert.equal(director.command, command, 'the finite beat command must stay latched');
    assert.deepEqual(director.selection, selection);
    assert.equal(director.beatCount, 1);
    assert.equal(director.switchCount, 0);
    assert.equal(director.pendingCount, 0, 'between-beat modulation is not selection evidence');
    return director.sample(0.37, { glyphCount: 4, beatPhase: 0.34 });
  };
  for (const [dimension, low, high] of cases) {
    const before = modulated(low),
      after = modulated(high);
    assert.equal(before.primary, after.primary);
    assert.equal(before.secondary, after.secondary);
    assert.ok(distance(before, after) > 0.01, `${dimension} did not affect the held pose`);
  }
});

test('continuous clock phase changes the pose without a synthetic beat', () => {
  const director = new MotionDirector();
  pulse(director, music(), 0.1);
  const command = director.command;
  director.update(music({ beat: 0, beatPhase: 0.14 }), 0.18, { glyphCount: 4 });
  const early = director.sample(0.18, { glyphCount: 4, beatPhase: director.features.beatPhase });
  director.update(music({ beat: 0, beatPhase: 0.71 }), 0.42, { glyphCount: 4 });
  const late = director.sample(0.42, { glyphCount: 4, beatPhase: director.features.beatPhase });
  assert.ok(distance(early, late) > 0.05);
  assert.equal(director.command, command);
  assert.equal(director.beatCount, 1);
});

test('modulation filters abrupt samples and converges equally at different frame rates', () => {
  const target = music({ beat: 0, amplitude: 0.35, frequencyHz: 9500, noisiness: 0.95, attack: 0.95 });
  const director = new MotionDirector();
  pulse(director, music(), 0.1);
  director.update(target, 0.1 + 1 / 90);
  assert.ok(director.features.amplitude > 0.1 && director.features.amplitude < 0.2);
  assert.ok(director.features.frequencyHz > 1200 && director.features.frequencyHz < 3000);
  assert.ok(director.features.noisiness < 0.3);
  const states = [30, 60, 90, 144].map((fps) => {
    const sampled = new MotionDirector();
    pulse(sampled, music(), 0.1);
    for (let frame = 1; frame <= fps / 2; frame++) sampled.update(target, 0.1 + frame / fps);
    assert.equal(sampled.beatCount, 1);
    return sampled.features;
  });
  for (const state of states.slice(1))
    for (const key of ['amplitude', 'frequencyHz', 'noisiness', 'attack'])
      assert.ok(Math.abs(state[key] - states[0][key]) < 1e-8, `${key} depends on frame rate`);
});

test('invalid or silent sensor frames retain the live palette without restarting a finished trajectory', () => {
  const director = new MotionDirector();
  pulse(director, music(), 0.1);
  for (let frame = 1; frame <= 20; frame++)
    director.update(
      music({ beat: 0, amplitude: 0.25, frequencyHz: 6500, beatPhase: 0.34 }),
      0.1 + frame / 90,
    );
  const retained = { ...director.features };
  const before = director.sample(0.33, { glyphCount: 4, beatPhase: 0.34 });
  for (const invalid of [{ audioSilent: 1 }, { audioSilent: 0, signalValid: 0 }]) {
    director.update(
      music({ ...invalid, beat: 0, amplitude: 0, frequencyHz: 0, energy: 0, beatPhase: 0.34 }),
      0.4,
    );
    assert.deepEqual(director.features, retained);
    assert.ok(distance(before, director.sample(0.4, { glyphCount: 4, beatPhase: 0.34 })) < 1e-10);
  }
  director.update(music({ beat: 0, amplitude: 0.35, frequencyHz: 10000 }), 2);
  assert.equal(director.beatCount, 1);
  assert.deepEqual(director.sample(2, { glyphCount: 4 }).group, {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  });
});

test('manual pause freezes live modulation and clock phase even if incoming features change', () => {
  const director = new MotionDirector();
  pulse(director, music(), 0.1);
  director.update(music({ beat: 0, beatPhase: 0.34 }), 0.28, { glyphCount: 4 });
  const retained = { ...director.features };
  director.update(music({ beat: 0, beatPhase: 0.34 }), 0.28, { paused: true, glyphCount: 4 });
  const frozen = director.sample(0.28, { glyphCount: 4, beatPhase: 0.34 });
  director.update(music({ amplitude: 1, frequencyHz: 10000, noisiness: 1, beatPhase: 0.9 }), 8, {
    paused: true,
    glyphCount: 4,
  });
  assert.deepEqual(director.features, retained);
  assert.deepEqual(director.sample(8, { glyphCount: 4, beatPhase: 0.9 }), frozen);
  assert.equal(director.beatCount, 1);
});

test('normal rhythmic variation and one outlier keep the held combination', () => {
  const director = new MotionDirector();
  pulse(director, music(), 0.1);
  const selected = [director.command.primary, director.command.secondary];
  for (let beat = 1; beat <= 12; beat++) {
    const jitter = beat % 2 ? 0.04 : -0.04;
    pulse(
      director,
      music({ bass: 0.7 + jitter, brightness: 0.35 + jitter, attack: 0.7 + jitter }),
      0.1 + beat * 0.55,
    );
    assert.deepEqual([director.command.primary, director.command.secondary], selected);
  }
  pulse(director, music({ noisiness: 0.95, treble: 0.9, brightness: 0.95, bass: 0.1 }), 7.3);
  pulse(director, music(), 7.85);
  assert.deepEqual([director.command.primary, director.command.secondary], selected);
  assert.equal(director.switchCount, 0);
});

test('persistent distinct music eventually switches once after multiple observed beats', () => {
  const director = new MotionDirector();
  pulse(director, music(), 0.1);
  const initial = director.command.primary;
  const changed = music({
    noisiness: 0.95,
    bass: 0.1,
    mid: 0.1,
    treble: 0.85,
    brightness: 0.95,
    attack: 0.9,
  });
  pulse(director, changed, 0.65);
  assert.equal(director.command.primary, initial);
  for (let beat = 2; beat <= 10; beat++) pulse(director, changed, 0.1 + beat * 0.55);
  assert.equal(director.command.primary, 'scatter');
  assert.equal(director.switchCount, 1);
  assert.ok(director.changeEvidence.score < 1);
});

test('clock pulses continue during sensor silence using the previous measured palette', () => {
  const director = new MotionDirector();
  pulse(director, music({ amplitudeTrend: 0.6 }), 0.1);
  const primary = director.command.primary;
  const frequency = director.command.features.frequencyHz;
  for (let beat = 1; beat <= 6; beat++) {
    pulse(
      director,
      { silent: 0, audioSilent: 1, energy: 0, bass: 0, attack: 0, amplitude: 0, frequencyHz: 0, bpm: 108 },
      0.1 + beat * 0.55,
    );
    assert.equal(director.command.primary, primary);
    assert.equal(director.command.features.frequencyHz, frequency);
    assert.ok(Math.abs(director.sample(0.25 + beat * 0.55, { glyphCount: 4 }).group.y) > 0.04);
  }
  assert.equal(director.beatCount, 7);
});

test('manual pause freezes poses and rejects clock pulses, resume preserves continuity', () => {
  const director = new MotionDirector();
  pulse(director, music(), 0.1);
  director.update(music({ beat: 0 }), 0.28, { paused: true, glyphCount: 4 });
  const frozen = director.sample(0.28, { glyphCount: 4 });
  director.update(music({ beat: 1 }), 3, { paused: true, glyphCount: 4 });
  assert.deepEqual(director.sample(3, { glyphCount: 4 }), frozen);
  assert.equal(director.beatCount, 1);
  director.update(music({ beat: 0 }), 3.1, { glyphCount: 4 });
  assert.ok(distance(director.sample(3.1, { glyphCount: 4 }), frozen) < 1e-10);
});

test('new clock beat blends smoothly with the prior finite pose and cannot self-generate pulses', () => {
  const director = new MotionDirector();
  const finiteMusic = music({ amplitudeTrend: 0.6 });
  pulse(director, finiteMusic, 0.1);
  assert.equal(director.command.cycle, null, 'This regression retains the legacy finite-only carry contract');
  const before = director.sample(0.5, { glyphCount: 4 });
  pulse(director, finiteMusic, 0.5);
  const after = director.sample(0.5, { glyphCount: 4 });
  assert.ok(distance(before, after) < 1e-10);
  director.update(music({ beat: 1 }), 0.51, { glyphCount: 4 });
  assert.equal(director.beatCount, 2);
  for (let second = 1; second < 8; second++) director.sample(second, { glyphCount: 4 });
  assert.equal(director.beatCount, 2);
  assert.deepEqual(director.sample(8, { glyphCount: 4 }).group, {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  });
});

test('extreme combined poses stay inside the stage across word sizes and canvas shapes', () => {
  for (const [width, height, count] of [
    [1100, 400, 2],
    [350, 180, 12],
    [1280, 250, 24],
  ]) {
    const spacing = (width * 0.78) / count;
    const glyphs = Array.from({ length: count }, (_, index) => ({
      x: (index - (count - 1) / 2) * spacing,
      y: 0,
      width: spacing * 0.95,
      height: Math.min(140, height * 0.5),
    }));
    for (const motion of MOTIONS) {
      const command = createMotionCommand(
        music({ energy: 1, amplitude: 0.4, noisiness: 0.95, attack: 1 }),
        1,
        { primary: motion.id, secondary: 'scatter', trend: 0 },
      );
      for (let step = 0; step <= 40; step++) {
        const value = sampleMotion(command, step / 40, { glyphCount: count, intensity: 2.5 });
        const fitted = constrainMotion(value, glyphs, { width, height });
        const bounds = fitted.bounds;
        assert.ok(bounds.left >= -1e-8 && bounds.right <= width + 1e-8, `${motion.id} horizontal overflow`);
        assert.ok(
          bounds.top >= -1e-8 && bounds.bottom <= height * 0.89 + 1e-8,
          `${motion.id} vertical overflow`,
        );
        assert.ok(fitted.group.scaleX > 0 && fitted.group.scaleY > 0);
      }
    }
  }
});

const swayMusic = (overrides = {}) =>
  music({
    bpm: 120,
    bass: 0.15,
    mid: 0.4,
    treble: 0.15,
    brightness: 0.35,
    attack: 0.2,
    amplitude: 0.1,
    frequencyHz: 1200,
    energy: 0.35,
    strength: 0.3,
    ...overrides,
  });

function clockSample(director, beatIndex, phase, features = swayMusic()) {
  const time = (beatIndex + phase) * 0.5;
  director.update({ ...features, beat: 0, beatIndex, beatPhase: 0 }, beatIndex * 0.5 - 0.0001, {
    glyphCount: 4,
  });
  director.update({ ...features, beat: 1, beatIndex, beatPhase: 0 }, beatIndex * 0.5, { glyphCount: 4 });
  director.update({ ...features, beat: 0, beatIndex, beatPhase: phase }, time, { glyphCount: 4 });
  return director.sample(time, { beatPhase: phase, glyphCount: 4 });
}

test('two continuous cycle choices preserve the eight finite motions and automatically fit twist/sway music', () => {
  assert.equal(MOTIONS.length, 8);
  assert.equal(MOTION_CYCLES.length, 2);
  assert.ok(MOTION_CYCLES.every(({ durationBeats }) => durationBeats === 2));
  assert.equal(chooseMotionCandidate(swayMusic()).cycle, 'alternating-sway');
  assert.equal(
    chooseMotionCandidate(swayMusic({ brightness: 0.82, frequencyTrend: 0.18 })).cycle,
    'alternating-twist',
  );
  assert.equal(chooseMotionCandidate(swayMusic({ amplitudeTrend: 0.8 })).cycle, null);
});

test('each two-beat trajectory turns left then right and exactly repeats after two shared beats', () => {
  for (const { id } of MOTION_CYCLES) {
    const command = createMotionCommand(swayMusic(), 0, {
      primary: 'twist',
      secondary: 'wave',
      trend: 0,
      cycle: id,
    });
    const left = sampleMotionCycle(command, { beatIndex: 0, beatPhase: 0.5, glyphCount: 4 });
    const right = sampleMotionCycle(command, { beatIndex: 1, beatPhase: 0.5, glyphCount: 4 });
    assert.ok(left.group.x < -0.015 && left.group.rotation < -0.08);
    assert.ok(right.group.x > 0.015 && right.group.rotation > 0.08);
    assert.equal(left.cycle.direction, 'left');
    assert.equal(right.cycle.direction, 'right');
    assert.equal(left.cycle.durationBeats, 2);
    const repeat = sampleMotionCycle(command, { beatIndex: 2, beatPhase: 0.5, glyphCount: 4 });
    assert.ok(distance(left, repeat) < 1e-12);
  }
});

test('the final directed pose keeps a clear left/right half-cycle after layering legacy movement', () => {
  const fixtures = [
    swayMusic(),
    swayMusic({ brightness: 0.82, frequencyTrend: 0.18 }),
    swayMusic({ bass: 0.75, attack: 0.7, energy: 0.6, strength: 0.5 }),
    swayMusic({ brightness: 0.85, bass: 0.1 }),
    swayMusic({ mid: 0.7, treble: 0.7, brightness: 0.45, noisiness: 0.8 }),
    swayMusic({ delivery: { drive: 1 } }),
    swayMusic({ bass: 0.75, attack: 0.7, energy: 0.6, strength: 0.5, delivery: { drive: 1 } }),
  ];
  for (const features of fixtures) {
    for (const intensity of [0.15, 0.85, 1.25, 2.5]) {
      for (const phase of [0.25, 0.5, 0.75]) {
        const director = new MotionDirector({ intensity });
        const left = clockSample(director, 0, phase, features);
        const right = clockSample(director, 1, phase, features);
        assert.ok(
          left.group.x < 0 && left.group.rotation < 0,
          `${director.command.primary} left ${phase} ${intensity}`,
        );
        assert.ok(
          right.group.x > 0 && right.group.rotation > 0,
          `${director.command.primary} right ${phase} ${intensity}`,
        );
        const repeat = clockSample(director, 2, phase, features);
        assert.ok(
          distance(left, repeat) < 1e-8,
          'Identical features repeat the same physical pose every two beats',
        );
      }
    }
  }
});

test('directed cycles remain continuous at the left/right boundary and at the two-beat repeat', () => {
  for (const boundary of [1, 2]) {
    const director = new MotionDirector();
    clockSample(director, boundary - 1, 0.99999);
    const before = director.sample(boundary * 0.5 - 0.000005, { glyphCount: 4, beatPhase: 0.99999 });
    const after = clockSample(director, boundary, 0.00001);
    assert.ok(
      distance(before, after) < 0.0002,
      'Final pose must cross the boundary without restarting its body swing',
    );
  }
});

test('an early PLL beat carries only finite movement and samples the current cycle once', () => {
  const director = new MotionDirector();
  const features = swayMusic({ bpm: 108 });
  director.update({ ...features, beat: 1, beatIndex: 0, beatPhase: 0 }, 0, { glyphCount: 4 });
  director.update({ ...features, beat: 0, beatIndex: 0, beatPhase: 0.995 }, 0.519, { glyphCount: 4 });
  const before = director.sample(0.519, { glyphCount: 4, beatPhase: 0.995 });
  const finiteCarry = director.sample(0.52, { glyphCount: 4, includeCycle: false });
  director.update({ ...features, beat: 1, beatIndex: 1, beatPhase: 0.005 }, 0.52, { glyphCount: 4 });
  const after = director.sample(0.52, { glyphCount: 4, beatPhase: 0.005 });
  assert.ok(
    after.group.x > 0 && after.group.rotation > 0,
    'A carried old left cycle must not cancel this right beat',
  );
  assert.ok(
    distance(before, after) < 0.015,
    'Shared-cycle crossing must stay continuous even when wall-time and PLL phase differ',
  );
  assert.ok(
    distance(director.carry, finiteCarry) < 1e-12,
    'Carry cannot contain another copy of the previous cycle',
  );
  director.update({ ...features, beat: 0, beatIndex: 1, beatPhase: 0.25 }, 0.656, { glyphCount: 4 });
  const quarter = director.sample(0.656, { glyphCount: 4, beatPhase: 0.25 });
  assert.ok(quarter.group.x > 0 && quarter.group.rotation > 0);
});

test('global parity outranks private beat counts and continues through quiet audio, clear and source changes', () => {
  const director = new MotionDirector();
  director.beatCount = 91;
  const left = clockSample(director, 4, 0.5);
  assert.equal(director.command.beatIndex, 4);
  assert.ok(left.group.x < 0 && left.group.rotation < 0);
  const quiet = {
    ...swayMusic(),
    audioSilent: 1,
    signalValid: 0,
    amplitude: 0,
    frequencyHz: 0,
    energy: 0,
    bass: 0,
    brightness: 0,
  };
  const right = clockSample(director, 5, 0.5, quiet);
  assert.equal(right.cycle.beatIndex, 5);
  assert.ok(right.group.x > 0 && right.group.rotation > 0);
  assert.equal(
    director.features.frequencyHz,
    1200,
    'Silence retains the measured palette, but never its old beat index',
  );
  director.clear();
  director.beatCount = 0;
  const rebased = clockSample(director, 9, 0.5, { ...swayMusic(), sourceGeneration: 44 });
  assert.equal(rebased.cycle.beatIndex, 9);
  assert.ok(rebased.group.x > 0 && rebased.group.rotation > 0);
  assert.equal(director.getState(4.75, { beatPhase: 0.5, glyphCount: 4 }).cycle.beatWithinCycle, 1);
});

test('manual pause freezes cycle phase and pose even when incoming global position changes', () => {
  const director = new MotionDirector();
  const active = clockSample(director, 4, 0.5);
  director.update({ ...swayMusic(), beat: 0, beatIndex: 4, beatPhase: 0.5 }, 2.25, {
    paused: true,
    glyphCount: 4,
  });
  director.update({ ...swayMusic(), beat: 1, beatIndex: 100, beatPhase: 0.9 }, 50, {
    paused: true,
    glyphCount: 4,
  });
  const frozen = director.sample(50, { glyphCount: 4, beatPhase: 0.9 });
  assert.ok(distance(active, frozen) < 1e-12);
  assert.deepEqual(frozen.cycle, active.cycle);
  director.update({ ...swayMusic(), beat: 0, beatIndex: 4, beatPhase: 0.5 }, 50.1, { glyphCount: 4 });
  const resumed = director.sample(50.1, { glyphCount: 4, beatPhase: 0.5 });
  assert.ok(distance(active, resumed) < 1e-12);
});

test('all four measured dimensions directly reshape the same held two-beat cycle', () => {
  const command = createMotionCommand(swayMusic(), 0, {
    primary: 'sway',
    secondary: 'wave',
    trend: 0,
    cycle: 'alternating-sway',
  });
  const sample = (changes) =>
    sampleMotionCycle(command, {
      beatIndex: 0,
      beatPhase: 0.38,
      glyphCount: 4,
      features: swayMusic(changes),
    });
  for (const [low, high] of [
    [{ frequencyHz: 150 }, { frequencyHz: 9000 }],
    [{ frequencyTrend: -0.9 }, { frequencyTrend: 0.9 }],
    [{ amplitude: 0.006 }, { amplitude: 0.3 }],
    [{ amplitudeTrend: -0.9 }, { amplitudeTrend: 0.9 }],
    [{ brightness: 0.02 }, { brightness: 0.95 }],
    [{ noisiness: 0.01 }, { noisiness: 0.95 }],
    [{ attack: 0.02 }, { attack: 0.95 }],
  ])
    assert.ok(distance(sample(low), sample(high)) > 0.01);
  const first = sample({});
  const shifted = sampleMotionCycle(command, { beatIndex: 0, beatPhase: 0.7, glyphCount: 4 });
  assert.ok(distance(first, shifted) > 0.05);
  const reduced = sampleMotionCycle(command, {
    beatIndex: 0,
    beatPhase: 0.38,
    glyphCount: 4,
    reducedMotion: true,
  });
  const normalTravel = distance(first, neutralMotionForTest(4));
  assert.ok(distance(reduced, neutralMotionForTest(4)) < normalTravel * 0.1);
});

function neutralMotionForTest(glyphCount) {
  const group = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  return { group, glyphs: Array.from({ length: glyphCount }, () => ({ ...group })) };
}

const drumHit = (overrides = {}) => ({
  hit: true,
  sequence: 1,
  kind: 'thump',
  weight: 0.8,
  strength: 0.8,
  confidence: 0.85,
  time: 1,
  ...overrides,
});

function drumDirector(hit = drumHit(), features = {}) {
  const director = new MotionDirector();
  director.update(music({ ...features, beat: 0, beatIndex: 12, beatPhase: 0.63, drum: hit }), 1, {
    glyphCount: 4,
  });
  return director;
}

test('a measured drum initiates a physical accent before BPM learning without manufacturing a grid beat', () => {
  const director = drumDirector();
  assert.equal(director.command, null);
  assert.equal(director.beatCount, 0);
  assert.equal(director.accent.started, 1);
  const firstFrame = director.sample(1 + 1 / 60, { glyphCount: 4 });
  const peak = director.sample(1.024, { glyphCount: 4 });
  assert.ok(firstFrame.group.scaleX > 1.05, 'The first 60 Hz frame already shows a grounded drum response');
  assert.ok(peak.group.y > 0.05 && peak.group.scaleX > 1.15 && peak.group.scaleY < 0.9);
  assert.equal(peak.accent.source, 'drum');
  assert.equal(peak.accent.gridPhaseAtOnset, 0.63, 'Actual hits may arrive anywhere in the estimated cycle');
  assert.equal(peak.accent.peakSeconds, 0.024);
  assert.equal(director.beatCount, 0);
  assert.deepEqual(director.sample(1.4, { glyphCount: 4 }).group, neutralMotionForTest(4).group);
});

test('drum weight continuously orders the same action while thump, snap and tick have distinct poses', () => {
  const weights = [0.12, 0.35, 0.6, 0.9];
  for (const kind of ['thump', 'snap', 'tick']) {
    const magnitudes = weights.map((weight) => {
      const director = drumDirector(drumHit({ kind, weight }));
      return distance(director.sampleAccentMotion(1.024, { glyphCount: 4 }), neutralMotionForTest(4));
    });
    assert.ok(
      magnitudes.every((value, index) => index === 0 || value > magnitudes[index - 1]),
      kind,
    );
    assert.ok(
      magnitudes.at(-1) > magnitudes[0] * 3,
      `${kind} heavy and light must look noticeably different`,
    );
  }
  const [thump, snap, tick] = ['thump', 'snap', 'tick'].map((kind) =>
    drumDirector(drumHit({ kind })).sampleAccentMotion(1.024, { glyphCount: 4 }),
  );
  assert.ok(thump.group.y > 0 && thump.group.scaleY < 1);
  assert.ok(snap.group.y < 0 && snap.glyphs[0].x < 0 && snap.glyphs.at(-1).x > 0);
  assert.deepEqual(
    tick.group,
    neutralMotionForTest(4).group,
    'Light subdivisions do not shake the whole body',
  );
  assert.ok(tick.glyphs.every(({ y, scaleY }) => y < 0 && scaleY > 1));
  assert.ok(distance(thump, snap) > 0.2 && distance(snap, tick) > 0.1);
});

test('cached and out-of-order drum snapshots cannot restart an accent or double an observed onset', () => {
  const director = drumDirector(drumHit(), {
    observedBeat: true,
    observedConfidence: 1,
    observedStrength: 1,
  });
  const accent = director.accent;
  for (let frame = 1; frame < 20; frame++)
    director.update(
      music({ beat: 0, drum: drumHit(), observedBeat: true, observedStrength: 1 }),
      1 + frame / 90,
    );
  assert.equal(director.accent, accent);
  assert.equal(director.accent.started, 1);
  assert.equal(director.accent.source, 'drum');
  director.update(music({ beat: 0, drum: drumHit({ sequence: 0 }) }), 1.3);
  assert.equal(director.accent, accent);
  director.update(music({ beat: 0, drum: drumHit({ hit: false, sequence: 2 }), observedBeat: false }), 1.4);
  director.update(
    music({ beat: 0, drum: drumHit({ hit: false, sequence: 2 }), observedBeat: true, observedConfidence: 1 }),
    1.41,
  );
  assert.equal(
    director.accent,
    accent,
    'Periodic observed flags cannot invent a hit in a drum-enabled stream',
  );
});

test('a grid beat samples the same real drum accent once and never puts it into the finite carry', () => {
  const director = drumDirector();
  const before = director.sample(1.024, { glyphCount: 4 });
  director.update(music({ beat: 1, beatIndex: 13, drum: drumHit({ hit: false }) }), 1.024, { glyphCount: 4 });
  const after = director.sample(1.024, { glyphCount: 4, beatPhase: 0 });
  assert.ok(distance(before, after) < 1e-12);
  assert.deepEqual(director.carry.group, neutralMotionForTest(4).group);
  assert.equal(after.accent.sequence, 1);
  assert.equal(director.beatCount, 1);
});

test('nearby real drum hits morph from the current accent and settle without stacking old impacts', () => {
  const director = drumDirector();
  const old = director.sampleAccentMotion(1.07, { glyphCount: 4 });
  director.update(music({ beat: 0, drum: drumHit({ sequence: 2, kind: 'snap' }) }), 1.07, { glyphCount: 4 });
  const onset = director.sampleAccentMotion(1.07, { glyphCount: 4 });
  assert.ok(
    distance(old, onset) < 1e-12,
    'The second hit starts from the visible pose, without a neutral snap',
  );
  const peak = director.sampleAccentMotion(1.094, { glyphCount: 4 });
  assert.ok(peak.group.y < 0, 'The new snap replaces, rather than accumulates with, the downward thump');
  const isolated = drumDirector(drumHit({ kind: 'snap' })).sampleAccentMotion(1.024, { glyphCount: 4 });
  assert.ok(distance(peak, isolated) < 1e-10);
  assert.ok(distance(director.sampleAccentMotion(1.5, { glyphCount: 4 }), neutralMotionForTest(4)) < 1e-12);
});

test('manual pause freezes drum motion and consumes hits received while held instead of replaying on resume', () => {
  const director = drumDirector();
  director.update(music({ beat: 0, drum: drumHit({ hit: false }) }), 1.015, { paused: true, glyphCount: 4 });
  const frozen = director.sample(1.015, { glyphCount: 4 });
  director.update(music({ beat: 0, drum: drumHit({ sequence: 2, kind: 'snap' }) }), 8, {
    paused: true,
    glyphCount: 4,
  });
  assert.deepEqual(director.sample(8, { glyphCount: 4 }), frozen);
  director.update(music({ beat: 0, drum: drumHit({ sequence: 2, kind: 'snap' }) }), 8.1, { glyphCount: 4 });
  assert.ok(distance(director.sample(8.1, { glyphCount: 4 }), frozen) < 1e-10);
  assert.equal(director.accent.sequence, 1);
  director.update(music({ beat: 0, drum: drumHit({ sequence: 3, kind: 'snap' }) }), 8.13, { glyphCount: 4 });
  assert.equal(director.accent.sequence, 3);
});

test('silence, source changes, clear and invalid drum evidence discard stale accents while the shared cycle continues', () => {
  const director = drumDirector(drumHit(), { sourceGeneration: 1 });
  director.update(music({ beat: 0, audioSilent: true, drum: drumHit({ sequence: 2 }) }), 1.03);
  assert.equal(director.accent, null);
  director.update(music({ beat: 0, audioSilent: false, drum: drumHit({ sequence: 2 }) }), 1.04);
  assert.equal(director.accent, null, 'The hit consumed during silence is not replayed');
  director.update(music({ beat: 0, drum: drumHit({ sequence: 3 }) }), 1.1);
  assert.equal(director.accent.sequence, 3);
  director.update(music({ beat: 0, sourceGeneration: 2, drum: drumHit({ hit: false, sequence: 3 }) }), 1.12);
  assert.equal(director.accent, null);
  director.update(music({ beat: 1, beatIndex: 14, drum: drumHit({ sequence: 4, confidence: 0.1 }) }), 1.5);
  assert.equal(director.accent, null);
  assert.equal(director.command.beatIndex, 14);
  assert.equal(director.command.cycle, 'alternating-twist');
  director.update(music({ beat: 0, drum: drumHit({ sequence: 5 }) }), 1.6);
  director.clear();
  director.update(music({ beat: 0, drum: drumHit({ sequence: 5 }) }), 1.61);
  assert.equal(director.accent, null, 'Clearing a word must not replay the last cached hit');
});

test('drum accents respect reduced motion and stage bounds for intense repeated hits and long keywords', () => {
  for (const kind of ['thump', 'snap', 'tick']) {
    const director = drumDirector(drumHit({ kind, weight: 1, strength: 1 }));
    director.setIntensity(2.5);
    const normal = director.sample(1.024, { glyphCount: 12 });
    const reduced = director.sample(1.024, { glyphCount: 12, reducedMotion: true });
    assert.ok(
      distance(reduced, neutralMotionForTest(12)) < distance(normal, neutralMotionForTest(12)) * 0.09,
    );
    const glyphs = Array.from({ length: 12 }, (_, index) => ({
      x: (index - 5.5) * 25,
      y: 0,
      width: 24,
      height: 80,
    }));
    const fitted = constrainMotion(normal, glyphs, { width: 350, height: 180 });
    assert.ok(fitted.bounds.left >= 0 && fitted.bounds.right <= 350);
    assert.ok(fitted.bounds.top >= 0 && fitted.bounds.bottom <= 180 * 0.89);
  }
});

test('denser musical delivery adds faster details to held finite and two-beat poses without changing shared BPM or parity', () => {
  const command = createMotionCommand(swayMusic(), 4, {
    primary: 'sway',
    secondary: 'wave',
    trend: 0,
    cycle: 'alternating-sway',
  });
  for (const beatIndex of [4, 5]) {
    const calm = sampleMotionCycle(command, {
      beatIndex,
      beatPhase: 0.38,
      glyphCount: 4,
      features: swayMusic({ delivery: { drive: 0 } }),
    });
    const intense = sampleMotionCycle(command, {
      beatIndex,
      beatPhase: 0.38,
      glyphCount: 4,
      features: swayMusic({ delivery: { drive: 1 } }),
    });
    assert.ok(distance(calm, intense) > 0.08, 'Activity affects the physical held pose');
    assert.deepEqual(calm.cycle, intense.cycle, 'Delivery cannot invent another left/right cycle');
    assert.equal(Math.sign(calm.group.x), Math.sign(intense.group.x));
    assert.equal(Math.sign(calm.group.rotation), Math.sign(intense.group.rotation));
    const finiteCalm = sampleMotion(command, 0.38, {
      glyphCount: 4,
      features: swayMusic({ deliveryDrive: 0 }),
    });
    const finiteIntense = sampleMotion(command, 0.38, {
      glyphCount: 4,
      features: swayMusic({ deliveryDrive: 1 }),
    });
    assert.ok(distance(finiteCalm, finiteIntense) > 0.05);
  }
  const director = new MotionDirector();
  clockSample(director, 4, 0.38);
  const heldCommand = director.command;
  for (let frame = 1; frame <= 45; frame++)
    director.update(
      swayMusic({ beat: 0, beatIndex: 4, beatPhase: 0.38, delivery: { drive: 1 } }),
      2.19 + frame / 90,
      { glyphCount: 4 },
    );
  assert.equal(director.command, heldCommand);
  assert.equal(director.command.features.bpm, 120);
  assert.equal(director.beatCount, 1);
  assert.equal(director.clockBeatIndex, 4);
  assert.equal(director.switchCount, 0);
  assert.ok(director.features.deliveryDrive > 0.98);
});
