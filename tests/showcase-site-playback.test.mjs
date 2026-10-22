import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { bootGallery } from '../showcase-site/app.js';

const markup = await fs.readFile(new URL('../showcase-site/index.html', import.meta.url), 'utf8');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

// This DOM/media double tests lifecycle ordering, never Bilibili playback or
// audible synchronization. In particular, `play` is queued before play()'s
// Promise settles; pause() on an already paused element queues no pause event.
function harness({ clip = 'die-for-you', reducedMotion = false, playResults = [] } = {}) {
  const mediaTasks = [],
    timers = new Map(),
    nodes = new Map(),
    created = [];
  let elapsed = 0,
    nextTimer = 1;
  class Element extends EventTarget {
    constructor(tag = 'div') {
      super();
      this.tagName = tag.toUpperCase();
      this.attributes = new Map();
      this.dataset = {};
      this.children = [];
      this.parentElement = null;
      this.hidden = false;
      this.disabled = false;
      this._text = '';
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    get src() {
      return this.getAttribute('src') || '';
    }
    set src(value) {
      this.setAttribute('src', value);
    }
    get textContent() {
      return this._text;
    }
    set textContent(value) {
      this._text = String(value);
      this.replaceChildren();
    }
    append(...items) {
      for (const item of items) {
        item.remove();
        item.parentElement = this;
        this.children.push(item);
      }
    }
    replaceChildren(...items) {
      this.children.forEach((item) => {
        item.parentElement = null;
      });
      this.children = [];
      this.append(...items);
    }
    remove() {
      if (this.parentElement)
        this.parentElement.children = this.parentElement.children.filter((item) => item !== this);
      this.parentElement = null;
    }
    click() {
      if (!this.disabled) this.dispatchEvent(new Event('click'));
    }
    focus() {
      this.focused = true;
    }
  }
  class Video extends Element {
    constructor() {
      super('video');
      this.paused = true;
      this.ended = false;
      this.seeking = false;
      this.muted = true;
      this.volume = 1;
      this.error = null;
      this.readyState = 4;
      this._time = 0;
      this.playCalls = [];
    }
    get currentTime() {
      return this._time;
    }
    set currentTime(value) {
      if (this._time === value) return;
      this._time = value;
      this.seeking = true;
      mediaTasks.push(() => this.dispatchEvent(new Event('seeking')));
      mediaTasks.push(() => {
        this.seeking = false;
        this.dispatchEvent(new Event('seeked'));
      });
    }
    get currentSrc() {
      return new URL(this.src, view.location.href).href;
    }
    load() {
      // The HTML load algorithm removes pending media-element tasks. A guard
      // which counted an old queued pause cannot expect that event to survive.
      // https://html.spec.whatwg.org/multipage/media.html#media-element-load-algorithm
      mediaTasks.length = 0;
      this.ended = false;
      this.error = null;
    }
    play() {
      this.playCalls.push({ time: elapsed, src: this.src, position: this.currentTime });
      this.paused = false;
      this.ended = false;
      mediaTasks.push(() => this.dispatchEvent(new Event('play')));
      return playResults.shift() ?? Promise.resolve();
    }
    pause() {
      if (this.paused) return;
      this.paused = true;
      mediaTasks.push(() => this.dispatchEvent(new Event('pause')));
    }
  }
  const localized = [],
    languages = [];
  for (const [, tag, attributes] of markup.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*?)>/gi)) {
    const id = /\bid="([^"]+)"/.exec(attributes)?.[1];
    const element = tag === 'video' ? new Video() : new Element(tag);
    for (const [, name, value] of attributes.matchAll(/([^\s=]+)="([^"]*)"/g)) {
      element.setAttribute(name, value);
      if (name.startsWith('data-')) element.dataset[name.slice(5)] = value;
    }
    element.hidden = /(?:^|\s)hidden(?:\s|$)/.test(attributes);
    if (id) nodes.set(id, element);
    if (element.dataset.i18n) localized.push(element);
    if (element.dataset.language) languages.push(element);
  }
  const view = new EventTarget();
  view.location = { href: `https://gallery.example/?clip=${clip}&lang=en#screen` };
  view.navigator = { language: 'en', clipboard: { writeText: async () => {} } };
  const storage = new Map();
  view.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  view.matchMedia = () => ({ matches: reducedMotion });
  view.history = {
    replaceState: (_state, _title, url) => {
      view.location.href = String(url);
    },
  };
  view.setTimeout = (callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { callback, at: elapsed + delay });
    return id;
  };
  view.clearTimeout = (id) => timers.delete(id);
  const document = {
    defaultView: view,
    documentElement: new Element('html'),
    getElementById: (id) => nodes.get(id) ?? null,
    querySelectorAll: (selector) =>
      selector === '[data-i18n]' ? localized : selector === '[data-language]' ? languages : [],
    createElement: (tag) => {
      const element = new Element(tag);
      created.push(element);
      return element;
    },
  };
  const gallery = bootGallery(document),
    player = nodes.get('player');
  const microtasks = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  const flushMedia = async () => {
    let count = 0;
    while (mediaTasks.length) {
      assert.ok(++count < 100, 'bounded media task queue');
      mediaTasks.shift()();
      await microtasks();
    }
    await microtasks();
  };
  const advance = async (milliseconds) => {
    elapsed += milliseconds;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= elapsed && timers.delete(id)) timer.callback();
    }
    await microtasks();
  };
  const get = (id) => {
    const element = nodes.get(id);
    assert.ok(element, `actual gallery markup must contain ${id}`);
    return element;
  };
  const descendants = (element) => [element, ...element.children.flatMap(descendants)];
  return {
    gallery,
    player,
    get,
    view,
    timers,
    created,
    microtasks,
    flushMedia,
    advance,
    iframe: () => get('source-player-slot').children[0] ?? null,
    language: (value) => languages.find((button) => button.dataset.language === value).click(),
    choose: (value) => {
      const button = descendants(get('clip-list')).find((element) => element.dataset.clip === value);
      assert.ok(button, `actual playlist contains ${value}`);
      button.click();
    },
  };
}

