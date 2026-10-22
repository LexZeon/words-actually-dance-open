import { hydrateIcons, icon } from './icons.js';
import { formatEditableScript } from '../core/local-state.js';
import { normalizeGhostEffect } from '../core/ghost-effects.js';
import { normalizeGhostFrequency } from '../core/preferences.js';
import { normalizeLocale, translate, translateFeedback, EN_EFFECTS } from '../core/i18n.js';
import { createLocalization, applyMusicImportPolicy, musicFileImportAllowed } from './localization.js';

const TEMPO_HINTS = Object.freeze({
  default: '默认节拍。音乐节奏明显变化时，会平滑调整。',
  held: '延续上一段节拍。音乐安静时，文字与舞动继续。',
  audio: '依据音乐的明显节奏变化调整，平滑衔接。',
});
const AUTHORING_MODES = new Set(['source-only', 'free-examples', 'free-expansion']);

/** DOM presentation and input binding only. Playback and persistence live elsewhere. */
export class PlayerUI {
  constructor({ library = [], effects = [], handlers = {}, documentRef = globalThis.document } = {}) {
    this.document = documentRef;
    this.library = library;
    this.effects = effects.filter((effect) => effect.implemented);
    this.handlers = handlers;
    this.elements = new Map();
    this.abort = new AbortController();
    this.busy = new WeakSet();
    this.destroyed = false;
    this.ready = true;
    this.toastTimer = null;
    this.playing = false;
    this.sourceMode = null;
    this.repeat = true;
    this.authoringMode = 'source-only';
    this.currentIndex = 0;
    this.playlistLength = 0;
    this.lastBeatMarker = null;
    this.lastTempoSource = 'default';
    this.language = 'zh';
    this.localizer = createLocalization(this.document);
    this.localizer.apply(this.language);
    applyMusicImportPolicy(this.document);
    hydrateIcons(this.document);
    this.setupTempo();
    this.setupEffects();
    this.bind();
  }

  text(message, values) {
    return translate(this.language, message, values);
  }

  setLanguage(locale, { library = this.library } = {}) {
    const language = normalizeLocale(locale);
    const changed = language !== this.language;
    const libraryChanged =
      library.length !== this.library.length || library.some((topic, index) => topic !== this.library[index]);
    this.language = language;
    this.library = library;
    if (!changed) {
      if (libraryChanged) this.renderTopics(this.currentIndex);
      return;
    }
    this.refreshLocalization();
    this.setupEffects();
    this.renderTopics(this.currentIndex);
    if (this.lastPreferences) this.renderPreferences(this.lastPreferences);
    this.setPlaying(this.playing);
    this.get('tempo-label').title = this.text(TEMPO_HINTS[this.lastTempoSource] || TEMPO_HINTS.default);
    this.setSource(this.sourceInfo || { mode: null });
    if (this.currentKeyword !== undefined) this.setKeyword(this.currentKeyword);
    if (this.lastFrame) this.renderFrame({ ...this.lastFrame, playing: this.playing });
    if (this.scriptError) this.setScriptError(this.scriptError, { focus: false });
    if (this.toastMessage)
      this.get('toast').textContent = translateFeedback(this.language, this.toastMessage);
  }

  refreshLocalization() {
    this.localizer.apply(this.language);
    applyMusicImportPolicy(this.document);
  }

  get(id) {
    if (!this.elements.has(id)) {
      const element = this.document.getElementById(id);
      if (!element) throw new Error(`Missing player element: ${id}`);
      this.elements.set(id, element);
    }
    return this.elements.get(id);
  }

  listen(target, type, listener) {
    const element = typeof target === 'string' ? this.get(target) : target;
    element.addEventListener(type, listener, { signal: this.abort.signal });
  }

  async run(operation, button = null, { script = false } = {}) {
    if (this.destroyed || !this.ready || (button && this.busy.has(button))) return false;
    const wasDisabled = button?.disabled;
    if (script) this.setScriptError('');
    if (button) {
      this.busy.add(button);
      button.disabled = true;
    }
    try {
      await operation();
      return true;
    } catch (error) {
      const message = (error?.message || '这次操作未能完成，请再试一次。').replace(
        /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/u,
        '',
      );
      if (script && !this.destroyed) this.setScriptError(message);
      this.toast(message);
      return false;
    } finally {
      if (button && !this.destroyed) {
        this.busy.delete(button);
        button.disabled = wasDisabled;
      }
    }
  }

