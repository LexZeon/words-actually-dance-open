import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planQuarterTurnLayout,
  quarterTurnBounds,
  sampleQuarterTurnTransition,
} from '../src/visuals/quarter-turn-layout.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const inside = (bounds, width, height) => {
  assert.ok(bounds.left >= -1e-7 && bounds.top >= -1e-7, JSON.stringify(bounds));
  assert.ok(bounds.right <= width + 1e-7 && bounds.bottom <= height + 1e-7, JSON.stringify(bounds));
};
const disjoint = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

test('planar quarter turns swap measured width and height, including 45-degree sweep', () => {
  const source = { width: 300, height: 40, centerX: 200, centerY: 100, scale: 0.5 };
  const upright = quarterTurnBounds(source);
  const sideways = quarterTurnBounds({ ...source, angleDeg: 90 });
  near(upright.width, 150);
  near(upright.height, 20);
  near(sideways.width, 20);
  near(sideways.height, 150);
  const diagonal = quarterTurnBounds({ ...source, angleDeg: 45 });
  near(diagonal.width, 170 / Math.sqrt(2));
  near(diagonal.height, diagonal.width);
});

test('all three accumulated past rotations occupy disjoint slots around readable current type', () => {
  const history = [
    { width: 140, height: 36, fontPx: 30 },
    { width: 220, height: 42, fontPx: 27 },
    { width: 120, height: 38, fontPx: 28 },
  ];
  const result = planQuarterTurnLayout({
    width: 900,
    height: 260,
    current: { width: 450, height: 100, fontPx: 27 },
    history,
  });
  assert.equal(result.current.angleDeg, 0);
  assert.equal(result.currentReadable, true);
  assert.deepEqual(
    result.history.map((entry) => entry.angleDeg),
    [90, 180, 270],
  );
  assert.deepEqual(result.omitted, []);
  const all = [result.current, ...result.history];
  for (let index = 0; index < all.length; index++) {
    inside(all[index].bounds, result.width, result.height);
    for (let next = index + 1; next < all.length; next++)
      assert.ok(disjoint(all[index].bounds, all[next].bounds));
  }
  assert.deepEqual(history, [
    { width: 140, height: 36, fontPx: 30 },
    { width: 220, height: 42, fontPx: 27 },
    { width: 120, height: 38, fontPx: 28 },
  ]);
});

test('very long older sentences leave first, and the newly retired sentence still turns fully', () => {
  const result = planQuarterTurnLayout({
    width: 320,
    height: 150,
    current: { width: 160, height: 44, fontPx: 24 },
    history: [
      { width: 2000, height: 48, fontPx: 27 },
      { width: 3000, height: 400, fontPx: 27 },
      { width: 5000, height: 600, fontPx: 27 },
      { width: 30, height: 24, fontPx: 27 },
    ],
  });
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].angleDeg, 90);
  assert.ok(result.history[0].scale > 0);
  assert.ok(result.history[0].renderedFontPx < 8);
  assert.deepEqual(result.omitted, [1, 2, 3]);
  assert.equal(result.currentReadable, true);
  inside(result.history[0].bounds, 320, 150);
});

test('small windows prioritize current readability over retaining a decorative archive', () => {
  const result = planQuarterTurnLayout({
    width: 320,
    height: 180,
    current: { width: 290, height: 150, fontPx: 18 },
    history: [{ width: 240, height: 30, fontPx: 27 }],
  });
  assert.equal(result.currentReadable, true);
  assert.equal(result.history.length, 0);
  assert.deepEqual(result.omitted, [0]);
  inside(result.current.bounds, 320, 180);
});

test('every shrink-turn-settle sample stays inside the stage even for very long and resized type', () => {
  for (const [width, height] of [
    [900, 260],
    [320, 150],
    [90, 65],
    [1, 1],
  ]) {
    for (const length of [40, 240, 1000, 20000]) {
      const box = { width: length, height: 40, fontPx: 27 };
      const previous = planQuarterTurnLayout({ width, height, current: box }).current;
      const next = planQuarterTurnLayout({
        width,
        height,
        current: { width: 90, height: 30, fontPx: 24 },
        history: [box],
        minCurrentFontPx: 0.001,
      }).history[0];
      assert.ok(next);
      const transition = { width, height, from: previous, to: next };
      for (let step = 0; step <= 160; step++) {
        const sample = sampleQuarterTurnTransition(transition, step / 160);
        assert.ok(Number.isFinite(sample.scale) && Number.isFinite(sample.angleDeg));
        inside(sample.bounds, width, height);
      }
      const start = sampleQuarterTurnTransition(transition, 0);
      const end = sampleQuarterTurnTransition(transition, 1);
      near(start.scale, previous.scale);
      near(end.scale, next.scale);
      near(end.angleDeg - start.angleDeg, 90);
      assert.equal(start.finished, false);
      assert.equal(end.finished, true);
    }
  }
});

test('historical sentences continue another full 90 degrees instead of resetting or flipping on X/Y', () => {
  const bounds = { width: 130, height: 30, fontPx: 27 };
  const source = planQuarterTurnLayout({
    width: 800,
    height: 260,
    current: bounds,
    history: [bounds, bounds, bounds],
  });
  for (const age of [0, 1]) {
    const from = source.history[age];
    const to = source.history[age + 1];
    const transition = { from, to, width: 800, height: 260 };
    let previousAngle = from.angleDeg;
    for (let index = 0; index <= 100; index++) {
      const sample = sampleQuarterTurnTransition(transition, index / 100);
      assert.ok(sample.angleDeg >= previousAngle);
      inside(sample.bounds, 800, 260);
      previousAngle = sample.angleDeg;
    }
    near(previousAngle - from.angleDeg, 90);
  }
});

test('transient zero measurements, invalid options, and out-of-range progress never produce NaN', () => {
  const result = planQuarterTurnLayout({
    width: Number.NaN,
    height: 0,
    current: { width: 0, height: Number.POSITIVE_INFINITY },
    history: [{ width: -5, height: null }],
    padding: Number.NaN,
    gap: Number.POSITIVE_INFINITY,
  });
  for (const entry of [result.current, ...result.history]) inside(entry.bounds, 1, 1);
  const before = sampleQuarterTurnTransition({ from: result.current, width: 1, height: 1 }, -2);
  const after = sampleQuarterTurnTransition({ from: result.current, width: 1, height: 1 }, 4);
  assert.equal(before.progress, 0);
  assert.equal(after.progress, 1);
  for (const entry of [before, after]) inside(entry.bounds, 1, 1);
});
