import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicSectionDetector } from '../src/audio/music-section.js';
import { MotionDirector, constrainMotion } from '../src/visuals/dance-motion.js';

const base = {
  amplitude: 0.08,
  energy: 0.5,
  bass: 0.3,
  mid: 0.3,
  treble: 0.1,
  brightness: 0.25,
  noisiness: 0.05,
  attack: 0.2,
  strength: 0.2,
  bpm: 120,
  amplitudeTrend: 0,
  frequencyTrend: 0,
  signalValid: 1,
  silent: 0,
  audioSilent: 0,
};
const high = {
  ...base,
  amplitude: 0.3,
  energy: 1,
  treble: 0.8,
  brightness: 0.85,
  noisiness: 0.4,
  attack: 0.8,
  amplitudeTrend: 0.5,
  frequencyTrend: 0.4,
};
function runSection(fps, signal) {
  const section = new MusicSectionDetector();
  let onset;
  for (let frame = 0; frame < 8 * fps; frame++) {
    const time = frame / fps;
    const result = section.update(signal(time), time);
    if (onset === undefined && result.high) onset = time;
  }
  return { section, onset };
}
test('a sustained louder spectral/timbre change is detected promptly across render rates', () => {
  const timings = [30, 60, 90, 144].map((fps) => runSection(fps, (time) => (time < 5 ? base : high)).onset);
  assert.ok(
    timings.every((time) => time >= 6.2 && time <= 6.6),
    JSON.stringify(timings),
  );
  assert.ok(Math.max(...timings) - Math.min(...timings) < 0.08);
});
test('one loud hit, a brightness-only change, ordinary modulation and silence cannot claim a high-energy section', () => {
  for (const signal of [
    (time) => (time >= 5 && time < 5.04 ? high : base),
    (time) => (time >= 5 ? { ...base, brightness: 0.9, treble: 0.9 } : base),
    (time) => ({
      ...base,
      amplitude: 0.08 * (1 + 0.12 * Math.sin(time * 12)),
      brightness: 0.25 + 0.03 * Math.sin(time * 10),
    }),
    (time) => (time >= 5 ? { ...high, audioSilent: 1, signalValid: 0 } : base),
  ]) {
    const result = runSection(90, signal);
    assert.equal(result.onset, undefined);
    assert.equal(result.section.episodes, 0);
  }
});
test('a detected phrase lasts multiple unified beats, modulates live features and freezes on pause', () => {
  const director = new MotionDirector();
  for (let frame = 0; frame <= 7 * 120; frame++) {
    const time = frame / 120,
      beatIndex = Math.floor(time * 2 + 1e-8),
      phase = (time * 2) % 1;
    director.update({ ...(time < 5 ? base : high), beat: frame % 60 === 0, beatPhase: phase }, time, {
      glyphCount: 4,
    });
  }
  assert.ok(director.phrase && director.phrase.durationBeats >= 4 && director.phrase.durationBeats <= 8);
  const before = director.getState(7, { glyphCount: 4, beatPhase: 0.4 });
  assert.ok(before.phrase.active && before.sample.phrase.envelope > 0.1);
  const beatCount = director.beatCount;
  const up = director.sample(7, { glyphCount: 4, beatPhase: 0.4 });
  director.features = { ...director.features, amplitudeTrend: -0.7, frequencyTrend: -0.7 };
  const down = director.sample(7, { glyphCount: 4, beatPhase: 0.4 });
  assert.ok(down.group.y > up.group.y + 0.02, 'multi-beat lift follows live directions');
  director.update({ ...high, beatPhase: 0.4, beat: 0 }, 7, { paused: true, glyphCount: 4 });
  const frozen = director.sample(7, { glyphCount: 4, beatPhase: 0.4 });
  director.update({ ...base, beat: 1, beatPhase: 0.9 }, 50, { paused: true, glyphCount: 4 });
  assert.deepEqual(director.sample(50, { glyphCount: 4, beatPhase: 0.9 }), frozen);
  assert.equal(director.beatCount, beatCount);
  const glyphs = Array.from({ length: 4 }, (_, index) => ({
    x: (index - 1.5) * 90,
    y: 0,
    width: 90,
    height: 110,
  }));
  const fitted = constrainMotion(up, glyphs, { width: 450, height: 220 });
  assert.ok(fitted.bounds.left >= 0 && fitted.bounds.right <= 450);
  assert.ok(fitted.bounds.top >= 0 && fitted.bounds.bottom <= 220 * 0.89);
});

