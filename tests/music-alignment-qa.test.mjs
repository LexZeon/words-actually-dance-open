import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus, EVENTS } from '../src/core/events.js';
import { collectAlignment, runAnnotatedFile } from '../src/dev/music-alignment-qa.js';

function appFixture() {
  const app = {
    bus: createEventBus(),
    audio: { context: { currentTime: 10 }, startedAt: 2, mode: 'file' },
    playback: {
      metrics: { fps: 60 },
      onFrame: () => {
        app.pose.x = 4;
      },
    },
    pose: { x: 0 },
    dance: { getMotionState: () => ({ accent: { active: true }, poses: { group: app.pose } }) },
  };
  return app;
}

test('alignment records the drawn pose and translates beat timestamps to file time', (t) => {
  const app = appFixture();
  t.mock.method(performance, 'now', () => 100000);
  const stop = collectAlignment(app, { file: true });
  app.bus.emit(EVENTS.BEAT_GRID, { kind: 'beat', time: 99.9, bpm: 120 });
  app.playback.onFrame({ playing: true, time: 100, measured: {}, grid: { phase: 0.2 }, rendering: {} });
  const result = stop();
  assert.ok(Math.abs(result.beats[0].time - 7.9) < 1e-9);
  assert.equal(result.frames[0].musicTime, 8);
  assert.equal(result.frames[0].group.x, 4);
  app.bus.emit(EVENTS.BEAT_GRID, { kind: 'beat', time: 100 });
  assert.equal(result.beats.length, 1);
});

test('releasing a recorder never overwrites a later frame callback', () => {
  const app = appFixture(),
    stop = collectAlignment(app);
  const replacement = () => {};
  app.playback.onFrame = replacement;
  stop();
  assert.equal(app.playback.onFrame, replacement);
});

test('a fixture cannot autoplay another track at its boundary or report that new track duration', async (t) => {
  const app = appFixture();
  const next = () => assert.fail('autoplay must be suspended during fixture');
  app.audio.onNextTrack = next;
  app.audio.buffer = { duration: 60 };
  app.audio.addTrack = async () => 0;
  app.audio.playTrack = async () => true;
  app.audio.setPaused = async () => {};
  app.setPlaying = () => {};
  app.changeSource = async (start) => start();
  const previous = globalThis.window;
  globalThis.window = {};
  t.after(() => {
    globalThis.window = previous;
  });
  t.mock.method(globalThis, 'setTimeout', (callback) => {
    assert.equal(app.audio.onNextTrack(), false);
    app.audio.buffer = { duration: 35 };
    queueMicrotask(callback);
  });
  const result = await runAnnotatedFile(app, { name: 'reference', base64: 'AAAA' });
  assert.equal(result.fileDuration, 60);
  assert.equal(app.audio.onNextTrack, next);
});

test('failed playback restores the original autoplay callback and frame handler', async (t) => {
  const app = appFixture(),
    next = () => {},
    oldFrame = app.playback.onFrame;
  app.audio.onNextTrack = next;
  app.audio.addTrack = async () => 0;
  app.audio.setPaused = async () => {};
  app.setPlaying = () => {};
  app.changeSource = async () => {
    throw new Error('start failed');
  };
  const previous = globalThis.window;
  globalThis.window = {};
  t.after(() => {
    globalThis.window = previous;
  });
  await assert.rejects(runAnnotatedFile(app, { name: 'reference', base64: 'AAAA' }), /start failed/);
  assert.equal(app.audio.onNextTrack, next);
  assert.equal(app.playback.onFrame, oldFrame);
});
