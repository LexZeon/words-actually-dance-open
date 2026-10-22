import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from '../src/app/app-controller.js';
import { PlayerUI } from '../src/ui/player-ui.js';
import { createEventBus, EVENTS } from '../src/core/events.js';
import { createProviderRegistry } from '../src/core/contracts.js';
import { parseTextScript } from '../src/content/text-script.js';
import { getLikeKey } from '../src/content/content-identity.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function runtime(overrides = {}) {
  const calls = [];
  const ui = {
    setReady: (value) => calls.push(['ready', value]),
    get: () => ({}),
    setKeyword() {},
    setLiked() {},
    showTopic() {},
    setPlaying() {},
    renderPreferences() {},
    restoreEditor() {},
    toast: (message) => calls.push(['toast', message]),
    destroy: () => calls.push(['destroy', 'ui']),
  };
  const repository = {
    load: async () => null,
    save: () => calls.push(['save']),
    flush: async () => {
      calls.push(['flush']);
      return true;
    },
  };
  const audio = { destroy: async () => calls.push(['destroy', 'audio']) };
  const dance = {
    word: '',
    setWord() {},
    setEmoji() {},
    setIntensity() {},
    setGhostEffect() {},
    setGhostFrequency() {},
    destroy: () => calls.push(['destroy', 'dance']),
  };
  const knowledge = {
    setScript() {},
    setAutoDirection() {},
    setEffect() {},
    setRate() {},
    destroy: () => calls.push(['destroy', 'knowledge']),
  };
  const playback = {
    start: () => calls.push(['start']),
    setPlaying() {},
    destroy: () => calls.push(['destroy', 'playback']),
  };
  const factories = {
    ui: () => ui,
    repository: () => repository,
    audio: () => audio,
    clock: () => ({}),
    dance: () => dance,
    knowledge: () => knowledge,
    playback: () => playback,
    ...overrides.factories,
  };
  const windowRef = {
    addEventListener: () => calls.push(['bind']),
    removeEventListener: () => calls.push(['unbind']),
  };
  const options = {
    bus: createEventBus(),
    registry: createProviderRegistry(),
    factories,
    windowRef,
    documentRef: { getElementById: () => ({}) },
    ...overrides,
  };
  options.factories = factories;
  return { calls, options, ui, repository, audio, dance, knowledge, playback, windowRef };
}

test('boot is single-flight, restores before accepting input and never rewrites an unreadable snapshot', async () => {
  const r = runtime(),
    load = deferred();
  let loads = 0;
  r.repository.load = () => {
    loads++;
    return load.promise;
  };
  const app = new AppController(r.options);
  const first = app.boot(),
    second = app.boot();
  assert.equal(first, second);
  assert.equal(loads, 1);
  assert.deepEqual(
    r.calls.filter(([type]) => type === 'ready'),
    [['ready', false]],
  );
  load.resolve(null);
  assert.equal(await first, true);
  assert.equal(r.calls.filter(([type]) => type === 'start').length, 1);
  assert.equal(r.calls.filter(([type]) => type === 'save').length, 0);
  assert.deepEqual(r.calls.filter(([type]) => type === 'ready').at(-1), ['ready', true]);
  app.preference('emoji', true);
  assert.equal(r.calls.filter(([type]) => type === 'save').length, 1);
  await app.destroy();
});

test('closing during load cannot start playback, unlock input or publish ready later', async () => {
  const r = runtime(),
    load = deferred();
  r.repository.load = () => load.promise;
  const app = new AppController(r.options);
  const starting = app.boot();
  await app.destroy();
  load.resolve({ schemaVersion: 2, preferences: { emoji: true } });
  assert.equal(await starting, false);
  assert.equal(r.windowRef.__wadReady, undefined);
  assert.equal(
    r.calls.some(([type]) => type === 'start'),
    false,
  );
  assert.equal(
    r.calls.some(([type, value]) => type === 'ready' && value),
    false,
  );
});