function controlledDirector() {
  const director = new MotionDirector();
  const initial = () => ({ high: false, episodes: 0, probability: 0, validSeconds: 8 });
  const section = {
    state: initial(),
    lastInput: null,
    cue(episode, probability = 0.9) {
      this.state = { ...this.state, episodes: episode, probability, high: true };
    },
    reset() {
      this.state = initial();
    },
    holdTime() {},
    getState() {
      return { ...this.state };
    },
    update(features) {
      this.lastInput = features;
      return this.getState();
    },
  };
  director.section = section;
  return { director, section };
}

function frame(
  director,
  position,
  { beat = false, time = position / 2, paused = false, reducedMotion = false, ...features } = {},
) {
  return director.update(
    { ...base, ...features, beat, beatIndex: Math.floor(position), beatPhase: position % 1 },
    time,
    { paused, reducedMotion, glyphCount: 4 },
  );
}
function gridBeat(director, index, features = {}) {
  frame(director, index, { ...features, time: index / 2 - 0.001 });
  return frame(director, index, { ...features, beat: true });
}
const poseKeys = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];
const poseDifference = (one, two) =>
  poseKeys.reduce((sum, key) => sum + Math.abs(one.group[key] - two.group[key]), 0) +
  one.glyphs.reduce(
    (sum, glyph, index) =>
      sum + poseKeys.reduce((part, key) => part + Math.abs(glyph[key] - two.glyphs[index][key]), 0),
    0,
  );

test('one sustained high-energy episode starts one finite phrase and leaves ordinary dancing after it ends', () => {
  const { director, section } = controlledDirector();
  section.cue(1);
  for (let index = 0; index < 80; index++) gridBeat(director, index);
  assert.equal(director.phraseStarts, 1, 'Constant high must not restart a phrase every ten beats');
  assert.equal(director.phrase.episodeId, 1);
  assert.equal(director.phrase.startBeat, 0);
  const ordinary = director.sample(39.75, { glyphCount: 4, beatPhase: 0.5 });
  assert.equal(ordinary.phrase.active, false);
  assert.deepEqual(ordinary, director.sample(39.75, { glyphCount: 4, beatPhase: 0.5, includePhrase: false }));
  assert.ok(
    ordinary.cycle.active && Math.abs(ordinary.group.x) > 0.01,
    'Normal shared-cycle dancing continues',
  );
});

test('a new episode waits for the next global beat and an ended pending episode never replays', () => {
  const { director, section } = controlledDirector();
  frame(director, 2.2);
  section.cue(1, 0.7);
  frame(director, 2.4);
  assert.equal(director.phrase, null);
  assert.equal(director.pendingPhrase.episodeId, 1);
  gridBeat(director, 3);
  assert.equal(director.phrase.startBeat, 3);
  assert.equal(director.phrase.durationBeats, 6);
  assert.equal(director.phrase.episodeId, 1);
  section.cue(2);
  frame(director, 3.2);
  assert.equal(director.pendingPhrase.episodeId, 2);
  section.state.high = false;
  frame(director, 3.6);
  assert.equal(director.pendingPhrase, null);
  for (let index = 4; index <= 12; index++) gridBeat(director, index);
  assert.equal(director.phraseStarts, 1);
  section.state.high = true;
  gridBeat(director, 13);
  assert.equal(
    director.phraseStarts,
    1,
    'A repeated high flag without a new episode has no selection authority',
  );
  section.cue(3);
  gridBeat(director, 14);
  assert.equal(director.phraseStarts, 2);
  assert.equal(director.phrase.episodeId, 3);
});

test('another valid episode never replaces an active multi-beat phrase and can start at its following boundary', () => {
  const { director, section } = controlledDirector();
  section.cue(1, 0.7);
  gridBeat(director, 0);
  const original = director.phrase;
  section.cue(2, 0.95);
  for (let index = 1; index < 6; index++) {
    gridBeat(director, index);
    assert.equal(director.phrase, original);
    assert.equal(director.phraseStarts, 1);
  }
  gridBeat(director, 6);
  assert.equal(director.phrase.episodeId, 2);
  assert.equal(director.phrase.startBeat, 6);
  assert.equal(director.phrase.durationBeats, 8);
  assert.equal(director.phraseStarts, 2);
});

