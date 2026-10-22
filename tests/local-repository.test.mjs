import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepository } from '../src/core/local-repository.js';
import { parseScriptInput } from '../src/content/script-document.js';
import { AppController } from '../src/app/app-controller.js';
import { eventBus, EVENTS } from '../src/core/events.js';
import { normalizePreferences } from '../src/core/preferences.js';

function topic() {
  return parseScriptInput({
    schemaVersion: 1,
    sourceMode: 'free-examples',
    title: '结构化知识',
    lines: [
      {
        text: '连接带来理解与解释。',
        keyword: '连接',
        sentenceType: 'definition',
        holdBeats: 5,
        keywords: [
          { text: '连接', role: 'primary' },
          {
            text: '理解',
            role: 'secondary',
            relation: { from: '连接', to: '理解', type: 'combine', label: '连接线索' },
          },
          { text: '解释', role: 'secondary' },
        ],
      },
    ],
  });
}
async function withDesktop(desktop, operation) {
  const previous = globalThis.window;
  globalThis.window = { desktop };
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

async function withBrowserStorage(storage, operation) {
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    return await withDesktop(undefined, operation);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
}

test('the browser repository round-trips ghost frequency and restores old snapshots without the field', async () => {
  const stored = new Map();
  await withBrowserStorage(
    {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
    async () => {
      const repository = new LocalRepository();
      const preferences = normalizePreferences({ ghostFrequency: 0.2, ghostEffect: 'glyph-wave', rate: 4 });
      assert.equal(await repository.save({ schemaVersion: 2, preferences }), true);
      assert.deepEqual(normalizePreferences((await repository.load()).preferences), preferences);
      stored.set('wad-experiment', JSON.stringify({ schemaVersion: 1, preferences: { rate: 3 } }));
      const legacy = await repository.load();
      assert.equal(normalizePreferences(legacy.preferences, legacy.schemaVersion).ghostFrequency, 0.9);
    },
  );
});

test('missing native and browser state return null without an error notification', async () => {
  const messages = [];
  const repository = new LocalRepository({ onError: (message) => messages.push(message) });
  await withDesktop({ loadState: async () => null }, async () => {
    assert.equal(await repository.load(), null);
  });
  await withBrowserStorage({ getItem: () => null }, async () => {
    assert.equal(await repository.load(), null);
  });
  assert.deepEqual(messages, []);
});

test('native read rejection reports only a safe message and does not poison future flushes', async () => {
  const messages = [],
    writes = [];
  await withDesktop(
    {
      async loadState() {
        throw new Error('private-original-notes {"secret":"do-not-display"}');
      },
      async saveState(payload) {
        writes.push(payload);
        return { saved: true };
      },
    },
    async () => {
      const repository = new LocalRepository({ onError: (message) => messages.push(message) });
      assert.equal(await repository.load(), null);
      assert.deepEqual(messages, ['本地文案或设置未能读取。']);
      assert.equal(repository.pending, null);
      assert.equal(await repository.flush(), true);
      assert.deepEqual(writes, [], 'Read failure cannot enqueue a fallback write');
      assert.equal(await repository.save({ id: 'explicit-next-save' }), true);
      assert.equal(await repository.flush(), true);
      assert.deepEqual(writes, [{ id: 'explicit-next-save' }]);
      assert.equal(repository.writes.size, 0);
    },
  );
});

test('invalid browser JSON and storage read errors never expose original content or raw errors', async () => {
  for (const storage of [
    { getItem: () => '{"private-original-notes": broken-json}' },
    {
      getItem: () => {
        throw new Error('storage denied: private-original-notes');
      },
    },
  ]) {
    const messages = [];
    await withBrowserStorage(storage, async () => {
      const repository = new LocalRepository({ onError: (message) => messages.push(message) });
      assert.equal(await repository.load(), null);
      assert.deepEqual(messages, ['本地文案或设置未能读取。']);
      assert.equal(await repository.flush(), true);
      assert.equal(repository.writes.size, 0);
    });
  }
});

test('native standard export roundtrip keeps source mode, sentence roles and relationship labels', async () => {
  const original = topic();
  let payload;
  await withDesktop(
    {
      async exportScript(value) {
        payload = value;
        return { saved: true };
      },
    },
    async () => {
      assert.equal(await new LocalRepository().downloadScript(original), true);
    },
  );
  assert.equal(payload.title, original.title);
  assert.deepEqual(parseScriptInput(payload.text), original);
});

test('a large valid document remains reimportable within the actual native export character limit', async () => {
  const text = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ12345678';
  const words = Array.from({ length: 8 }, (_, index) => text.slice(index, index + 12));
  const original = parseScriptInput({
    schemaVersion: 1,
    sourceMode: 'source-only',
    title: '合法长文案',
    lines: Array.from({ length: 40 }, () => ({
      text,
      keyword: words[0],
      sentenceType: 'contrast',
      keywords: words.map((term, index) => ({
        text: term,
        role: index ? 'secondary' : 'primary',
        relation: { from: words[0], to: term, type: 'coordination', label: '关系'.repeat(30) },
      })),
    })),
  });
  let payload;
  await withDesktop(
    {
      async exportScript(value) {
        assert.ok(value.text.length <= 100_000, `Native IPC rejects ${value.text.length} characters`);
        payload = value;
        return { saved: true };
      },
    },
    async () => assert.equal(await new LocalRepository().downloadScript(original), true),
  );
  assert.deepEqual(parseScriptInput(payload.text), original);
});

test('native cancel returns false and native write errors propagate to the UI caller', async () => {
  await withDesktop(
    {
      async exportScript() {
        return { saved: false };
      },
    },
    async () => {
      assert.equal(await new LocalRepository().downloadScript(topic()), false);
    },
  );
  await withDesktop(
    {
      async exportScript() {
        throw new Error('disk-write-failed');
      },
    },
    async () => {
      await assert.rejects(new LocalRepository().downloadScript(topic()), /disk-write-failed/);
    },
  );
});

test('completed exports report the saved topic identity even if the next beat changes active content', async () => {
  for (const [method, repositoryMethod] of [
    ['exportScript', 'downloadScript'],
    ['download', 'download'],
  ]) {
    const app = Object.create(AppController.prototype);
    app.bus = eventBus;
    const original = topic();
    app.activeTopic = original;
    app.ui = { toast() {} };
    let captured;
    app.repository = {
      async [repositoryMethod](value) {
        captured = value;
        app.activeTopic = { id: 'changed-at-next-beat' };
        return true;
      },
    };
    const events = [];
    const stop = eventBus.on(EVENTS.DOWNLOAD, (value) => events.push(value));
    try {
      await app[method]();
    } finally {
      stop();
    }
    assert.equal(captured, original);
    assert.equal(events.length, 1);
    assert.equal(events[0].id, original.id);
  }
});

test('cancelled app exports do not claim a download or show a success toast', async () => {
  const app = Object.create(AppController.prototype);
  app.bus = eventBus;
  app.activeTopic = topic();
  const messages = [],
    events = [];
  app.ui = { toast: (value) => messages.push(value) };
  app.repository = {
    async downloadScript() {
      return false;
    },
    async download() {
      return false;
    },
  };
  const stop = eventBus.on(EVENTS.DOWNLOAD, (value) => events.push(value));
  try {
    await app.exportScript();
    await app.download();
  } finally {
    stop();
  }
  assert.deepEqual(events, []);
  assert.deepEqual(messages, []);
});

test('save dispatches native snapshots immediately and flush waits for every accepted write', async () => {
  const finish = [],
    captured = [];
  await withDesktop(
    {
      saveState(payload) {
        captured.push(payload);
        return new Promise((resolve) => finish.push(resolve));
      },
    },
    async () => {
      const repository = new LocalRepository();
      const first = repository.save({ id: 'first' });
      const second = repository.save({ id: 'second' });
      assert.deepEqual(
        captured.map(({ id }) => id),
        ['first', 'second'],
        'No frontend queue may delay native acceptance until shutdown',
      );
      let drained = false;
      const pending = repository.flush().then((result) => {
        drained = true;
        return result;
      });
      await Promise.resolve();
      assert.equal(drained, false);
      finish[0]({ saved: true });
      await first;
      assert.equal(drained, false);
      finish[1]({ saved: true });
      assert.equal(await second, true);
      assert.equal(await pending, true);
      assert.equal(repository.writes.size, 0);
    },
  );
});

test('flush reports an unsaved latest snapshot until a later valid snapshot succeeds', async () => {
  let fail = true;
  const errors = [];
  await withDesktop(
    {
      async saveState() {
        if (fail) throw new Error('disk full');
        return { saved: true };
      },
    },
    async () => {
      const repository = new LocalRepository({ onError: (message) => errors.push(message) });
      assert.equal(await repository.save({ value: 'notes' }), false);
      assert.equal(await repository.flush(), false);
      assert.deepEqual(errors, ['这次文案或设置未能保存。']);
      fail = false;
      assert.equal(await repository.save({ value: 'recovered notes' }), true);
      assert.equal(await repository.flush(), true);
    },
  );
});

test('failed browser download releases its blob URL and surfaces the failure', async () => {
  const previousDocument = globalThis.document;
  const create = URL.createObjectURL,
    revoke = URL.revokeObjectURL;
  const released = [];
  URL.createObjectURL = () => 'blob:owned-test';
  URL.revokeObjectURL = (value) => released.push(value);
  globalThis.document = {
    createElement() {
      return {
        click() {
          throw new Error('download blocked');
        },
      };
    },
  };
  try {
    await withDesktop(undefined, async () => {
      await assert.rejects(new LocalRepository().downloadScript(topic()), /download blocked/);
      assert.deepEqual(released, ['blob:owned-test']);
    });
  } finally {
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
