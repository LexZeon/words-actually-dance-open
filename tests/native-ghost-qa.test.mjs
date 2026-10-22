import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { validateGhostFrame } from '../src/dev/ghost-qa.js';
import { GHOST_EFFECTS } from '../src/core/ghost-effects.js';

const {
  validateNativeGhostResponse,
  createGhostQAFixture,
  createGhostToneFixtures,
  scoreGhostToneCases,
  scoreGhostQuietTail,
} = createRequire(import.meta.url)('../electron/ghost-qa.cjs');
const pose = (y = 0) => ({
  group: { x: 0, y, rotation: 0, scaleX: 1, scaleY: 1 },
  glyphs: [{ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }],
});

test('quiet tail acceptance requires actually painted historical voiced poses and no new silent-window attacks', () => {
  const row = {
    quietFrames: 100,
    quietVoicedTailFrames: 15,
    quietLayerPaintFrames: 20,
    quietNewToneHits: 0,
    quietNewDrumHits: 0,
    monotonicSourceTime: true,
    finite: true,
    withinBounds: true,
    delayValid: true,
  };
  assert.equal(scoreGhostQuietTail(row).pass, true);
  for (const change of [
    { quietVoicedTailFrames: 0 },
    { quietLayerPaintFrames: 0 },
    { quietNewToneHits: 1 },
    { quietNewDrumHits: 1 },
    { monotonicSourceTime: false },
    { withinBounds: false },
  ])
    assert.equal(scoreGhostQuietTail({ ...row, ...change }).pass, false);
});
const input = () => ({
  state: {
    active: true,
    layers: { main: { opacity: 1, ...pose(0.05) }, ghost: { opacity: 0.2, ...pose() } },
    anchor: { x: 450, y: 157.5 },
    combinedBounds: { left: 200, top: 80, right: 650, bottom: 260 },
    historySamples: 40,
    maxHistorySamples: 128,
    delaySeconds: 0.11,
    sourceTime: 0.89,
  },
  elapsed: 1,
  width: 900,
  height: 350,
  paints: [
    { color: '#ffffff', alpha: 1 },
    { color: '#ffffff', alpha: 0.2 },
  ],
});

test('ghost frame validation requires real white opaque and low-alpha Canvas paints plus delayed poses', () => {
  const checked = validateGhostFrame(input());
  for (const key of [
    'visible',
    'bounded',
    'finite',
    'sameAnchor',
    'boundedHistory',
    'correctOpacity',
    'delayed',
  ])
    assert.equal(checked[key], true, key);
  assert.equal(checked.mainPaints, 1);
  assert.equal(checked.ghostPaints, 1);
  assert.ok(checked.poseDifference > 0.01);
  const missing = input();
  missing.paints = [{ color: '#ffffff', alpha: 1 }];
  assert.equal(
    validateGhostFrame(missing).ghostPaints,
    0,
    'a metadata layer cannot stand in for a real paint',
  );
  const future = input();
  future.state.sourceTime = 1.1;
  assert.equal(validateGhostFrame(future).delayed, false);
  const wrong = input();
  wrong.state.layers.ghost.opacity = 1;
  assert.equal(validateGhostFrame(wrong).correctOpacity, false);
  const overflow = input();
  overflow.state.combinedBounds.right = 920;
  assert.equal(validateGhostFrame(overflow).bounded, false);
  const offCenter = input();
  offCenter.state.anchor.x = 0;
  assert.equal(validateGhostFrame(offCenter).sameAnchor, false);
});