test('shutdown immediately releases every resource, shares completion and consumes close rejection', async (t) => {
  const r = runtime(),
    close = deferred(),
    flushed = deferred(),
    errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  r.playback.destroy = () => {
    r.calls.push(['destroy', 'playback']);
    throw new Error('frame teardown');
  };
  r.audio.destroy = () => {
    r.calls.push(['destroy', 'audio']);
    return close.promise;
  };
  r.repository.flush = () => {
    r.calls.push(['flush']);
    return flushed.promise;
  };
  const app = new AppController(r.options);
  const first = app.destroy();
  assert.equal(app.destroy(), first);
  assert.deepEqual(
    r.calls.filter(([type]) => type === 'destroy').map(([, value]) => value),
    ['playback', 'ui', 'dance', 'knowledge', 'audio'],
  );
  assert.equal(r.options.registry.list().length, 0);
  let settled = false;
  first.then(() => {
    settled = true;
  });
  close.reject(new Error('AudioContext.close failed'));
  await Promise.resolve();
  assert.equal(settled, false);
  flushed.resolve(true);
  assert.equal(await first, false);
  assert.equal(errors.length, 1);
});

test('partial dependency construction releases already created resources', async () => {
  const r = runtime({
    factories: {
      knowledge: () => {
        throw new Error('missing stage');
      },
    },
  });
  assert.throws(() => new AppController(r.options), /missing stage/);
  await Promise.resolve();
  assert.deepEqual(
    r.calls.filter(([type]) => type === 'destroy').map(([, value]) => value),
    ['ui', 'dance', 'audio'],
  );
  assert.equal(r.options.registry.list().length, 0);
});
test('owned provider cleanup is awaited and a failure cannot skip another release', async (t) => {
  const r = runtime(),
    done = deferred(),
    calls = [];
  t.mock.method(console, 'error', () => {});
  const app = new AppController(r.options);
  for (const [id, dispose] of [
    [
      'bad-adapter',
      () => {
        calls.push('bad');
        throw new Error('adapter failure');
      },
    ],
    [
      'async-adapter',
      () => {
        calls.push('async');
        return done.promise;
      },
    ],
  ])
    app.ownedProviders.push(
      app.registry.register({ id, kind: 'library', methods: { listFiles() {} }, dispose }),
    );
  const closing = app.destroy();
  assert.deepEqual(calls, ['bad', 'async']);
  assert.equal(app.registry.list().length, 0);
  let settled = false;
  closing.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  done.resolve();
  assert.equal(await closing, false);
});

test('partial provider registration rolls back owned entries without touching an existing provider', async () => {
  const registry = createProviderRegistry();
  const existing = registry.register({ id: 'local-text', kind: 'input', methods: { extractText: String } });
  const r = runtime({ registry });
  assert.throws(() => new AppController(r.options), /already registered/);
  await Promise.resolve();
  assert.equal(registry.get('local-library'), undefined);
  assert.equal(registry.get('local-text'), existing);
  assert.equal(r.calls.filter(([type]) => type === 'destroy').length, 5);
});

test('shutdown does not unregister a replacement owned by another provider', async () => {
  const r = runtime(),
    app = new AppController(r.options);
  r.options.registry.unregister('local-text');
  const replacement = r.options.registry.register({
    id: 'local-text',
    kind: 'input',
    methods: { extractText: String },
  });
  await app.destroy();
  assert.equal(r.options.registry.get('local-text'), replacement);
});

test('boot failure disposes the runtime without leaving playback active', async (t) => {
  const r = runtime();
  r.knowledge.setScript = () => {
    throw new Error('layout failed');
  };
  const app = new AppController(r.options);
  await assert.rejects(app.boot(), /layout failed/);
  assert.equal(app.destroyed, true);
  assert.equal(
    r.calls.some(([type]) => type === 'start'),
    false,
  );
  assert.equal(r.calls.filter(([type]) => type === 'destroy').length, 5);
});

