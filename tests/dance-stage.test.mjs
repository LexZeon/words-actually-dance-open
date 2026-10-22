import test from 'node:test';
import assert from 'node:assert/strict';
import { DanceStage } from '../src/visuals/dance-stage.js';

function stageFixture(run) {
  const saved = {
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    ResizeObserver: globalThis.ResizeObserver,
  };
  let requested = 0,
    measured = 0,
    resized,
    disconnected = false;
  const bounds = { width: 1000, height: 400 };
  const painted = [];
  const context = {
    font: '',
    setTransform() {},
    fillRect() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    setLineDash() {},
    beginPath() {},
    moveTo() {},
    bezierCurveTo() {},
    stroke() {},
    fillText(text) {
      painted.push(text);
    },
    measureText(text) {
      measured++;
      return { width: (Number(this.font.match(/([\d.]+)px/u)?.[1]) || 100) * [...text].length * 0.6 };
    },
  };
  globalThis.requestAnimationFrame = () => ++requested;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resized = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  };
  const stage = new DanceStage(
    { style: {}, getContext: () => context, getBoundingClientRect: () => bounds },
    { managedFrame: true },
  );
  try {
    return run({
      stage,
      painted,
      bounds,
      notifyResize: () => resized(),
      disconnected: () => disconnected,
      requested: () => requested,
      measured: () => measured,
    });
  } finally {
    stage.destroy();
    Object.assign(globalThis, saved);
  }
}

test('concept relationships are painted only through transitioning glyphs, without a separate label row', () => {
  stageFixture(({ stage, painted }) => {
    stage.setWord('时间参照', {}, { immediate: true });
    stage.setWord('BPM', { from: '时间参照', to: 'BPM', type: 'contrast', label: '概念连接' });
    stage.elapsed = 0.22;
    painted.length = 0;
    stage.draw();
    assert.ok(painted.length > 0);
    assert.ok(painted.every((text) => [...'时间参照BPM'].includes(text)));
    assert.ok(!painted.includes('概念连接') && !painted.includes('↔') && !painted.includes('BPM'));
    assert.equal(stage.getMotionState().transition.kind, 'contrast');
    assert.equal(stage.getMotionState().transition.label, '概念连接');
  });
});

test('managed rendering uses seconds from the shared frame loop and freezes elapsed time on pause', () => {
  stageFixture(({ stage, requested }) => {
    stage.setWord('节拍', {}, { immediate: true });
    stage.frame(1);
    stage.frame(1.02);
    assert.ok(Math.abs(stage.elapsed - 0.02) < 1e-9);
    assert.equal(requested(), 0);
    stage.setPaused(true);
    stage.frame(2);
    stage.frame(2.02);
    assert.ok(Math.abs(stage.elapsed - 0.02) < 1e-9);
    stage.setPaused(false);
    stage.frame(4);
    stage.frame(4.016);
    assert.ok(Math.abs(stage.elapsed - 0.036) < 1e-9);
  });
});

test('static words reuse font metrics across frames and transition metrics have a bounded cache', () => {
  stageFixture(({ stage, measured }) => {
    stage.setWord('学习', {}, { immediate: true });
    const initial = measured();
    for (let frame = 0; frame < 100; frame++) stage.draw();
    assert.equal(measured(), initial);
    for (let size = 20; size < 1200; size++) stage.measureGlyph('学', size);
    assert.ok(stage.measurements.size <= 1024);
  });
});

test('dropped frames do not delay a keyword handoff beyond its shared-time deadline', () => {
  stageFixture(({ stage }) => {
    stage.setWord('连接', {}, { immediate: true });
    stage.frame(1);
    stage.setWord('理解', { from: '连接', to: '理解', type: 'cause' }, { beatDuration: 0.5 });
    assert.equal(stage.transition.duration, 0.425);
    stage.frame(1.5);
    assert.equal(stage.elapsed, 0.5);
    assert.equal(stage.transition, null, 'A finished handoff must settle even when only one frame arrives');
    assert.equal(stage.glyphs.map(({ char }) => char).join(''), '理解');
  });
});