test('song demo stays at zero until its current official frame loads; page load is not song-playback evidence', async () => {
  const h = harness();
  assert.equal(h.player.playCalls.length, 0);
  assert.equal(h.player.currentTime, 0);
  assert.equal(h.player.paused, true);
  assert.equal(h.player.preload, 'auto');
  assert.equal(h.gallery.getState().sourceStartPhase, 'loading');
  assert.equal(h.get('play-button').disabled, true);
  h.iframe().dispatchEvent(new Event('load'));
  await h.flushMedia();
  assert.equal(h.player.playCalls.length, 1);
  assert.equal(h.player.muted, true);
  assert.equal(h.gallery.getState().sourceStartPhase, 'playing');
  assert.equal(h.timers.size, 0);
  assert.equal(h.get('start-demo-now-button').hidden, true);
  assert.match(h.get('source-player-note').textContent, /page loaded/i);
  assert.match(h.get('source-player-note').textContent, /buffer|require Play/i);
  h.gallery.pause();
});

test('restart consumes its old queued pause/reset events without cancelling the new load gate', async () => {
  const h = harness();
  h.iframe().dispatchEvent(new Event('load'));
  await h.flushMedia();
  h.player._time = 5;
  const old = h.iframe();
  h.get('play-together-button').click();
  const next = h.iframe();
  assert.notEqual(next, old);
  assert.equal(h.player.currentTime, 0);
  await h.flushMedia();
  assert.equal(h.iframe(), next);
  assert.equal(h.gallery.getState().sourceStartPhase, 'loading');
  old.dispatchEvent(new Event('load'));
  await h.microtasks();
  assert.equal(h.player.playCalls.length, 1);
  next.dispatchEvent(new Event('load'));
  await h.flushMedia();
  assert.equal(h.player.playCalls.length, 2);
  h.gallery.pause();
});

test('load arriving before the restart pause event remains cancellable by an immediate Stop', async () => {
  const h = harness();
  const original = h.iframe();
  original.dispatchEvent(new Event('load'));
  await h.flushMedia();
  h.player._time = 5;
  h.get('play-together-button').click();
  const next = h.iframe();
  // Deliberately do not dispatch the old queued pause/reset tasks yet.
  next.dispatchEvent(new Event('load'));
  assert.equal(h.player.playCalls.length, 2);
  h.get('stop-source-button').click();
  await h.flushMedia();
  original.dispatchEvent(new Event('load'));
  next.dispatchEvent(new Event('load'));
  await h.advance(16000);
  assert.equal(h.player.playCalls.length, 2);
  assert.equal(h.player.paused, true);
  assert.equal(h.iframe(), null);
  assert.equal(h.gallery.getState().sourceStartPhase, 'idle');
  assert.equal(h.timers.size, 0);
});

test('a late frame load or timer cannot start a stopped pair', async () => {
  const h = harness(),
    old = h.iframe();
  h.get('stop-source-button').click();
  old.dispatchEvent(new Event('load'));
  await h.advance(16000);
  assert.equal(h.player.playCalls.length, 0);
  assert.equal(h.player.paused, true);
  assert.equal(h.gallery.getState().sourceStartPhase, 'idle');
  assert.equal(h.iframe(), null);
  assert.equal(h.timers.size, 0);
});