  command(name, ...args) {
    if (this.destroyed || !this.ready) return false;
    if (typeof this.handlers[name] !== 'function') throw new Error('此操作尚未接入。');
    this.interaction({ kind: 'command', target: name });
    return this.handlers[name](...args);
  }

  setReady(value) {
    this.ready = Boolean(value);
    this.document.body.inert = !this.ready;
    this.document.body.setAttribute('aria-busy', String(!this.ready));
  }

  interaction(detail) {
    if (typeof this.handlers.interaction === 'function') this.run(() => this.handlers.interaction(detail));
  }

  setupTempo() {
    const tempo = this.get('tempo-label');
    this.tempoValue = this.document.createElement('span');
    this.tempoValue.className = 'tempo-value';
    this.tempoValue.textContent = '—';
    const unit = this.document.createElement('span');
    unit.className = 'tempo-unit';
    unit.textContent = 'BPM';
    tempo.replaceChildren(this.tempoValue, unit);
    tempo.title = this.text(TEMPO_HINTS.default);
  }

  setupEffects() {
    const target = this.get('effect-options');
    target.replaceChildren();
    this.effects.forEach((effect) => {
      const button = this.document.createElement('button');
      button.type = 'button';
      const english = this.language === 'en' ? EN_EFFECTS[effect.id] : null;
      button.textContent = english?.[0] || effect.label;
      button.title = english?.[1] || effect.description;
      button.dataset.effect = effect.id;
      target.append(button);
    });
  }

