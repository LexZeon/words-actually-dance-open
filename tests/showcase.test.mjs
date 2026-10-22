import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatClock } from '../src/audio/beat-clock.js';
import { createEventBus, EVENTS } from '../src/core/events.js';
import { mountShowcase } from '../src/ui/showcase.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};

class Element extends EventTarget {
  constructor() {
    super();
    this.attributes = new Map();
    this.style = {};
    this.hidden = false;
    this.inert = false;
    this.disabled = false;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  click() {
    this.dispatchEvent(new Event('click'));
  }
  focus() {
    this.focused = true;
  }
}

function harness({ pause = async () => true, mode = 'file' } = {}) {
  const nodes = new Map();
  const documentRef = new EventTarget();
  documentRef.getElementById = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  documentRef.querySelector = () => null;
  const get = documentRef.getElementById;
  get('recall-cover').hidden = true;
  const calls = [];
  const clock = new BeatClock();
  clock.update({}, 0);
  clock.update({}, 0.5);
  const app = {
    destroyed: false,
    audioPending: 0,
    state: { playing: true },
    activeTopic: { lines: [{ text: '一个知识点' }, { text: '另一个知识点' }] },
    bus: createEventBus(),
    ui: {
      ready: true,
      toast: (message) => calls.push(['toast', message]),
      openPanel: (id) => calls.push(['open', id]),
      closePanel: (id) => calls.push(['close', id]),
    },
    audio: {
      mode,
      setPaused: (value) => {
        calls.push(['pauseAudio', value]);
        return pause(value);
      },
    },
    queueAudio: (command) => Promise.resolve().then(command),
    setPlaying(value) {
      this.state.playing = value;
      clock.setPaused(!value);
      calls.push(['playing', value]);
      this.bus.emit(EVENTS.PLAYBACK_CHANGED, { playing: value });
    },
  };
  const ui = mountShowcase({ app, documentRef });
  return { app, ui, get, documentRef, calls, clock };
}

test('recall freezes the real unified clock and suspends audio, then reveal restores accessible content without resuming', async () => {
  const pending = deferred();
  const { app, ui, get, calls, clock } = harness({ pause: () => pending.promise });
  const before = clock.getState().phase;
  const request = ui.beginRecall();
  assert.equal(app.state.playing, false, 'The clock freezes in the initiating click');
  clock.update({}, 50);
  assert.equal(clock.getState().phase, before);
  assert.equal(get('recall-cover').hidden, true, 'The cover is not shown before actual audio suspension');
  await Promise.resolve();
  assert.deepEqual(
    calls.filter(([name]) => name === 'pauseAudio'),
    [['pauseAudio', true]],
  );
  pending.resolve(true);
  assert.equal(await request, true);
  assert.equal(get('recall-cover').hidden, false);
  assert.equal(get('knowledge-stage').getAttribute('aria-hidden'), 'true');
  assert.equal(get('knowledge-stage').inert, true);
  assert.equal(get('knowledge-accessible').hidden, true);
  assert.equal(get('recall-answer').focused, true);
  get('recall-answer').click();
  assert.equal(get('recall-cover').hidden, true);
  assert.equal(get('knowledge-stage').getAttribute('aria-hidden'), null);
  assert.equal(get('knowledge-stage').inert, false);
  assert.equal(get('knowledge-accessible').hidden, false);
  assert.equal(app.state.playing, false);
  assert.equal(clock.getState().paused, true);
  assert.ok(calls.filter(([name]) => name === 'playing').every(([, value]) => value === false));
  assert.equal(get('recall-button').focused, true);
  ui.destroy();
});

test('a later real source or play intent retires an in-flight recall rather than masking the new content', async () => {
  const pending = deferred();
  const { app, ui, get } = harness({ pause: () => pending.promise });
  const request = ui.beginRecall();
  await Promise.resolve();
  app.bus.emit(EVENTS.AUDIO_SOURCE_CHANGED, { mode: 'system' });
  app.setPlaying(true);
  pending.resolve(true);
  assert.equal(await request, false);
  assert.equal(get('recall-cover').hidden, true);
  assert.equal(ui.getState().recalling, false);
  assert.equal(get('recall-button').disabled, false);
  assert.equal(get('knowledge-stage').getAttribute('aria-hidden'), null);
  ui.destroy();
});

test('recall does not race an existing audio command or initialize a default source just to show a question', async () => {
  const one = harness();
  one.app.audioPending = 1;
  assert.equal(await one.ui.beginRecall(), false);
  assert.equal(one.app.state.playing, true);
  assert.ok(one.calls.some(([type]) => type === 'toast'));
  assert.equal(one.calls.filter(([type]) => type === 'pauseAudio').length, 0);
  one.ui.destroy();
  const empty = harness({ mode: null });
  assert.equal(await empty.ui.beginRecall(), true);
  assert.equal(empty.app.state.playing, false);
  assert.equal(empty.calls.filter(([type]) => type === 'pauseAudio').length, 0);
  empty.ui.destroy();
});

test('line changes and disposal restore prior accessibility state and cannot display a late cover', async () => {
  const visible = harness();
  visible.get('knowledge-stage').setAttribute('aria-hidden', 'false');
  visible.get('knowledge-accessible').hidden = true;
  await visible.ui.beginRecall();
  visible.app.bus.emit(EVENTS.LINE_ENTER, { index: 1 });
  assert.equal(visible.get('knowledge-stage').getAttribute('aria-hidden'), 'false');
  assert.equal(visible.get('knowledge-accessible').hidden, true);
  assert.equal(visible.get('session-progress-fill').style.width, '50%');
  visible.ui.destroy();
  const pending = deferred();
  const closing = harness({ pause: () => pending.promise });
  const request = closing.ui.beginRecall();
  await Promise.resolve();
  closing.ui.destroy();
  pending.resolve(true);
  assert.equal(await request, false);
  assert.equal(closing.get('recall-cover').hidden, true);
  const before = closing.calls.length;
  closing.get('welcome-music').click();
  closing.app.bus.emit(EVENTS.AUDIO_SOURCE_CHANGED, { mode: 'file' });
  assert.equal(closing.calls.length, before, 'Owned event listeners are removed');
});

test('welcome controls route through real player entry points and learning help can restore the guide', () => {
  const { ui, app, get, calls } = harness();
  let plays = 0;
  get('play-button').addEventListener('click', () => {
    plays++;
    app.setPlaying(true);
  });
  get('welcome-music').click();
  get('welcome-content').click();
  assert.deepEqual(calls.slice(-2), [
    ['open', 'source-dialog'],
    ['open', 'content-dialog'],
  ]);
  get('welcome-play').click();
  assert.equal(plays, 1);
  assert.equal(ui.getState().welcomeVisible, false);
  get('learning-button').click();
  assert.deepEqual(calls.at(-1), ['open', 'learning-dialog']);
  get('show-welcome-button').click();
  assert.deepEqual(calls.at(-1), ['close', 'learning-dialog']);
  assert.equal(ui.getState().welcomeVisible, true);
  assert.equal(get('welcome-music').focused, true);
  get('welcome-dismiss').click();
  assert.equal(ui.getState().welcomeVisible, false);
  ui.destroy();
});

test('legacy injected app runtimes may omit optional showcase DOM without adding playback behavior', () => {
  assert.equal(mountShowcase({ app: {}, documentRef: { getElementById: () => ({}) } }), null);
});

test('a failed audio pause never claims a recall or hides content and a later retry remains usable', async () => {
  let accepted = false;
  const { app, ui, get, calls } = harness({ pause: async () => accepted });
  assert.equal(await ui.beginRecall(), false);
  assert.equal(get('recall-cover').hidden, true);
  assert.equal(get('knowledge-stage').getAttribute('aria-hidden'), null);
  assert.equal(get('recall-button').disabled, false);
  assert.ok(calls.some(([type]) => type === 'toast'));
  accepted = true;
  assert.equal(await ui.beginRecall(), true);
  app.setPlaying(true);
  assert.equal(ui.getState().recalling, false, 'Explicit user playback reveals the normal content');
  assert.equal(get('knowledge-stage').inert, false);
  ui.destroy();
});