test('a 15-second timeout leaves a visible source and explicit manual start, never a late automatic start', async () => {
  const h = harness(),
    frame = h.iframe();
  await h.advance(14999);
  assert.equal(h.gallery.getState().sourceStartPhase, 'loading');
  await h.advance(1);
  assert.equal(h.gallery.getState().sourceStartPhase, 'error');
  assert.equal(h.iframe(), frame);
  assert.equal(h.get('start-demo-now-button').hidden, false);
  frame.dispatchEvent(new Event('load'));
  await h.microtasks();
  assert.equal(h.player.playCalls.length, 0);
  h.get('start-demo-now-button').click();
  await h.flushMedia();
  assert.equal(h.player.playCalls.length, 1);
  assert.equal(h.gallery.getState().sourceStartPhase, 'playing');
  h.gallery.pause();
});

test('frame error cancels automatic wait and keeps the reviewed source visible for manual action', async () => {
  const h = harness(),
    frame = h.iframe();
  frame.dispatchEvent(new Event('error'));
  await h.microtasks();
  assert.equal(h.gallery.getState().sourceStartPhase, 'error');
  assert.equal(h.player.playCalls.length, 0);
  assert.equal(h.iframe(), frame);
  assert.equal(h.timers.size, 0);
  frame.dispatchEvent(new Event('load'));
  await h.microtasks();
  assert.equal(h.player.playCalls.length, 0);
  h.gallery.pause();
});

test('explicit manual start before load clears the old wait and cannot be started twice by late load', async () => {
  const h = harness(),
    frame = h.iframe();
  h.get('start-demo-now-button').click();
  await h.flushMedia();
  assert.equal(h.player.playCalls.length, 1);
  frame.dispatchEvent(new Event('load'));
  await h.advance(16000);
  assert.equal(h.player.playCalls.length, 1);
  assert.equal(h.gallery.getState().sourceStartPhase, 'playing');
  h.gallery.pause();
});

test('switching clips or language retires the previous frame even when it subsequently loads', async () => {
  const h = harness(),
    first = h.iframe();
  h.choose('qian-si-xi');
  const second = h.iframe();
  first.dispatchEvent(new Event('load'));
  await h.microtasks();
  assert.equal(h.player.playCalls.length, 0);
  h.language('zh');
  second.dispatchEvent(new Event('load'));
  await h.advance(16000);
  assert.equal(h.player.playCalls.length, 0);
  assert.equal(h.iframe(), null);
  assert.equal(h.gallery.getState().language, 'zh');
  assert.equal(h.gallery.getState().sourceStartPhase, 'idle');
});

for (const cancellation of ['seek', 'ended', 'pagehide', 'beforeunload', 'history'])
  test(`${cancellation} cancels the pending source and stale frame callback`, async () => {
    const h = harness(),
      frame = h.iframe();
    if (cancellation === 'seek') {
      h.player.currentTime = 3;
      await h.flushMedia();
    } else if (cancellation === 'ended') {
      h.player.ended = true;
      h.player.dispatchEvent(new Event('ended'));
    } else if (cancellation === 'history') {
      h.view.location.href = 'https://gallery.example/?clip=die-for-you&lang=zh#screen';
      h.view.dispatchEvent(new Event('popstate'));
    } else h.view.dispatchEvent(new Event(cancellation));
    frame.dispatchEvent(new Event('load'));
    await h.advance(16000);
    assert.equal(h.player.playCalls.length, 0);
    assert.equal(h.iframe(), null);
    assert.equal(h.timers.size, 0);
  });

test('a deferred local play followed by pause cannot be revived by the old play Promise', async () => {
  const pending = deferred(),
    h = harness({ playResults: [pending.promise] });
  h.iframe().dispatchEvent(new Event('load'));
  await h.flushMedia();
  h.player.pause();
  await h.flushMedia();
  assert.equal(h.iframe(), null);
  pending.resolve();
  await h.microtasks();
  assert.equal(h.gallery.getState().sourceStartPhase, 'idle');
  assert.equal(h.player.paused, true);
});

test('stop during a deferred play still pauses the video after its earlier play event', async () => {
  const pending = deferred(),
    h = harness({ playResults: [pending.promise] });
  h.iframe().dispatchEvent(new Event('load'));
  await h.flushMedia();
  assert.equal(h.gallery.getState().sourceStartPhase, 'starting');
  h.get('stop-source-button').click();
  await h.flushMedia();
  assert.equal(h.player.paused, true);
  pending.resolve();
  await h.microtasks();
  assert.equal(h.iframe(), null);
  assert.equal(h.gallery.getState().sourceStartPhase, 'idle');
});

