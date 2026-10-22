import test from 'node:test';
import assert from 'node:assert/strict';
import { TextFlowLayout, textFlowCameraMatrix } from '../src/visuals/text-flow-layout.js';

const near = (actual, expected, epsilon = 1e-7) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const world = ({ id, width, height, fontPx, centerX, centerY, angleDeg }) => ({
  id,
  width,
  height,
  fontPx,
  centerX,
  centerY,
  angleDeg,
});
const distance = (a, b) => Math.hypot(a.centerX - b.centerX, a.centerY - b.centerY);
const box = { width: 420, height: 80, fontPx: 64 };
const viewport = { width: 900, height: 260 };

test('new phrases attach to one persistent rotating plane and finish horizontally', () => {
  const flow = new TextFlowLayout();
  const first = flow.append(box, viewport, { id: 'first' });
  assert.equal(first.currentId, 'first');
  assert.equal(first.progress, 1);
  assert.equal(first.nodes[0].screenPose.angleDeg, 0);
  assert.ok(first.nodes[0].screenPose.renderedFontPx >= 64);
  flow.append({ width: 260, height: 80, fontPx: 64 }, viewport, { id: 'next' });
  const halfway = flow.sample(0.5);
  near(halfway.camera.angleDeg, 45);
  assert.equal(halfway.nodes[0].angleDeg, 0);
  assert.equal(halfway.nodes[1].angleDeg, -90);
  const end = flow.sample(1);
  near(end.nodes[0].screenPose.angleDeg, 90);
  near(end.nodes[1].screenPose.angleDeg, 0);
  assert.equal(end.currentReadable, true);
  assert.equal(end.currentFits, true);
  assert.ok(end.nodes[0].bounds.right <= end.nodes[1].bounds.left - 1);
});

test('the camera scales pair distances uniformly and never moves individual historical nodes', () => {
  const flow = new TextFlowLayout();
  flow.append(box, viewport);
  flow.append({ width: 300, height: 90, fontPx: 64 }, viewport);
  const before = flow.snapshot().nodes.map(world);
  const worldDistance = distance(before[0], before[1]);
  for (const progress of [0, 0.1, 0.3, 0.6, 0.9, 1]) {
    const frame = flow.sample(progress);
    assert.deepEqual(frame.nodes.map(world), before);
    near(distance(frame.nodes[0].screenPose, frame.nodes[1].screenPose), worldDistance * frame.camera.zoom);
    assert.ok(frame.nodes.every((node) => node.screenPose.scale === frame.camera.zoom));
  }
  flow.append({ width: 360, height: 80, fontPx: 64 }, viewport);
  assert.deepEqual(flow.snapshot().nodes.slice(0, 2).map(world), before);
});

test('old type stays large and may leave the viewport rather than fitting decorative edge slots', () => {
  const flow = new TextFlowLayout();
  flow.append({ width: 640, height: 160, fontPx: 64 }, viewport);
  flow.append({ width: 140, height: 80, fontPx: 64 }, viewport);
  const frame = flow.sample(1);
  assert.ok(frame.nodes[0].screenPose.renderedFontPx >= 64);
  assert.equal(frame.nodes[0].screenPose.clipped, true);
  assert.ok(frame.nodes[1].screenPose.renderedFontPx >= 64);
  assert.ok(frame.nodes[1].screenPose.renderedFontPx <= 100);
  assert.equal(frame.currentFits, true);
});

test('five-node history avoids collisions when a fourth rotation revisits the initial orientation', () => {
  const flow = new TextFlowLayout();
  for (let index = 0; index < 18; index++) {
    flow.append(box, viewport, { id: `sentence-${index}` });
    const frame = flow.sample(1);
    assert.equal(frame.nodes.length, Math.min(index + 1, 5));
    near(frame.camera.angleDeg, index * 90);
    near(frame.nodes.at(-1).screenPose.angleDeg, 0);
    for (let first = 0; first < frame.nodes.length; first++) {
      for (let second = first + 1; second < frame.nodes.length; second++) {
        const a = frame.nodes[first].bounds;
        const b = frame.nodes[second].bounds;
        assert.ok(
          a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
          JSON.stringify(frame.nodes.map(world)),
        );
      }
    }
    if (index >= 5) assert.deepEqual(frame.removedIds, [`sentence-${index - 5}`]);
  }
  assert.deepEqual(
    flow.snapshot().nodes.map((node) => node.screenPose.angleDeg),
    [360, 270, 180, 90, 0],
  );
});

test('resize during a paused turn preserves progress, rotation, and all world coordinates', () => {
  const flow = new TextFlowLayout();
  flow.append(box, viewport);
  flow.append({ width: 480, height: 100, fontPx: 64 }, viewport);
  const before = flow.sample(0.47);
  const after = flow.resize({ width: 520, height: 200 });
  near(after.progress, before.progress);
  near(after.camera.angleDeg, before.camera.angleDeg);
  assert.deepEqual(after.nodes.map(world), before.nodes.map(world));
  assert.equal(after.active, true);
  const repeated = flow.sample(0.2);
  near(repeated.progress, before.progress);
  assert.deepEqual(repeated.camera, after.camera);
  const end = flow.sample(1);
  assert.equal(end.currentFits, true);
  assert.equal(end.currentReadable, true);
});

test('camera matrix matches the shared plane transform used to paint each node', () => {
  const flow = new TextFlowLayout();
  flow.append(box, viewport);
  flow.append({ width: 180, height: 80, fontPx: 64 }, viewport);
  const frame = flow.sample(0.61);
  const matrix = textFlowCameraMatrix(frame.camera);
  for (const node of frame.nodes) {
    near(matrix.a * node.centerX + matrix.c * node.centerY + matrix.e, node.screenPose.centerX);
    near(matrix.b * node.centerX + matrix.d * node.centerY + matrix.f, node.screenPose.centerY);
  }
});

test('zero-history mode, reset, immutable inputs, and transient invalid measurements are safe', () => {
  const flow = new TextFlowLayout({ maxHistory: 0 });
  const measurement = { ...box };
  const inputViewport = { ...viewport };
  flow.append(measurement, inputViewport);
  flow.append(
    { width: 0, height: Number.NaN, fontPx: Number.POSITIVE_INFINITY },
    { width: 0, height: Number.NaN },
  );
  const frame = flow.sample(5);
  assert.equal(frame.nodes.length, 1);
  assert.equal(frame.progress, 1);
  assert.ok(Object.values(frame.camera).every(Number.isFinite));
  assert.deepEqual(measurement, box);
  assert.deepEqual(inputViewport, viewport);
  const empty = flow.clear();
  assert.deepEqual(empty.nodes, []);
  assert.equal(empty.camera, null);
  const restarted = flow.append(box, viewport);
  assert.equal(restarted.nodes[0].angleDeg, 0);
  near(restarted.camera.angleDeg, 0);
});

test('unwrapped text reports an impossible reading fit honestly instead of forcing overflowing minimum scale', () => {
  const flow = new TextFlowLayout();
  const frame = flow.append({ width: 20000, height: 64, fontPx: 64 }, { width: 320, height: 180 });
  assert.equal(frame.currentReadable, false);
  assert.equal(frame.currentFits, true);
  assert.ok(frame.nodes[0].screenPose.renderedFontPx < 18);
});