const valid = () => ({
  pass: true,
  actualWebAudio: true,
  actualCanvasPaint: true,
  labelsFedToDetector: false,
  cases: GHOST_EFFECTS.map(({ id }) => ({
    effect: id,
    voicedFrames: 200,
    actualDrumHits: 6,
    visibleFrames: 180,
    actualLayerPaintFrames: 180,
    maximumPoseDifference: 0.05,
    finite: true,
    withinBounds: true,
    sameAnchor: true,
    boundedHistory: true,
    opacityValid: true,
    delayValid: true,
    monotonicSourceTime: true,
  })),
  lifecycle: {
    pauseStable: true,
    resumeRetainsDelay: true,
    wordClearsHistory: true,
    resizeClearsHistory: true,
    offRemovesLayer: true,
    reducedRemovesGhost: true,
    sourceClearsHistory: true,
  },
});
test('native ghost aggregate rejects missing effects, silent audio, invisible layers and lifecycle failures', () => {
  assert.equal(validateNativeGhostResponse(valid()), true);
  for (const mutate of [
    (r) => r.cases.pop(),
    (r) => {
      r.cases[1].effect = r.cases[0].effect;
    },
    (r) => {
      r.cases[0].voicedFrames = 0;
    },
    (r) => {
      r.cases[0].actualLayerPaintFrames = 0;
    },
    (r) => {
      r.cases[0].maximumPoseDifference = 0;
    },
    (r) => {
      r.cases[0].monotonicSourceTime = false;
    },
    (r) => {
      r.lifecycle.pauseStable = false;
    },
    (r) => {
      delete r.lifecycle.sourceClearsHistory;
    },
    (r) => {
      r.labelsFedToDetector = true;
    },
  ]) {
    const r = valid();
    mutate(r);
    assert.equal(validateNativeGhostResponse(r), false);
  }
});

test('quiet tone audio has host-only references and scoring requires each observed kind and automatic effect', async () => {
  const { payload, references, tailPayload } = await createGhostToneFixtures(process.cwd());
  assert.equal(payload.length, 5);
  for (const fixture of payload) {
    assert.deepEqual(Object.keys(fixture).sort(), ['base64', 'name', 'seconds']);
    const bytes = Buffer.from(fixture.base64, 'base64');
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    let peak = 0;
    for (let offset = 44; offset < bytes.length; offset += 2)
      peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)) / 32768);
    assert.ok(
      peak > 0.005 && peak < 0.1,
      'quiet actual source remains audible without being a loud heavy-drum fixture',
    );
  }
  assert.deepEqual(Object.keys(tailPayload).sort(), ['base64', 'name', 'seconds']);
  const tailBytes = Buffer.from(tailPayload.base64, 'base64');
  const quietStart = Math.round(0.5 * tailBytes.readUInt32LE(24));
  const quietEnd = Math.round(0.7 * tailBytes.readUInt32LE(24));
  for (let sample = quietStart; sample < quietEnd; sample++)
    assert.equal(tailBytes.readInt16LE(44 + sample * 2), 0, 'short source has actual zero PCM between notes');
  const rows = references.map(({ name, kind, effect }) => ({
    name,
    voicedFrames: 100,
    toneValidFrames: 100,
    toneKinds: { [kind]: 90 },
    chosenEffects: { [effect]: 80 },
    actualLayerPaintFrames: 80,
    withinBounds: true,
    finite: true,
    sameAnchor: true,
    boundedHistory: true,
    delayValid: true,
    opacityValid: true,
    monotonicSourceTime: true,
  }));
  assert.equal(scoreGhostToneCases(rows, references).pass, true);
  for (const mutate of [
    (r) => r.pop(),
    (r) => {
      r[1].name = r[0].name;
    },
    (r) => {
      r[0].chosenEffects = {};
    },
    (r) => {
      r[0].toneKinds = {};
    },
    (r) => {
      r[0].voicedFrames = 0;
    },
    (r) => {
      r[0].actualLayerPaintFrames = 0;
    },
    (r) => {
      r[0].monotonicSourceTime = false;
    },
  ]) {
    const copy = structuredClone(rows);
    mutate(copy);
    assert.equal(scoreGhostToneCases(copy, references).pass, false);
  }
});

test('native ghost audio payload has PCM bytes without tempo, drum, section or effect reference labels', async () => {
  const fixture = await createGhostQAFixture(process.cwd());
  assert.deepEqual(Object.keys(fixture).sort(), ['base64', 'name', 'seconds']);
  const bytes = Buffer.from(fixture.base64, 'base64');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(24), 48000);
});
