import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from '../src/app/app-controller.js';
import { parseScriptInput } from '../src/content/script-document.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('an obsolete file read cannot overwrite a newer content request', async () => {
  const read = deferred(),
    accepted = [];
  const app = { contentGeneration: 0, destroyed: false, applyScriptFile: (name) => accepted.push(name) };
  const slow = AppController.prototype.importScriptFile.call(app, {
    size: 5,
    name: '旧文件.txt',
    arrayBuffer: () => read.promise,
  });
  await AppController.prototype.importScriptFile.call(app, {
    size: 5,
    name: '新文件.txt',
    arrayBuffer: async () => new ArrayBuffer(5),
  });
  read.resolve(new ArrayBuffer(5));
  await slow;
  assert.deepEqual(accepted, ['新文件.txt']);
});

test('closing while choosing a file or starting audio prevents late state changes', async () => {
  const audioStart = deferred(),
    changed = [];
  const app = {
    destroyed: false,
    playback: { resetSource: () => changed.push('reset') },
    setPlaying: () => changed.push('play'),
    ui: { closePanel: () => changed.push('close') },
  };
  const starting = AppController.prototype.switchSource.call(app, () => audioStart.promise);
  app.destroyed = true;
  audioStart.resolve(true);
  assert.equal(await starting, false);
  assert.deepEqual(changed, []);
});

test('a superseded audio operation does not restart the clock or playback', async () => {
  const app = {
    destroyed: false,
    playback: { resetSource: () => assert.fail('reset') },
    setPlaying: () => assert.fail('play'),
    ui: { closePanel: () => assert.fail('close') },
  };
  assert.equal(await AppController.prototype.switchSource.call(app, async () => false), false);
});

test('an explicit title edit updates JSON title while file import retains its own authored title', () => {
  const document = {
    schemaVersion: 1,
    sourceMode: 'source-only',
    title: '原始标题',
    lines: [{ text: '学习来自观察。', keyword: '学习', keywords: [{ text: '学习', role: 'primary' }] }],
  };
  const makeApp = () => ({
    destroyed: false,
    contentGeneration: 0,
    state: {},
    ui: { restoreEditor() {}, toast() {} },
    loadTopic(topic) {
      this.activeTopic = topic;
    },
    save() {},
  });
  const edited = makeApp();
  AppController.prototype.applyText.call(edited, '新标题🧠', JSON.stringify(document), { editor: true });
  assert.equal(edited.activeTopic.title, '新标题🧠');
  assert.equal(edited.activeTopic.lines[0].text, document.lines[0].text);
  assert.equal(edited.activeTopic.schemaVersion, 1);
  const imported = makeApp();
  AppController.prototype.applyText.call(imported, '文件名', JSON.stringify(document));
  assert.equal(imported.activeTopic.title, parseScriptInput(document).title);
});
