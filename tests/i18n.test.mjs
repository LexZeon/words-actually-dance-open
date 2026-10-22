import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  normalizeLocale,
  translate,
  translateFeedback,
  messageSource,
  EN_EFFECTS,
} from '../src/core/i18n.js';
import {
  createLocalization,
  applyMusicImportPolicy,
  musicFileImportAllowed,
} from '../src/ui/localization.js';
import { PlayerUI } from '../src/ui/player-ui.js';
import { AppController } from '../src/app/app-controller.js';
import { EFFECTS } from '../src/visuals/effect-catalog.js';
import { normalizePreferences } from '../src/core/preferences.js';

class Node {
  constructor({ protectedContent = false, attributes = {}, value = '' } = {}) {
    this.protectedContent = protectedContent;
    this.attributes = new Map(Object.entries(attributes));
    this.value = value;
    this.style = {};
    this.dataset = {};
    this.classList = { add() {}, remove() {} };
  }
  closest() {
    return this.protectedContent ? this : null;
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  querySelectorAll() {
    return [];
  }
  replaceChildren(...children) {
    this.children = children;
  }
  append(...children) {
    (this.children ??= []).push(...children);
  }
}

test('known messages translate locally while literal user terms and unsupported locales remain untouched', () => {
  assert.equal(normalizeLocale('en'), 'en');
  assert.equal(normalizeLocale({ language: 'en' }), 'zh');
  assert.equal(translate('en', '选择音乐'), 'Choose music');
  assert.equal(translate('zh', '选择音乐'), '选择音乐');
  assert.equal(
    translate('en', '当前关键词：{keyword}', { keyword: '自定义 <字>' }),
    'Current keyword: 自定义 <字>',
  );
  assert.equal(translate('en', '用户自己写的内容'), '用户自己写的内容');
  assert.equal(
    translateFeedback('en', '第 2 行关键词“观察”重复，请只保留一次。'),
    'Line 2: keyword “观察” is repeated. Keep it once.',
  );
  assert.match(
    translateFeedback('en', '第 3 行讲解最多 60 个可见字符，请拆短一些。'),
    /^Line 3: explanation needs at most 60/,
  );
});

test('static localization translates text and accessibility attributes without replacing children or user input', () => {
  const label = new Node(),
    bodyText = { parentElement: label, nodeValue: '  选择音乐  ' };
  const user = new Node({ protectedContent: true }),
    userText = { parentElement: user, nodeValue: '选择音乐' };
  const field = new Node({
    attributes: { placeholder: '给这段知识一个名字…', 'aria-label': '标题' },
    value: '选择音乐',
  });
  const zh = new Node(),
    en = new Node();
  zh.dataset.language = 'zh';
  en.dataset.language = 'en';
  const nodes = [bodyText, userText];
  const doc = {
    body: {},
    documentElement: {},
    createTreeWalker() {
      let i = 0;
      return { nextNode: () => nodes[i++] ?? null };
    },
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === '[data-language]' ? [zh, en] : [field]),
  };
  const localizer = createLocalization(doc);
  localizer.apply('en');
  assert.equal(bodyText.nodeValue, '  Choose music  ');
  assert.equal(userText.nodeValue, '选择音乐');
  assert.equal(field.value, '选择音乐', 'Entered values are never translated');
  assert.equal(field.getAttribute('placeholder'), 'Give this text a name…');
  assert.equal(field.getAttribute('aria-label'), 'Title');
  assert.equal(doc.documentElement.lang, 'en');
  assert.equal(en.getAttribute('aria-pressed'), 'true');
  const appended = { parentElement: new Node(), nodeValue: '读取共享声音' };
  nodes.push(appended);
  localizer.apply('en');
  assert.equal(appended.nodeValue, 'Connect shared audio', 'A later web guide can be collected on refresh');
  field.setAttribute('title', '读取系统声音');
  localizer.apply('en');
  assert.equal(field.getAttribute('title'), 'Connect system audio');
  const guidance =
    '选择播放音乐的标签页或屏幕，并勾选「共享音频」。 浏览器也会请求共享画面权限；画面不展示、保存或上传。';
  field.setAttribute('title', guidance);
  localizer.apply('en');
  assert.match(field.getAttribute('title'), /picture is not displayed, saved, or uploaded/);
  assert.notEqual(
    field.getAttribute('title'),
    'Connect system audio',
    'New capability guidance replaces the old title binding',
  );
  localizer.apply('zh');
  assert.equal(bodyText.nodeValue, '  选择音乐  ');
  assert.equal(field.value, '选择音乐');
  assert.equal(field.getAttribute('placeholder'), '给这段知识一个名字…');
  assert.equal(field.getAttribute('title'), guidance);
  localizer.destroy();
});