  bind() {
    this.document
      .querySelectorAll('[data-language]')
      .forEach((button) =>
        this.listen(button, 'click', () =>
          this.run(() => this.command('preference', 'language', button.dataset.language), button),
        ),
      );
    const panelButtons = {
      'source-button': 'source-dialog',
      'content-button': 'content-dialog',
      'settings-button': 'settings-dialog',
    };
    Object.entries(panelButtons).forEach(([button, panel]) =>
      this.listen(button, 'click', () => this.openPanel(panel)),
    );
    const actions = {
      'play-button': ['playPause'],
      'previous-button': ['step', -1],
      'next-button': ['step', 1],
      'download-button': ['download'],
      'like-button': ['like'],
      'system-audio-button': ['systemAudio'],
      'import-audio-button': ['importAudio'],
      'import-script-button': ['importScript'],
      'export-script-button': ['exportScript'],
    };
    Object.entries(actions).forEach(([id, [name, ...args]]) => {
      this.listen(id, 'click', (event) =>
        this.run(() => this.command(name, ...args), event.currentTarget, {
          script: name === 'importScript',
        }),
      );
    });
    this.listen('audio-input', 'change', (event) => {
      const files = Array.from(event.currentTarget.files || []);
      event.currentTarget.value = '';
      if (files.length) this.run(() => this.command('importFiles', files));
    });
    this.listen('script-input', 'change', (event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) this.run(() => this.command('importScriptFile', file), null, { script: true });
    });
    this.get('authoring-mode').value = this.authoringMode;
    this.listen('authoring-mode', 'change', (event) => {
      const mode = event.currentTarget.value;
      this.authoringMode = AUTHORING_MODES.has(mode) ? mode : 'source-only';
    });
    this.listen('copy-authoring-prompt', 'click', (event) =>
      this.run(() => this.command('copyAuthoringPrompt', this.authoringMode), event.currentTarget),
    );
    this.listen('topic-list', 'click', (event) => {
      const button = event.target.closest('button[data-topic-index]');
      if (!button) return;
      const index = Number(button.dataset.topicIndex);
      if (!Number.isInteger(index) || !this.library[index]) return;
      this.run(async () => {
        await this.command('selectTopic', this.library[index], index);
        this.closePanel('content-dialog');
      }, button);
    });
    this.listen('playlist', 'click', (event) => {
      const button = event.target.closest('button[data-track-index]');
      if (!button) return;
      const index = Number(button.dataset.trackIndex);
      if (!Number.isInteger(index) || index < 0 || index >= this.playlistLength) return;
      this.run(async () => {
        await this.command('selectTrack', index);
        this.closePanel('source-dialog');
      }, button);
    });
    this.document.querySelectorAll('[data-demo]').forEach((button) =>
      this.listen(button, 'click', () => {
        this.run(async () => {
          const changed = await this.command('demo', button.dataset.demo);
          if (changed === false || this.destroyed) return;
          this.document
            .querySelectorAll('[data-demo]')
            .forEach((item) => item.classList.toggle('selected', item === button));
          this.closePanel('source-dialog');
        }, button);
      }),
    );
    this.listen('effect-options', 'click', (event) => {
      const button = event.target.closest('button[data-effect]');
      if (!button) return;
      this.run(async () => {
        await this.command('preference', 'autoDirection', false);
        await this.command('preference', 'effect', button.dataset.effect);
      }, button);
    });
    const preferences = {
      'characters-per-beat': ['input', 'rate', (input) => Number(input.value)],
      'dance-intensity': ['input', 'intensity', (input) => Number(input.value)],
      'ghost-effect': ['change', 'ghostEffect', (input) => input.value],
      'ghost-frequency': ['input', 'ghostFrequency', (input) => Number(input.value) / 100],
      'emoji-toggle': ['change', 'emoji', (input) => input.checked],
      'auto-direction-toggle': ['change', 'autoDirection', (input) => input.checked],
      'repeat-toggle': ['change', 'repeat', (input) => input.checked],
    };
    Object.entries(preferences).forEach(([id, [event, key, value]]) =>
      this.listen(id, event, (input) => {
        if (input.currentTarget.disabled) return;
        this.run(() => this.command('preference', key, value(input.currentTarget)));
      }),
    );
    this.listen('script-form', 'submit', (event) => {
      event.preventDefault();
      this.run(
        async () => {
          await this.command('applyText', this.get('custom-title').value, this.get('custom-text').value);
          this.closePanel('content-dialog');
        },
        this.get('apply-content'),
        { script: true },
      );
    });
    for (const id of ['custom-title', 'custom-text']) this.listen(id, 'input', () => this.setScriptError(''));
    this.document
      .querySelectorAll('[data-close]')
      .forEach((button) => this.listen(button, 'click', () => button.closest('dialog')?.close()));
    this.document.querySelectorAll('dialog').forEach((dialog) =>
      this.listen(dialog, 'click', (event) => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          dialog.close();
      }),
    );
    this.listen(this.document.querySelector('.brand'), 'click', (event) => {
      event.preventDefault();
      this.run(() => this.command('restart'));
    });
    this.listen(this.document, 'keydown', (event) => {
      if (
        event.repeat ||
        event.target.closest?.('input,textarea,select,button,summary,[contenteditable=true]') ||
        this.document.querySelector('dialog[open]')
      )
        return;
      const command =
        event.code === 'Space'
          ? ['playPause']
          : event.code === 'ArrowRight'
            ? ['step', 1]
            : event.code === 'ArrowLeft'
              ? ['step', -1]
              : null;
      if (!command) return;
      event.preventDefault();
      this.run(() => this.command(...command));
    });
  }

  showTopic(topic, index, { liked = false, playing = this.playing } = {}) {
    this.currentIndex = index;
    this.get('topic-number').textContent = index < 0 ? '＋' : String(index + 1).padStart(2, '0');
    this.get('topic-title').textContent = String(topic.title || this.text('我的知识'));
    this.setLine(0, topic.lines?.length || 0);
    this.setLiked(liked);
    this.get('reading-hint').textContent = this.text(
      playing ? '逐句自动播放。' : '按下播放，让文字跟着音乐走。',
    );
    this.renderTopics(index);
  }

  renderTopics(index = this.currentIndex) {
    const list = this.get('topic-list');
    list.replaceChildren();
    this.library.forEach((topic, topicIndex) => {
      const button = this.document.createElement('button');
      button.type = 'button';
      button.className = 'topic-item';
      button.classList.toggle('active', topicIndex === index);
      button.dataset.topicIndex = String(topicIndex);
      const number = this.document.createElement('span');
      number.className = 'topic-index';
      number.textContent = String(topicIndex + 1).padStart(2, '0');
      const text = this.document.createElement('span');
      const name = this.document.createElement('strong');
      name.textContent = String(topic.keyword || topic.title || this.text('知识'));
      const subtitle = this.document.createElement('small');
      subtitle.textContent = String(topic.title || '');
      text.append(name, subtitle);
      const emoji = this.document.createElement('span');
      emoji.className = 'topic-emoji';
      emoji.textContent = String(topic.emoji || '');
      button.append(number, text, emoji);
      list.append(button);
    });
  }

  renderPlaylist(audio) {
    const tracks = Array.isArray(audio?.playlist) ? audio.playlist : [];
    this.playlistLength = tracks.length;
    const target = this.get('playlist');
    target.replaceChildren();
    tracks.forEach((track, index) => {
      const button = this.document.createElement('button');
      button.type = 'button';
      button.dataset.trackIndex = String(index);
      button.classList.toggle('active', audio.mode === 'file' && index === audio.trackIndex);
      button.disabled = typeof this.handlers.selectTrack !== 'function';
      const symbol = this.document.createElement('span');
      symbol.innerHTML = icon('music');
      const label = this.document.createElement('span');
      label.className = 'track-name';
      label.textContent = String(track.name || this.text('音乐 {index}', { index: index + 1 }));
      button.append(symbol, label);
      target.append(button);
    });
    if (audio?.name) this.setSource(audio);
  }

  renderPreferences(preferences) {
    this.lastPreferences = preferences;
    const autoDirection = preferences.autoDirection !== false;
    const rate = Math.min(4, Math.max(1, Math.round(Number(preferences.rate) || 2)));
    const intensity = Math.min(2.5, Math.max(0.15, Number(preferences.intensity) || 1.25));
    this.repeat = preferences.repeat !== false;
    this.get('characters-per-beat').value = String(rate);
    this.get('characters-value').textContent = this.text('{count} 字', { count: rate });
    this.get('dance-intensity').value = String(intensity);
    const ghostEffect = normalizeGhostEffect(preferences.ghostEffect);
    const ghostPercent = Math.round(normalizeGhostFrequency(preferences.ghostFrequency) * 100);
    this.get('ghost-effect').value = ghostEffect;
    const frequencyInput = this.get('ghost-frequency');
    frequencyInput.value = String(ghostPercent);
    frequencyInput.disabled = ghostEffect !== 'auto';
    frequencyInput.setAttribute('aria-valuetext', `${ghostPercent}%`);
    this.get('ghost-frequency-value').textContent = `${ghostPercent}%`;
    this.get('intensity-value').textContent = this.text(
      intensity < 0.55 ? '轻柔' : intensity > 1.65 ? '夸张' : '明显',
    );
    this.get('emoji-toggle').checked = preferences.emoji !== false;
    this.get('auto-direction-toggle').checked = autoDirection;
    this.get('repeat-toggle').checked = this.repeat;
    this.get('manual-effects').hidden = autoDirection;
    this.get('auto-direction-note').hidden = !autoDirection;
    this.get('effect-options')
      .querySelectorAll('button')
      .forEach((button) => {
        const selected = !autoDirection && button.dataset.effect === preferences.effect;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
  }

  setPlaying(playing) {
    this.playing = Boolean(playing);
    const button = this.get('play-button');
    button.innerHTML = icon(this.playing ? 'pause' : 'play');
    button.setAttribute('aria-label', this.text(this.playing ? '暂停音乐与文字' : '播放音乐与文字'));
    this.get('reading-hint').textContent = this.text(
      this.playing ? '逐句自动播放。' : '已暂停，文字留在这里。',
    );
    if (!this.playing) this.get('beat-state').textContent = this.text('已暂停');
  }

  renderFrame({ playing = this.playing, measured = {}, grid = {}, finished = false } = {}) {
    this.lastFrame = { playing, measured, grid, finished };
    const bpm = Number(grid.bpm);
    this.write(this.tempoValue, Number.isFinite(bpm) && bpm > 0 ? String(Math.round(bpm)) : '—');
    const tempoSource = grid.tempoSource || 'default';
    if (tempoSource !== this.lastTempoSource) {
      this.lastTempoSource = tempoSource;
      this.get('tempo-label').title = this.text(TEMPO_HINTS[tempoSource] || TEMPO_HINTS.default);
    }
    this.write(
      this.get('audio-state'),
      this.text(
        !playing
          ? '已暂停'
          : measured.silent
            ? this.sourceMode === 'system'
              ? '尚未收到系统声音，请检查输出设备或重新连接。'
              : '音乐安静'
            : '音乐正在播放',
      ),
    );
    this.write(
      this.get('beat-state'),
      this.text(!playing ? '已暂停' : tempoSource === 'audio' ? '随音乐调整' : '拍子继续'),
    );
    if (playing && !finished) this.write(this.get('reading-hint'), this.text('逐句自动播放。'));
    const marker = playing && Number.isInteger(grid.beatIndex) ? grid.beatIndex : -1;
    if (marker !== this.lastBeatMarker) {
      this.lastBeatMarker = marker;
      const dots = this.document.querySelectorAll('.music-signal span');
      dots.forEach((dot, index) =>
        dot.classList.toggle('hit', marker >= 0 && index === marker % dots.length),
      );
    }
  }

  write(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }
  setLine(index, total, { text } = {}) {
    this.get('line-counter').textContent =
      `${String(Math.max(0, index) + 1).padStart(2, '0')} / ${String(Math.max(0, total)).padStart(2, '0')}`;
    if (typeof text === 'string') this.get('knowledge-accessible').textContent = text;
  }
  setComplete(repeat = this.repeat) {
    this.get('reading-hint').textContent = this.text(
      repeat ? '读完这一遍，接着从头开始。' : '读完了。换一段，或再读一次。',
    );
  }
  setLiked(liked) {
    this.get('like-button').setAttribute('aria-pressed', String(Boolean(liked)));
  }
  setKeyword(keyword) {
    this.currentKeyword = keyword;
    this.get('dance-canvas').setAttribute(
      'aria-label',
      this.text('当前关键词：{keyword}', { keyword: String(keyword) }),
    );
  }
  setSource(info) {
    this.sourceInfo = info;
    this.sourceMode = info?.mode ?? null;
    const original = String(info?.name || (info?.mode === 'system' ? '系统声音' : '试听节奏'));
    const name = info?.mode === 'file' ? original : this.text(original);
    this.get('source-label').textContent = name;
    this.get('source-label').title = name;
  }
  restoreEditor(topic) {
    this.get('custom-title').value = String(topic?.title || '');
    this.get('custom-text').value = topic?.lines ? formatEditableScript(topic) : '';
    if (AUTHORING_MODES.has(topic?.sourceMode)) {
      this.authoringMode = topic.sourceMode;
      this.get('authoring-mode').value = topic.sourceMode;
    }
    this.setScriptError('');
  }
  setScriptError(message, { focus = true } = {}) {
    this.scriptError = message;
    const error = this.get('script-error');
    error.textContent = translateFeedback(this.language, String(message || ''));
    error.hidden = !message;
    this.get('custom-text').setAttribute('aria-invalid', String(Boolean(message)));
    if (message && focus) {
      this.get('custom-text').focus({ preventScroll: true });
      error.scrollIntoView({ block: 'nearest' });
    }
  }
  openAudioPicker() {
    if (!musicFileImportAllowed(this.document)) {
      this.toast('此网页不提供本地音乐导入，请使用共享声音或内置试听。');
      return false;
    }
    this.get('audio-input').click();
  }
  openScriptPicker() {
    this.get('script-input').click();
  }
  openPanel(id) {
    if (this.destroyed) return;
    const panel = this.get(id);
    if (!panel.open) panel.showModal();
    this.interaction({ kind: 'open-panel', target: id });
  }
  closePanel(id) {
    if (this.destroyed) return;
    const panel = this.get(id);
    if (panel.open) panel.close();
  }

  toast(message) {
    if (this.destroyed) return;
    const toast = this.get('toast');
    this.toastMessage = String(message);
    toast.textContent = translateFeedback(this.language, String(message));
    toast.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      if (!this.destroyed) toast.classList.remove('visible');
    }, 2600);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abort.abort();
    clearTimeout(this.toastTimer);
    this.localizer?.destroy();
    this.elements.clear();
  }
}

export default PlayerUI;