test('UI does not dispatch commands or start asynchronous operations while restoring', async () => {
  const calls = [];
  const ui = {
    ready: false,
    destroyed: false,
    busy: new WeakSet(),
    handlers: { playPause: () => calls.push('play') },
    interaction: () => calls.push('interaction'),
  };
  assert.equal(PlayerUI.prototype.command.call(ui, 'playPause'), false);
  assert.equal(await PlayerUI.prototype.run.call(ui, () => calls.push('operation')), false);
  assert.deepEqual(calls, []);
  ui.ready = true;
  PlayerUI.prototype.command.call(ui, 'playPause');
  assert.deepEqual(calls, ['interaction', 'play']);
});

test('an extension closing the app during initial content publication cannot resume initialization', async () => {
  const r = runtime(),
    app = new AppController(r.options);
  r.options.bus.once(EVENTS.CONTENT_LOADED, () => app.destroy());
  assert.equal(await app.boot(), false);
  assert.equal(
    r.calls.some(([type]) => type === 'start'),
    false,
  );
  assert.equal(
    r.calls.some(([type, value]) => type === 'ready' && value),
    false,
  );
  await app.destroy();
});

test('file selection and prompt copying use the same injected desktop boundary as boot', async () => {
  const r = runtime(),
    selected = [];
  r.windowRef.desktop = {
    chooseScript: async () => {
      selected.push('script');
      return null;
    },
    chooseAudio: async () => {
      selected.push('audio');
      return null;
    },
    copyText: async (text) => selected.push(text),
  };
  const app = new AppController(r.options);
  await app.importScript();
  await app.performImportAudio();
  await app.copyAuthoringPrompt('source-only');
  assert.deepEqual(selected.slice(0, 2), ['script', 'audio']);
  assert.match(selected[2], /schemaVersion/);
  await app.destroy();
});

test('liking one custom document never marks a different document liked', async () => {
  const r = runtime(),
    shown = [];
  r.ui.showTopic = (topic, index, state) => shown.push(state.liked);
  const app = new AppController(r.options);
  app.applyText('一', '频率｜频率描述重复的快慢。');
  app.like();
  const first = app.activeTopic;
  app.applyText('二', '幅度｜幅度描述变化的大小。');
  assert.equal(shown.at(-1), false);
  assert.equal(app.state.likes.has(getLikeKey(first)), true);
  assert.equal(app.state.likes.has(getLikeKey(app.activeTopic)), false);
  app.applyText('一', '频率｜频率描述重复的快慢。');
  assert.equal(shown.at(-1), true);
  await app.destroy();
});

test('legacy custom likes migrate to the restored document without an automatic disk write', async () => {
  const r = runtime();
  const custom = parseTextScript('频率｜频率描述重复的快慢。', '材料');
  r.repository.load = async () => ({ schemaVersion: 2, custom, topicIndex: -1, likes: ['custom'] });
  const app = new AppController(r.options);
  await app.boot();
  assert.equal(app.state.likes.has('custom'), false);
  assert.equal(app.state.likes.has(getLikeKey(app.activeTopic)), true);
  assert.equal(
    r.calls.some(([type]) => type === 'save'),
    false,
  );
  await app.destroy();
});

test('English restores before selecting the same built-in index without rewriting local storage on boot', async () => {
  const r = runtime(),
    calls = [];
  r.repository.load = async () => ({ schemaVersion: 2, topicIndex: 5, preferences: { language: 'en' } });
  r.ui.setLanguage = (language, options) => calls.push(['language', language, options.library]);
  r.ui.showTopic = (topic, index) => calls.push(['topic', topic, index]);
  const app = new AppController(r.options);
  await app.boot();
  assert.equal(calls[0][0], 'language');
  assert.equal(calls[0][1], 'en');
  assert.equal(calls.find(([type]) => type === 'topic')[2], 5);
  assert.ok(!/[\p{Script=Han}]/u.test(app.activeTopic.title));
  assert.equal(app.state.preferences.language, 'en');
  assert.equal(app.state.playing, false);
  assert.equal(r.calls.filter(([type]) => type === 'save').length, 0);
  await app.destroy();
});