test('clear and a committed source reset discard pending phrases and permit episode one of the new section epoch', () => {
  const { director, section } = controlledDirector();
  frame(director, 0, { sourceGeneration: 1 });
  section.cue(1);
  gridBeat(director, 1, { sourceGeneration: 1 });
  const firstGeneration = director.phrase.sectionGeneration;
  section.cue(2);
  frame(director, 1.4, { sourceGeneration: 1 });
  director.clear();
  assert.equal(director.phrase, null);
  assert.equal(director.pendingPhrase, null);
  section.cue(1);
  gridBeat(director, 2, { sourceGeneration: 1 });
  assert.equal(director.phrase.episodeId, 1);
  assert.equal(director.phraseStarts, 2);
  assert.ok(director.phrase.sectionGeneration > firstGeneration);
  frame(director, 2.4, { sourceGeneration: 2 });
  assert.equal(director.phrase, null);
  assert.equal(director.pendingPhrase, null);
  section.cue(1);
  gridBeat(director, 3, { sourceGeneration: 2 });
  assert.equal(director.phrase.episodeId, 1);
  assert.equal(director.phrase.sourceGeneration, 2);
  assert.equal(director.phraseStarts, 3);
});

test('pause consumes pending or paused episodes while freezing the active pose, without replaying on resume', () => {
  const { director, section } = controlledDirector();
  section.cue(1);
  gridBeat(director, 0);
  frame(director, 0.4);
  section.cue(2);
  frame(director, 0.5);
  const before = director.sample(0.25, { glyphCount: 4, beatPhase: 0.5 });
  frame(director, 0.5, { paused: true });
  assert.equal(director.pendingPhrase, null);
  section.cue(3);
  frame(director, 90.9, { paused: true, time: 50 });
  assert.deepEqual(director.sample(50, { glyphCount: 4, beatPhase: 0.9 }), before);
  frame(director, 0.5, { time: 50.1 });
  assert.deepEqual(director.sample(50.1, { glyphCount: 4, beatPhase: 0.5 }), before);
  for (let index = 1; index < 16; index++) {
    frame(director, index, { time: 50.1 + index / 2 });
    frame(director, index, { beat: true, time: 50.1 + index / 2 + 0.001 });
  }
  assert.equal(director.phraseStarts, 1);
  section.cue(4);
  frame(director, 16, { time: 59 });
  frame(director, 16, { beat: true, time: 59.001 });
  assert.equal(director.phraseStarts, 2);
  assert.equal(director.phrase.episodeId, 4);
});

test('silent or invalid observations consume a pending high-energy cue without stopping shared beat motion', () => {
  const { director, section } = controlledDirector();
  section.cue(1);
  frame(director, 0.2);
  frame(director, 0.4, { signalValid: 0, audioSilent: 1 });
  assert.equal(director.pendingPhrase, null);
  gridBeat(director, 1);
  gridBeat(director, 2);
  assert.equal(director.phraseStarts, 0);
  assert.equal(director.beatCount, 2);
  assert.ok(director.getState(1.2, { glyphCount: 4, beatPhase: 0.4 }).cycle.active);
});

test('a phrase layer is sampled once at grid boundaries and reduced motion bounds that same finite gesture', () => {
  const { director, section } = controlledDirector();
  section.cue(1, 0.7);
  gridBeat(director, 0);
  gridBeat(director, 1);
  frame(director, 1.99);
  const finiteCarry = director.sample(1, {
    glyphCount: 4,
    includeCycle: false,
    includeAccent: false,
    includePhrase: false,
  });
  gridBeat(director, 2);
  assert.deepEqual(director.carry.group, finiteCarry.group);
  assert.deepEqual(director.carry.glyphs, finiteCarry.glyphs);
  const normal = director.sample(1.2, { glyphCount: 4, beatPhase: 0.4 });
  const basePose = director.sample(1.2, { glyphCount: 4, beatPhase: 0.4, includePhrase: false });
  const reduced = director.sample(1.2, { glyphCount: 4, beatPhase: 0.4, reducedMotion: true });
  const reducedBase = director.sample(1.2, {
    glyphCount: 4,
    beatPhase: 0.4,
    reducedMotion: true,
    includePhrase: false,
  });
  assert.ok(poseDifference(normal, basePose) > 0.15);
  assert.ok(poseDifference(reduced, reducedBase) < poseDifference(normal, basePose) * 0.1);
  const state = director.getState(1.2, { glyphCount: 4, beatPhase: 0.4 });
  assert.equal(state.phrase.episodeId, 1);
  assert.equal(state.phrase.startBeat, 0);
  assert.equal(state.phrase.cueSource, 'observed-section');
  assert.equal(state.phraseStarts, 1);
});

