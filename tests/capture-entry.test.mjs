import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from '../src/app/app-controller.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function controller(start) {
  const calls = [];
  const app = Object.assign(Object.create(AppController.prototype), {
    destroyed: false,
    audioPending: 0,
    audioCommands: Promise.resolve(),
    contentGeneration: 0,
    audio: { startSystem: start },
    playback: {
      resetSource() {
        calls.push('reset');
      },
    },
    setPlaying() {
      calls.push('playing');
    },
    ui: {
      closePanel() {
        calls.push('close');
      },
    },
  });
  return { app, calls };
}

test('the real click entry requests capture synchronously and queues only its completion', async () => {
  const capture = deferred();
  let requests = 0,
    oldIntent;
  const { app, calls } = controller(() => {
    requests++;
    assert.equal(oldIntent.isCurrent(), false);
    return capture.promise;
  });
  oldIntent = app.reserveImportIntent('music');
  const pending = app.captureSystem();
  assert.equal(requests, 1, 'the picker must start before returning from the click');
  assert.equal(app.audioPending, 1);
  assert.deepEqual(calls, [], 'the old source remains until capture is ready');
  capture.resolve(true);
  assert.equal(await pending, true);
  assert.deepEqual(calls, ['reset', 'playing', 'close']);
  assert.equal(app.audioPending, 0);
});

test('a busy or destroyed controller cannot request a late picker', async () => {
  const { app } = controller(() => assert.fail('picker'));
  app.audioPending = 1;
  assert.throws(() => app.captureSystem(), /正在处理音源/);
  app.destroyed = true;
  assert.equal(await app.captureSystem(), false);
});

test('closing before the queued completion consumes capture rejection without state changes', async () => {
  const capture = deferred();
  const { app, calls } = controller(() => capture.promise);
  const pending = app.captureSystem();
  app.destroyed = true;
  capture.reject(new Error('user cancelled'));
  await pending;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, []);
  assert.equal(app.audioPending, 0);
});