test('dynamic player state, effects, and source names follow English without translating filenames', () => {
  const nodes = new Map();
  const ui = Object.create(PlayerUI.prototype);
  Object.assign(ui, {
    language: 'en',
    sourceMode: 'system',
    lastTempoSource: 'default',
    lastBeatMarker: null,
    document: { querySelectorAll: () => [], createElement: () => new Node() },
    tempoValue: new Node(),
    get(id) {
      if (!nodes.has(id)) nodes.set(id, new Node());
      return nodes.get(id);
    },
  });
  ui.setPlaying(true);
  assert.equal(ui.get('play-button').getAttribute('aria-label'), 'Pause music and text');
  ui.renderFrame({
    playing: true,
    measured: { silent: true },
    grid: { bpm: 108, tempoSource: 'held', beatIndex: 1 },
  });
  assert.match(ui.get('audio-state').textContent, /No shared audio/);
  assert.match(ui.get('tempo-label').title, /Holding the previous rhythm/);
  ui.renderPreferences({ rate: 3, intensity: 2 });
  assert.equal(ui.get('characters-value').textContent, '3 characters');
  assert.equal(ui.get('intensity-value').textContent, 'Bold');
  ui.setSource({ mode: 'file', name: '选择音乐.wav' });
  assert.equal(ui.get('source-label').textContent, '选择音乐.wav');
  ui.setSource({ mode: 'demo', name: '试听 · 明亮' });
  assert.equal(ui.get('source-label').textContent, 'Demo · Bright');
  for (const effect of EFFECTS)
    assert.ok(EN_EFFECTS[effect.id]?.every((value) => !/[\p{Script=Han}]/u.test(value)));
});

test('the frequency range sends normalized commands, restores percentages and disables only outside automatic mode', async () => {
  class Control extends Node {
    constructor() {
      super();
      this.events = new Map();
      this.disabled = false;
    }
    addEventListener(type, callback) {
      this.events.set(type, callback);
    }
    emit(type) {
      this.events.get(type)?.({ currentTarget: this });
    }
  }
  const nodes = new Map(),
    commands = [];
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Control());
    return nodes.get(id);
  };
  let preferences = normalizePreferences();
  const ui = Object.create(PlayerUI.prototype);
  const documentRef = Object.assign(new Control(), {
    querySelectorAll: () => [],
    querySelector: (selector) => (selector === '.brand' ? get('brand') : null),
  });
  Object.assign(ui, {
    document: documentRef,
    get,
    language: 'zh',
    abort: new AbortController(),
    ready: true,
    destroyed: false,
    busy: new WeakSet(),
    authoringMode: 'source-only',
    handlers: {
      preference(key, value) {
        commands.push([key, value]);
        preferences = normalizePreferences({ ...preferences, [key]: value });
        ui.renderPreferences(preferences);
      },
    },
  });
  ui.bind();
  ui.renderPreferences(preferences);
  const slider = get('ghost-frequency');
  assert.equal(slider.value, '90');
  assert.equal(get('ghost-frequency-value').textContent, '90%');
  assert.equal(slider.disabled, false);
  slider.value = '20';
  slider.emit('input');
  await new Promise(setImmediate);
  assert.deepEqual(commands.at(-1), ['ghostFrequency', 0.2]);
  assert.equal(preferences.rate, 2);
  assert.equal(slider.getAttribute('aria-valuetext'), '20%');
  for (const effect of ['glyph-wave', 'off']) {
    get('ghost-effect').value = effect;
    get('ghost-effect').emit('change');
    await new Promise(setImmediate);
    assert.equal(slider.disabled, true);
    const count = commands.length;
    slider.emit('input');
    await new Promise(setImmediate);
    assert.equal(commands.length, count, 'A disabled frequency input cannot dispatch a command');
    assert.equal(preferences.ghostFrequency, 0.2);
  }
  get('ghost-effect').value = 'auto';
  get('ghost-effect').emit('change');
  await new Promise(setImmediate);
  assert.equal(slider.disabled, false);
  assert.equal(slider.value, '20', 'Returning to auto restores the saved value');
  slider.value = '0';
  slider.emit('input');
  await new Promise(setImmediate);
  assert.equal(preferences.ghostFrequency, 0);
  assert.equal(get('ghost-frequency-value').textContent, '0%');
  ui.abort.abort();
});