test('a keyword emitted before the current render starts at this frame time, after dropped frames', () => {
  stageFixture(({ stage }) => {
    stage.setWord('连接', {}, { immediate: true });
    stage.setFeatures({ time: 1, beat: 0, silent: 0 });
    stage.frame(1);
    // Production order: features -> knowledge keyword callback -> rendering.
    stage.setFeatures({ time: 1.5, beat: 1, silent: 0, bpm: 120, beatPhase: 0 });
    stage.setWord('理解', { from: '连接', to: '理解', type: 'cause' }, { beatDuration: 0.5 });
    stage.frame(1.5);
    assert.ok(stage.transition, 'New handoff must remain visible in its first rendered frame');
    assert.equal(stage.transition.started, stage.elapsed);
    assert.equal(stage.getMotionState().transition.progress, 0);
    assert.equal(stage.lastPulse.time, stage.elapsed, 'The current music pulse shares the same logical time');
    const elapsedAtStart = stage.elapsed;
    stage.setFeatures({ time: 1.7, beat: 0, silent: 0, bpm: 120, beatPhase: 0.4 });
    stage.frame(1.7);
    assert.ok(
      Math.abs(stage.elapsed - elapsedAtStart - 0.2) < 1e-9,
      'Feature and render passes cannot double time',
    );
    assert.ok(stage.getMotionState().transition.progress > 0.4);
    stage.setFeatures({ time: 2, beat: 0, silent: 0, bpm: 120, beatPhase: 0.9 });
    stage.frame(2);
    assert.equal(stage.transition, null);
    assert.equal(stage.glyphs.map(({ char }) => char).join(''), '理解');
  });
});

test('pausing after a same-frame keyword callback freezes its projected start and resumes without the pause gap', () => {
  stageFixture(({ stage }) => {
    stage.setWord('连接', {}, { immediate: true });
    stage.setFeatures({ time: 1, beat: 0, silent: 0 });
    stage.frame(1);
    stage.setFeatures({ time: 1.5, beat: 1, silent: 0, bpm: 120, beatPhase: 0 });
    stage.setWord('理解', { from: '连接', to: '理解', type: 'cause' }, { beatDuration: 0.5 });
    stage.setPaused(true);
    stage.frame(1.5);
    const started = stage.transition.started;
    assert.equal(started, 0.5);
    stage.setFeatures({ time: 20, beat: 0, silent: 1 });
    stage.frame(20);
    assert.equal(stage.elapsed, started);
    assert.equal(stage.getMotionState().transition.progress, 0);
    stage.setPaused(false);
    stage.setFeatures({ time: 21, beat: 0, silent: 0 });
    stage.frame(21);
    assert.equal(stage.getMotionState().transition.progress, 0);
    stage.setFeatures({ time: 21.2, beat: 0, silent: 0 });
    stage.frame(21.2);
    assert.ok(stage.getMotionState().transition.progress > 0.4);
  });
});

test('resizing a paused handoff preserves progress and deadline through repeated layout changes', () => {
  stageFixture(({ stage, bounds, notifyResize }) => {
    stage.setWord('时间参照', {}, { immediate: true });
    stage.setWord('BPM', { from: '时间参照', to: 'BPM', type: 'contrast' }, { beatDuration: 0.5 });
    stage.frame(1);
    stage.frame(1.1);
    stage.frame(1.2);
    stage.frame(1.3);
    stage.setPaused(true);
    const before = stage.getMotionState().transition;
    const deadline = stage.transition.started + stage.transition.duration;
    for (let index = 0; index < 8; index++) {
      bounds.width = index % 2 ? 1000 : 720;
      bounds.height = index % 2 ? 400 : 280;
      notifyResize();
      assert.equal(stage.getMotionState().transition.progress, before.progress);
      assert.equal(stage.transition.started + stage.transition.duration, deadline);
      assert.equal(stage.getMotionState().transition.kind, before.kind);
      assert.ok(stage.transition.targets.every(({ size }) => Number.isFinite(size)));
    }
    stage.setPaused(false);
    stage.frame(2);
    stage.frame(2.14);
    assert.equal(stage.transition, null);
    assert.equal(stage.glyphs.map(({ char }) => char).join(''), 'BPM');
  });
});

test('queued resize notifications and frames cannot repaint a destroyed stage', () => {
  stageFixture(({ stage, painted, bounds, notifyResize, disconnected }) => {
    stage.setWord('节拍', {}, { immediate: true });
    const canvasWidth = stage.canvas.width;
    stage.destroy();
    assert.equal(disconnected(), true);
    painted.length = 0;
    bounds.width = 500;
    notifyResize();
    stage.frame(99);
    assert.equal(stage.canvas.width, canvasWidth);
    assert.deepEqual(painted, []);
    assert.equal(stage.measurements.size, 0);
  });
});