test('section density receives actual drum identities rather than manufacturing observations from internal beats', () => {
  const { director, section } = controlledDirector();
  const drum = { hit: true, sequence: 2, weight: 0.7, confidence: 0.9, kind: 'thump' };
  frame(director, 0.2, { drum });
  assert.equal(section.lastInput.drum, drum);
  assert.equal(section.lastInput.observedBeat, false);
  gridBeat(director, 1, { drum: { ...drum, hit: false } });
  assert.equal(section.lastInput.drum.hit, false);
  assert.equal(
    section.lastInput.observedBeat,
    false,
    'An internal cycle beat is not section density evidence',
  );
});

test('the real section detector produces one finite phrase for a lasting lift, then ordinary motion remains visible', () => {
  const director = new MotionDirector();
  for (let index = 0; index <= 20 * 120; index++) {
    const time = index / 120;
    director.update(
      {
        ...(time < 5 ? base : high),
        beat: index % 60 === 0,
        beatIndex: Math.floor(index / 60),
        beatPhase: (index % 60) / 60,
      },
      time,
      { glyphCount: 4 },
    );
  }
  const state = director.getState(20.25, { glyphCount: 4, beatPhase: 0.5 });
  assert.equal(state.section.episodes, 1);
  assert.equal(state.phraseStarts, 1);
  assert.equal(state.phrase.active, false);
  assert.ok(state.primary && state.beatCount >= 40);
  assert.ok(
    poseDifference(state.sample, {
      group: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      glyphs: Array.from({ length: 4 }, () => ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })),
    }) > 0.1,
    'The finite section gesture ending cannot stop the shared dance',
  );
});

test('the complete dancing pose, including drum accents and carry, remains reduced through a phrase and its ending', () => {
  const normal = controlledDirector(),
    reduced = controlledDirector();
  normal.section.cue(1, 0.7);
  reduced.section.cue(1, 0.7);
  const rest = {
    group: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    glyphs: Array.from({ length: 4 }, () => ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })),
  };
  let visibleSamples = 0;
  for (let index = 0; index <= 10 * 60; index++) {
    const position = index / 60,
      time = index / 120;
    const drum = {
      sequence: Math.floor(index / 30),
      hit: index % 30 === 0,
      kind: 'thump',
      weight: 0.8,
      strength: 0.9,
      confidence: 0.95,
    };
    const features = { ...high, drum, beat: index % 60 === 0, time };
    frame(normal.director, position, features);
    frame(reduced.director, position, { ...features, reducedMotion: true });
    const large = normal.director.sample(time, { glyphCount: 4, beatPhase: position % 1 });
    const small = reduced.director.sample(time, {
      glyphCount: 4,
      beatPhase: position % 1,
      reducedMotion: true,
    });
    const travel = poseDifference(large, rest);
    if (travel > 0.03) {
      visibleSamples++;
      assert.ok(
        poseDifference(small, rest) < travel * 0.15,
        `Reduced travel at global beat position ${position}`,
      );
    }
    assert.equal(small.cycle.direction, large.cycle.direction);
    assert.equal(small.phrase.episodeId, large.phrase.episodeId);
    if (index === 6 * 60 - 1) {
      const ending = normal.director.sample(time, { glyphCount: 4, beatPhase: 0.9999 });
      const ordinary = normal.director.sample(time, {
        glyphCount: 4,
        beatPhase: 0.9999,
        includePhrase: false,
      });
      assert.ok(
        poseDifference(ending, ordinary) < 1e-7,
        'The section layer fades smoothly to the ordinary pose',
      );
    }
    if (position >= 6) {
      assert.equal(large.phrase.active, false);
      assert.equal(small.phrase.active, false);
      assert.deepEqual(
        large,
        normal.director.sample(time, { glyphCount: 4, beatPhase: position % 1, includePhrase: false }),
      );
    }
  }
  assert.ok(visibleSamples > 500);
  assert.equal(normal.director.phraseStarts, 1);
  assert.equal(reduced.director.phraseStarts, 1);
});