test('the frequency control has a labelled accessible percentage and complete bilingual guidance', async () => {
  const html = await fs.readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  const input = /<input\s[^>]*id="ghost-frequency"[^>]*>/s.exec(html)?.[0];
  assert.ok(input);
  for (const expected of [
    'type="range"',
    'min="0"',
    'max="100"',
    'step="5"',
    'value="90"',
    'aria-describedby="ghost-frequency-note"',
    'aria-valuetext="90%"',
  ])
    assert.ok(input.includes(expected));
  assert.match(html, /<label[^>]*for="ghost-frequency"[^>]*>/);
  assert.match(html, /<output[^>]*id="ghost-frequency-value"[^>]*for="ghost-frequency"[^>]*>90%<\/output>/);
  assert.equal(translate('en', '切换频率'), 'Effect changes');
  assert.equal(translate('zh', '切换频率'), '切换频率');
  const guidance = '20%接近原来稳健模式，90%较常切换。仅自动虚影生效。';
  assert.equal(
    translate('en', guidance),
    '20% is close to the original steady mode; 90% changes more often. Only applies to automatic echoes.',
  );
  assert.equal(translate('zh', guidance), guidance);
});

test('public web music-file import is hidden and rejected before file reads, while local preview keeps it', async () => {
  const elements = new Map(['import-audio-button', 'audio-input'].map((id) => [id, new Node()]));
  const documentRef = {
    documentElement: { dataset: { webMusicImport: 'off' } },
    getElementById: (id) => elements.get(id),
  };
  assert.equal(applyMusicImportPolicy(documentRef), false);
  assert.ok([...elements.values()].every((element) => element.hidden && element.disabled));
  const app = {
    document: documentRef,
    destroyed: false,
    queueAudio: () => assert.fail('No audio import may be queued'),
  };
  assert.throws(() => AppController.prototype.importAudio.call(app), /此网页/);
  await assert.rejects(
    AppController.prototype.importFiles.call(app, [
      { arrayBuffer: () => assert.fail('No bytes may be read') },
    ]),
    /此网页/,
  );
  assert.equal(musicFileImportAllowed({ documentElement: { dataset: {} } }), true);
  assert.equal(musicFileImportAllowed({ documentElement: { dataset: { webPublic: 'true' } } }), false);
});

test('switching a player with no selected audio translates its default source label without inventing a source', () => {
  const nodes = new Map();
  const ui = Object.create(PlayerUI.prototype);
  Object.assign(ui, {
    language: 'zh',
    library: [],
    effects: [],
    currentIndex: 0,
    playing: false,
    lastTempoSource: 'default',
    localizer: { apply() {} },
    get(id) {
      if (!nodes.has(id)) nodes.set(id, new Node());
      return nodes.get(id);
    },
  });
  ui.document = {
    documentElement: { dataset: {} },
    querySelectorAll: () => [],
    getElementById: (id) => ui.get(id),
    createElement: () => new Node(),
  };
  ui.get('source-label').textContent = '试听节奏';
  ui.setLanguage('en');
  assert.equal(ui.get('source-label').textContent, 'Demo rhythms');
  assert.equal(ui.sourceMode, null, 'A translated label does not select or start demo audio');
  assert.equal(ui.playing, false);
  ui.setLanguage('zh');
  assert.equal(ui.get('source-label').textContent, '试听节奏');
  ui.setSource({ mode: 'file', name: '我的音乐.mp3' });
  ui.setLanguage('en');
  assert.equal(ui.get('source-label').textContent, '我的音乐.mp3');
});

test('every static Chinese player label, help paragraph, and form attribute has an English edition', async () => {
  const html = await fs.readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  const skipIds = new Set([
    'topic-title',
    'source-label',
    'line-counter',
    'reading-hint',
    'characters-value',
    'intensity-value',
    'audio-state',
    'beat-state',
    'play-caption',
    'welcome-play-label',
  ]);
  const stack = [],
    missing = new Set();
  const voids = new Set(['meta', 'link', 'input', 'br', 'hr', 'img']);
  const decode = (value) =>
    value
      .replace(/&#10;/g, '\n')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
  for (const match of html.matchAll(/<[^>]+>|[^<]+/g)) {
    const token = match[0];
    if (token.startsWith('</')) {
      stack.pop();
      continue;
    }
    if (token.startsWith('<!')) continue;
    if (token.startsWith('<')) {
      const tag = /^<(\w+)/.exec(token)?.[1];
      if (!tag) continue;
      const id = /\bid="([^"]*)"/.exec(token)?.[1];
      const excluded =
        skipIds.has(id) ||
        ['svg', 'script', 'style', 'textarea'].includes(tag) ||
        token.includes('brand-subtitle');
      for (const entry of token.matchAll(/(?:aria-label|title|placeholder)="([^"]*)"/g)) {
        const text = decode(entry[1]);
        if (/[\p{Script=Han}]/u.test(text) && !messageSource(text) && id !== 'dance-canvas')
          missing.add(text);
      }
      if (!voids.has(tag)) stack.push(excluded || stack.at(-1));
    } else if (!stack.at(-1)) {
      const text = decode(token).trim().replace(/\s+/g, ' ');
      if (/[\p{Script=Han}]/u.test(text) && !messageSource(text) && text !== '中文') missing.add(text);
    }
  }
  assert.deepEqual([...missing], []);
});