test('language changes pause first, preserve built-in indices and likes, and never translate or replace custom input', async () => {
  const r = runtime(),
    pause = deferred(),
    writes = [],
    scripts = [];
  r.repository.save = (payload) => writes.push(payload);
  r.knowledge.setScript = (topic) => scripts.push(topic);
  const app = new AppController(r.options);
  await app.boot();
  const id = app.activeTopic.id;
  app.state.likes.add(id);
  app.audio.mode = 'file';
  app.audio.setPaused = async (value) => {
    assert.equal(value, true);
    return pause.promise;
  };
  app.setPlaying(true);
  const changing = app.changeLanguage('en');
  assert.equal(app.state.playing, false, 'The shared playback state freezes synchronously');
  assert.equal(app.state.preferences.language, 'zh', 'Commit waits for actual audio pause');
  pause.resolve(true);
  assert.equal(await changing, true);
  assert.equal(app.state.preferences.language, 'en');
  assert.equal(app.state.topicIndex, 0);
  assert.equal(app.activeTopic.id, id);
  assert.ok(app.state.likes.has(id));
  assert.equal(writes.at(-1).preferences.language, 'en');
  assert.equal(app.state.playing, false);
  app.applyText('我的原文', '知识｜知识来自观察。');
  const custom = app.state.custom,
    active = app.activeTopic,
    count = scripts.length;
  assert.equal(await app.changeLanguage('zh'), true);
  assert.equal(app.state.custom, custom);
  assert.equal(app.activeTopic, active);
  assert.equal(app.activeTopic.title, '我的原文');
  assert.equal(scripts.length, count, 'Changing chrome must not rebuild a user-authored script');
  assert.equal(app.state.playing, false);
  await app.destroy();
});

test('ghost frequency restores, applies and saves without changing the knowledge reading rate', async () => {
  const r = runtime(),
    applied = [],
    rates = [],
    writes = [];
  r.repository.load = async () => ({ schemaVersion: 2, preferences: { ghostFrequency: 0.2, rate: 3 } });
  r.repository.save = (value) => writes.push(structuredClone(value));
  r.dance.setGhostFrequency = (value) => applied.push(value);
  r.knowledge.setRate = (value) => rates.push(value);
  const app = new AppController(r.options);
  await app.boot();
  assert.equal(applied.at(-1), 0.2);
  app.preference('ghostFrequency', 0.9);
  assert.equal(applied.at(-1), 0.9);
  assert.equal(writes.at(-1).preferences.ghostFrequency, 0.9);
  app.preference('ghostEffect', 'off');
  assert.equal(writes.at(-1).preferences.ghostFrequency, 0.9);
  app.preference('ghostFrequency', 20);
  assert.equal(applied.at(-1), 1, 'External preference input is clamped before it reaches the stage');
  assert.ok(rates.every((value) => value === 3));
  assert.equal(app.state.preferences.rate, 3);
  await app.destroy();
});

test('rapid language choices and app disposal retire old asynchronous locale commits', async () => {
  const r = runtime(),
    pause = deferred();
  const app = new AppController(r.options);
  await app.boot();
  app.audio.mode = 'demo';
  app.audio.setPaused = () => pause.promise;
  const first = app.changeLanguage('en');
  await Promise.resolve();
  const second = app.changeLanguage('zh');
  pause.resolve(true);
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(app.state.preferences.language, 'zh');
  const later = app.changeLanguage('en');
  await app.destroy();
  assert.equal(await later, false);
  assert.equal(app.state.preferences.language, 'zh');
});
