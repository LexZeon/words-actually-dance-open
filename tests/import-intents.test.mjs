import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportIntents } from '../src/core/import-intents.js';
import { AppController } from '../src/app/app-controller.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('a later selection aborts its channel without cancelling the other channel', () => {
  const gate = new ImportIntents();
  const text = gate.reserve('script'),
    music = gate.reserve('music');
  const replacement = gate.reserve('script');
  assert.equal(text.signal.aborted, true);
  assert.equal(music.isCurrent(), true);
  text.cancel();
  assert.equal(replacement.isCurrent(), true);
  gate.destroy();
  assert.equal(music.signal.aborted, true);
  assert.equal(replacement.isCurrent(), false);
});

test('cloud text reserved before download cannot replace a later local file', async () => {
  const accepted = [];
  const app = { contentGeneration: 0, destroyed: false, applyScriptFile: (name) => accepted.push(name) };
  const cloud = AppController.prototype.reserveImportIntent.call(app, 'script');
  await AppController.prototype.importScriptFile.call(app, {
    name: 'local.txt',
    size: 2,
    arrayBuffer: async () => new ArrayBuffer(2),
  });
  let read = false;
  const result = await AppController.prototype.importScriptFile.call(
    app,
    {
      name: 'cloud.txt',
      size: 2,
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(2);
      },
    },
    { intent: cloud },
  );
  assert.equal(result, false);
  assert.equal(read, false);
  assert.deepEqual(accepted, ['local.txt']);
});

test('a newer music selection prevents an older decoded file from starting', async () => {
  const decode = deferred(),
    played = [];
  const app = {
    destroyed: false,
    contentGeneration: 0,
    audio: {
      addTrack: () => decode.promise,
      playTrack: (index) => {
        played.push(index);
        return true;
      },
    },
    switchSource: async (start) => start(),
  };
  const cloud = AppController.prototype.reserveImportIntent.call(app, 'music');
  const pending = AppController.prototype.performImportFiles.call(
    app,
    [
      {
        name: 'cloud.wav',
        size: 2,
        arrayBuffer: async () => new ArrayBuffer(2),
      },
    ],
    cloud,
  );
  await Promise.resolve();
  AppController.prototype.reserveImportIntent.call(app, 'music');
  decode.resolve(0);
  assert.equal(await pending, false);
  assert.deepEqual(played, []);
});

test('tokens cannot commit into another controller and closing aborts downloads', async () => {
  const first = { destroyed: false, contentGeneration: 0 };
  const second = { destroyed: false, contentGeneration: 0, applyScriptFile: () => assert.fail('commit') };
  const token = AppController.prototype.reserveImportIntent.call(first, 'script');
  assert.equal(await AppController.prototype.importScriptFile.call(second, {}, { intent: token }), false);
  first.destroyed = true;
  assert.equal(token.isCurrent(), false);
  first.importIntents.destroy();
  assert.equal(token.signal.aborted, true);
});