for (const outcome of ['resolve', 'reject'])
  test(`an old play Promise ${outcome} cannot change a newer loading attempt`, async () => {
    const pending = deferred(),
      h = harness({ playResults: [pending.promise] });
    h.iframe().dispatchEvent(new Event('load'));
    await h.flushMedia();
    h.get('play-together-button').click();
    const next = h.iframe();
    await h.flushMedia();
    pending[outcome](outcome === 'reject' ? new Error('retired request') : undefined);
    await h.microtasks();
    assert.equal(h.gallery.getState().sourceStartPhase, 'loading');
    assert.equal(h.iframe(), next);
    assert.equal(h.player.paused, true);
    next.dispatchEvent(new Event('load'));
    await h.flushMedia();
    assert.equal(h.player.playCalls.length, 2);
    assert.equal(h.gallery.getState().sourceStartPhase, 'playing');
    h.gallery.pause();
  });

test('local media error cancels a still-loading official frame and its timer', async () => {
  const h = harness(),
    old = h.iframe();
  h.player.error = { code: 3 };
  h.player.dispatchEvent(new Event('error'));
  old.dispatchEvent(new Event('load'));
  await h.advance(16000);
  assert.equal(h.player.playCalls.length, 0);
  assert.equal(h.iframe(), null);
  assert.equal(h.timers.size, 0);
  assert.match(h.get('player-message').textContent, /could not load/i);
});

test('a source load retires its removed pause task so the next user pause really stops the source', async () => {
  const h = harness();
  h.iframe().dispatchEvent(new Event('load'));
  await h.flushMedia();
  // Switching while playing queues an internal pause and then load() removes
  // that task. The later user pause belongs to the new resource, not the old.
  h.choose('qian-si-xi');
  h.iframe().dispatchEvent(new Event('load'));
  await h.flushMedia();
  assert.equal(h.gallery.getState().sourceStartPhase, 'playing');
  h.player.pause();
  await h.flushMedia();
  assert.equal(h.iframe(), null);
  assert.equal(h.gallery.getState().sourceStartPhase, 'idle');
});

test('reduced-motion blocks automatic pair creation but an explicit user action remains available', async () => {
  const h = harness({ reducedMotion: true });
  assert.equal(h.player.playCalls.length, 0);
  assert.equal(h.iframe(), null);
  h.get('play-together-button').click();
  assert.ok(h.iframe());
  assert.equal(h.player.playCalls.length, 0);
  h.iframe().dispatchEvent(new Event('load'));
  await h.flushMedia();
  assert.equal(h.player.playCalls.length, 1);
  h.gallery.pause();
});

test('original music keeps its independent audio path and creates no Bilibili frame or load timer', async () => {
  const h = harness({ clip: 'overview' });
  await h.flushMedia();
  assert.equal(h.player.playCalls.length, 1);
  assert.equal(h.player.muted, false);
  assert.equal(h.iframe(), null);
  assert.equal(h.timers.size, 0);
  assert.equal(h.get('play-together-button').hidden, true);
  h.gallery.pause();
});

test('English and Chinese source states identify page load and manual action without claiming song readiness', async () => {
  for (const language of ['en', 'zh']) {
    const h = harness();
    if (language === 'zh') {
      h.language('zh');
      h.get('play-together-button').click();
    }
    assert.match(
      h.get('source-player-note').textContent,
      language === 'en' ? /Waiting.*page/i : /等待.*页面/,
    );
    assert.match(h.get('play-label').textContent, language === 'en' ? /Waiting/i : /正在等待/);
    assert.match(
      h.get('start-demo-now-button').textContent,
      language === 'en' ? /Start demo now/i : /音乐已响.*开始演示/,
    );
    h.iframe().dispatchEvent(new Event('load'));
    await h.flushMedia();
    assert.match(
      h.get('source-player-note').textContent,
      language === 'en' ? /page loaded.*buffer/i : /页面已加载.*缓冲/,
    );
    assert.match(
      h.get('source-player-note').textContent,
      language === 'en' ? /does not guarantee/i : /不保证持续同步/,
    );
    h.get('play-together-button').click();
    h.get('start-demo-now-button').click();
    await h.flushMedia();
    assert.match(
      h.get('source-player-note').textContent,
      language === 'en' ? /cannot read Bilibili/i : /无法读取 Bilibili/,
    );
    h.gallery.pause();
  }
});
