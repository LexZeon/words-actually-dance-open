import { createAppRuntime } from './app-runtime.js';
import { sampleLibrary } from '../content/sample-library.js';
import { localizeSampleTopic } from '../content/sample-translations.js';
import { getLikeKey } from '../content/content-identity.js';
import { parseScriptInput, withScriptTitle } from '../content/script-document.js';
import { authoringPrompt } from '../content/authoring-prompt.js';
import { decodeScriptFile, MAX_SCRIPT_FILE_BYTES, scriptTitleFromFilename } from '../content/script-file.js';
import { eventBus, EVENTS } from '../core/events.js';
import { providerRegistry } from '../core/contracts.js';
import { restoreContentSelection } from '../core/local-state.js';
import { DEFAULT_PREFERENCES, normalizePreferences } from '../core/preferences.js';
import { ImportIntents } from '../core/import-intents.js';
import { normalizeLocale } from '../core/i18n.js';
import { musicFileImportAllowed } from '../ui/localization.js';

function importIntents(app) {
  return (app.importIntents ??= new ImportIntents({ isAlive: () => !app.destroyed }));
}

function reserveImport(app, channel) {
  if (channel === 'script') app.contentGeneration++;
  return importIntents(app).reserve(channel);
}

const RELATION_MOTION = Object.freeze({
  part: 'expand',
  measure: 'progress',
  context: 'related',
  condition: 'progress',
  effect: 'cause',
  limit: 'contrast',
  mechanism: 'expand',
  parameter: 'combine',
  direction: 'progress',
  return: 'related',
  coordination: 'combine',
  method: 'progress',
  refine: 'progress',
});

/** Application commands connect content, playback, local storage and extension ports. */
export class AppController {
  constructor({
    bus = eventBus,
    registry = providerRegistry,
    factories = {},
    documentRef = globalThis.document,
    windowRef = globalThis.window,
  } = {}) {
    this.state = {
      topicIndex: 0,
      custom: null,
      playing: false,
      profile: 'balanced',
      likes: new Set(),
      preferences: { ...DEFAULT_PREFERENCES },
    };
    this.activeTopic = sampleLibrary[0];
    this.pendingTopic = null;
    this.lastMeter = 0;
    this.keywordCount = 0;
    this.audioCommands = Promise.resolve();
    this.audioPending = 0;
    this.contentGeneration = 0;
    this.languageGeneration = 0;
    this.destroyed = false;
    this.bus = bus;
    this.registry = registry;
    this.window = windowRef;
    this.document = documentRef;
    this.ownedProviders = [];
    this.bootPromise = null;
    this.shutdownPromise = null;
    this.onBeforeUnload = () => this.destroy();
    try {
      createAppRuntime(this, { factories, documentRef });
      this.installProviders();
      this.window.addEventListener('beforeunload', this.onBeforeUnload, { once: true });
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  boot() {
    if (this.bootPromise) return this.bootPromise;
    if (this.destroyed) return Promise.resolve(false);
    this.bootPromise = this.initialize().catch(async (error) => {
      if (!this.destroyed) this.ui.toast('实验版启动失败，请重新打开。');
      await this.destroy();
      throw error;
    });
    return this.bootPromise;
  }

  async initialize() {
    const stored = await this.repository.load();
    if (this.destroyed) return false;
    if (stored && typeof stored === 'object') {
      this.state.preferences = normalizePreferences(stored.preferences, stored.schemaVersion || 1);
      this.state.likes = new Set(
        Array.isArray(stored.likes)
          ? stored.likes.filter((value) => typeof value === 'string').slice(0, 2000)
          : [],
      );
      Object.assign(this.state, restoreContentSelection(stored, sampleLibrary.length));
    }
    // The old single custom slot can only be attributed to the restored document.
    // Migration stays in memory until the next explicit save.
    if (this.state.likes.delete('custom') && this.state.custom)
      this.state.likes.add(getLikeKey(this.state.custom));
    if (this.state.custom) this.ui.restoreEditor(this.state.custom);
    this.ui.setLanguage?.(this.state.preferences.language, { library: this.getLibrary() });
    this.applyTopic(
      this.state.topicIndex === -1 ? this.state.custom : this.getLibrary()[this.state.topicIndex],
      this.state.topicIndex,
      { persist: false },
    );
    if (this.destroyed) return false;
    this.applyPreferences();
    this.setPlaying(false);
    if (this.window.desktop?.testMode) {
      const { installExperimentQA } = await import('../dev/experiment-qa.js');
      if (this.destroyed) return false;
      installExperimentQA(this);
    }
    if (this.destroyed) return false;
    this.playback.start();
    this.ui.setReady(true);
    this.window.__wadReady = true;
    return true;
  }

  save() {
    if (this.destroyed) return false;
    return this.repository.save({
      schemaVersion: 2,
      topicIndex: this.state.topicIndex,
      custom: this.state.custom,
      likes: [...this.state.likes],
      preferences: this.state.preferences,
    });
  }

  loadTopic(topic, index, { invalidateContentRequest = true } = {}) {
    if (this.destroyed) return false;
    if (invalidateContentRequest) {
      this.contentGeneration++;
      importIntents(this).invalidate('script');
    }
    if (this.state.playing) {
      this.pendingTopic = { topic, index };
      this.ui.toast('下一拍，切换知识。');
    } else {
      this.pendingTopic = null;
      this.applyTopic(topic, index);
    }
  }

  applyTopic(topic, index, { persist = true } = {}) {
    if (this.destroyed) return false;
    topic = localizeSampleTopic(topic, this.state.preferences.language);
    this.activeTopic = topic;
    this.ui.get('knowledge-accessible').textContent = '';
    this.state.topicIndex = index;
    this.knowledge.setScript(topic, {
      initialKeyword: this.state.playing ? this.dance.word : topic.lines[0].keyword,
    });
    if (!this.state.playing) {
      this.dance.setWord(topic.lines[0].keyword, {}, { immediate: true });
      this.ui.setKeyword(topic.lines[0].keyword);
    }
    this.dance.setEmoji(this.state.preferences.emoji ? topic.emoji : '');
    this.ui.showTopic(topic, index, {
      liked: this.state.likes.has(getLikeKey(topic)),
      playing: this.state.playing,
    });
    if (persist) this.save();
    this.bus.emit(EVENTS.CONTENT_LOADED, { id: topic.id, title: topic.title });
  }

  onKeyword(keyword, relation, beatDuration) {
    const previous = this.dance.word;
    const chosen =
      relation?.from === previous
        ? relation
        : this.activeTopic.relations?.find((edge) => edge.from === previous && edge.to === keyword) || {
            from: previous,
            to: keyword,
            type: previous === keyword ? 'focus' : 'related',
            label: previous === keyword ? '当前概念' : '同篇概念连接',
          };
    this.dance.setWord(
      keyword,
      { ...chosen, type: RELATION_MOTION[chosen.type] || chosen.type },
      { beatDuration },
    );
    this.ui.setKeyword(keyword);
    this.keywordCount++;
    this.bus.emit(EVENTS.KEYWORD_ENTER, { keyword, relation: chosen, beatDuration });
    if (chosen.from && chosen.from !== keyword)
      this.bus.emit(EVENTS.KEYWORD_TRANSITION, {
        from: chosen.from,
        to: keyword,
        relation: chosen,
        beatDuration,
      });
  }

  onComplete() {
    this.ui.setComplete(this.state.preferences.repeat);
    this.bus.emit(EVENTS.CONTENT_COMPLETE, { id: this.activeTopic.id });
    if (this.state.preferences.repeat) this.knowledge.requestStep(-this.activeTopic.lines.length);
  }

  setPlaying(value) {
    this.state.playing = Boolean(value);
    this.playback.setPlaying(this.state.playing);
    this.ui.setPlaying(this.state.playing);
  }

  queueAudio(command) {
    this.audioPending++;
    const next = this.audioCommands.then(() => {
      if (!this.destroyed) return command();
    });
    this.audioCommands = next.catch(() => {});
    return next.finally(() => this.audioPending--);
  }

  captureSystem() {
    if (this.destroyed) return Promise.resolve(false);
    if (this.audioPending) throw new Error('正在处理音源，请稍后再点读取系统声音。');
    importIntents(this).invalidate('music');
    // Request the browser picker in the actual click's call stack. Only its
    // completion/commit belongs in the audio queue; never defer the gesture.
    const started = Promise.resolve(this.audio.startSystem());
    // Closing before the queued completion retires must still own a rejection.
    started.catch(() => {});
    return this.queueAudio(() => this.switchSource(() => started));
  }

  togglePlayback() {
    importIntents(this).invalidate('music');
    return this.queueAudio(() => this.performTogglePlayback());
  }
  async performTogglePlayback() {
    if (this.state.playing) {
      this.setPlaying(false);
      await this.audio.setPaused(true);
    } else {
      const accepted = !this.audio.mode
        ? await this.audio.startDemo(this.state.profile)
        : await this.audio.setPaused(false);
      if (this.destroyed || accepted === false) return false;
      this.setPlaying(true);
    }
  }

  changeSource(start) {
    importIntents(this).invalidate('music');
    return this.queueAudio(() => this.switchSource(start));
  }
  async switchSource(start) {
    const accepted = await start();
    if (this.destroyed || accepted === false) return false;
    this.playback.resetSource();
    this.setPlaying(true);
    this.ui.closePanel('source-dialog');
    return true;
  }
  async demo(profile) {
    this.state.profile = profile;
    return this.changeSource(() => this.audio.startDemo(profile));
  }
  onSource(info) {
    if (this.destroyed) return;
    this.ui.setSource(info);
    this.ui.renderPlaylist(this.audio);
    // An ended/quiet source holds the musical clock; only the user's Pause freezes it.
    if (info.ended)
      this.ui.toast(
        info.mode === 'system'
          ? '系统声音已断开。重新选择声音来源，文字仍会继续。'
          : '音乐播放完了，文字继续。',
      );
    this.bus.emit(EVENTS.AUDIO_SOURCE_CHANGED, { mode: info.mode, name: info.name });
  }

  importAudio() {
    if (!musicFileImportAllowed(this.document))
      throw new Error('此网页不提供本地音乐导入，请使用共享声音或内置试听。');
    const intent = reserveImport(this, 'music');
    return this.queueAudio(() => this.performImportAudio(intent));
  }
  async performImportAudio(intent = reserveImport(this, 'music')) {
    if (!importIntents(this).isCurrent('music', intent)) return false;
    if (!this.window.desktop) {
      this.ui.openAudioPicker();
      return;
    }
    const chosen = await this.window.desktop.chooseAudio();
    if (!chosen || !intent.isCurrent()) return false;
    const index = await this.audio.addTrack(chosen.name, chosen.bytes, { accept: intent.isCurrent });
    if (!intent.isCurrent()) return false;
    await this.switchSource(() => this.audio.playTrack(index, { accept: intent.isCurrent }));
  }

  reserveImportIntent(channel) {
    return reserveImport(this, channel);
  }

  importFiles(files, { intent = reserveImport(this, 'music') } = {}) {
    if (!musicFileImportAllowed(this.document))
      return Promise.reject(new Error('此网页不提供本地音乐导入，请使用共享声音或内置试听。'));
    if (!importIntents(this).isCurrent('music', intent)) return Promise.resolve(false);
    return this.queueAudio(() => this.performImportFiles(files, intent));
  }
  async performImportFiles(files, intent = reserveImport(this, 'music')) {
    if (!importIntents(this).isCurrent('music', intent)) return false;
    let first = -1;
    for (const file of files) {
      if (file.size > 200 * 1024 * 1024) throw new Error('请选择小于 200 MB 的音乐文件。');
      const bytes = await file.arrayBuffer();
      if (!intent.isCurrent()) return false;
      const index = await this.audio.addTrack(file.name, bytes, { accept: intent.isCurrent });
      if (!intent.isCurrent()) return false;
      if (first < 0) first = index;
    }
    if (first >= 0 && intent.isCurrent())
      return this.switchSource(() => this.audio.playTrack(first, { accept: intent.isCurrent }));
    return false;
  }

  step(delta) {
    this.knowledge.requestStep(delta);
    this.ui.toast(
      delta < -1 ? '下一拍，重新开始。' : delta < 0 ? '上一句将在下一拍出现。' : '下一句将在下一拍出现。',
    );
  }
  applyText(title, text, { editor = false, intent = null } = {}) {
    if (this.destroyed) return false;
    if (intent && !importIntents(this).isCurrent('script', intent)) return false;
    this.contentGeneration++;
    if (!intent) importIntents(this).invalidate('script');
    let topic = parseScriptInput(text, title);
    if (editor && typeof title === 'string' && title.trim() && title.trim() !== topic.title)
      topic = withScriptTitle(topic, title.trim());
    this.state.custom = topic;
    this.ui.restoreEditor(topic);
    this.loadTopic(topic, -1, { invalidateContentRequest: false });
    this.save();
    this.ui.toast('文案已放入。');
  }

  async copyAuthoringPrompt(mode) {
    const text = authoringPrompt(mode, this.state.preferences.language);
    if (this.window.desktop) await this.window.desktop.copyText(text);
    else await this.window.navigator.clipboard.writeText(text);
    if (!this.destroyed) this.ui.toast('提示词已复制，把它和你的材料一起交给 AI。');
  }

  async importScript() {
    const intent = reserveImport(this, 'script');
    if (!this.window.desktop) {
      this.ui.openScriptPicker();
      return;
    }
    const chosen = await this.window.desktop.chooseScript();
    if (chosen && intent.isCurrent()) this.applyScriptFile(chosen.name, chosen.bytes, { intent });
  }

  async importScriptFile(file, { intent = reserveImport(this, 'script') } = {}) {
    if (!importIntents(this).isCurrent('script', intent)) return false;
    if (file.size > MAX_SCRIPT_FILE_BYTES) throw new Error('请选择小于 512 KB 的文案文件。');
    const bytes = await file.arrayBuffer();
    if (!intent.isCurrent()) return false;
    this.applyScriptFile(file.name, bytes, { intent });
    return true;
  }

  applyScriptFile(name, bytes, { intent = null } = {}) {
    if (this.destroyed) return false;
    if (this.applyText(scriptTitleFromFilename(name), decodeScriptFile(bytes), { intent }) === false)
      return false;
    this.ui.closePanel('content-dialog');
    return true;
  }

  async exportScript() {
    const topic = this.activeTopic;
    if ((await this.repository.downloadScript(topic)) && !this.destroyed) {
      this.ui.toast('标准文案已保存，可再次导入播放。');
      this.bus.emit(EVENTS.DOWNLOAD, { id: topic.id, format: 'wad-json' });
    }
  }
  like() {
    if (this.destroyed) return false;
    const id = getLikeKey(this.activeTopic);
    if (this.state.likes.has(id)) this.state.likes.delete(id);
    else this.state.likes.add(id);
    this.ui.setLiked(this.state.likes.has(id));
    this.save();
    this.bus.emit(EVENTS.LIKE_CHANGED, {
      id: this.activeTopic.id,
      likeKey: id,
      liked: this.state.likes.has(id),
    });
  }
  async download() {
    const topic = this.activeTopic;
    if ((await this.repository.download(topic)) && !this.destroyed) {
      this.ui.toast('文案已保存到本地。');
      this.bus.emit(EVENTS.DOWNLOAD, { id: topic.id });
    }
  }

  preference(key, value) {
    if (!Object.hasOwn(DEFAULT_PREFERENCES, key)) return;
    if (key === 'language') return this.changeLanguage(value);
    this.state.preferences = normalizePreferences({ ...this.state.preferences, [key]: value });
    this.applyPreferences();
    this.save();
    this.bus.emit(EVENTS.PREFERENCE_CHANGED, { key, value: this.state.preferences[key] });
    if (key === 'repeat' && this.state.preferences.repeat && this.knowledge.getState().finished)
      this.knowledge.requestStep(-this.activeTopic.lines.length);
  }

  applyPreferences() {
    const p = this.state.preferences;
    this.ui.setLanguage?.(p.language, { library: this.getLibrary() });
    this.knowledge.setAutoDirection(p.autoDirection);
    this.knowledge.setEffect(p.effect);
    this.knowledge.setRate(p.rate);
    this.dance.setIntensity(p.intensity);
    this.dance.setGhostEffect(p.ghostEffect);
    this.dance.setGhostFrequency(p.ghostFrequency);
    this.dance.setEmoji(p.emoji ? this.activeTopic.emoji : '');
    this.ui.renderPreferences(p);
  }

  getLibrary() {
    return sampleLibrary.map((topic) => localizeSampleTopic(topic, this.state.preferences.language));
  }

  async changeLanguage(value) {
    const language = normalizeLocale(value);
    if (this.destroyed || (language === this.state.preferences.language && !this.pendingLanguage))
      return false;
    const generation = ++this.languageGeneration;
    this.pendingLanguage = language;
    // Pause the shared timeline in the initiating action. The existing queue
    // owns real audio suspension and serializes it after earlier source work.
    this.setPlaying(false);
    this.pendingTopic = null;
    try {
      const changed = await this.queueAudio(async () => {
        if (this.destroyed || generation !== this.languageGeneration) return false;
        this.setPlaying(false);
        const paused = this.audio.mode ? await this.audio.setPaused(true) : true;
        if (this.destroyed || generation !== this.languageGeneration) return false;
        if (paused === false) throw new Error('音乐暂时未能暂停，请再试一次。');
        this.state.preferences = normalizePreferences({ ...this.state.preferences, language });
        this.ui.setLanguage?.(language, { library: this.getLibrary() });
        if (this.state.topicIndex >= 0)
          this.applyTopic(this.getLibrary()[this.state.topicIndex], this.state.topicIndex, {
            persist: false,
          });
        this.applyPreferences();
        this.save();
        this.bus.emit(EVENTS.PREFERENCE_CHANGED, { key: 'language', value: language });
        this.ui.toast('语言已切换。按播放继续。');
        return true;
      });
      return changed === true;
    } finally {
      if (generation === this.languageGeneration) this.pendingLanguage = null;
    }
  }

  installProviders() {
    this.ownedProviders.push(
      this.registry.register({
        id: 'local-library',
        kind: 'library',
        title: '本机文案',
        methods: {
          save: () => this.save(),
          like: (id) => {
            const topic =
              id === 'custom' ? this.state.custom : sampleLibrary.find((entry) => entry.id === id);
            if (!topic) throw new Error('本机没有这份文案。');
            this.state.likes.add(getLikeKey(topic));
            this.save();
            if (getLikeKey(topic) === getLikeKey(this.activeTopic)) this.ui.setLiked(true);
          },
          download: () => this.download(),
        },
      }),
    );
    this.ownedProviders.push(
      this.registry.register({
        id: 'local-text',
        kind: 'input',
        title: '本地文字',
        methods: { extractText: async (text) => String(text) },
      }),
    );
    this.ownedProviders.push(
      this.registry.register({
        id: 'music-analysis',
        kind: 'music',
        title: '本机音频分析',
        methods: { analyzeFrame: () => ({ ...this.playback.rawFeatures }) },
      }),
    );
  }

  getState() {
    return {
      ...this.playback.getState(),
      topicId: this.activeTopic.id,
      keywordCount: this.keywordCount,
      preferences: { ...this.state.preferences },
    };
  }
  destroy() {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.destroyed = true;
    this.importIntents?.destroy();
    this.pendingTopic = null;
    let complete;
    this.shutdownPromise = new Promise((resolve) => {
      complete = resolve;
    });
    const operations = [
      () => this.window?.removeEventListener('beforeunload', this.onBeforeUnload),
      () => this.playback?.destroy(),
      () => this.releaseEventErrors?.(),
      () => this.showcase?.destroy(),
      () => this.ui?.destroy(),
      () => this.dance?.destroy(),
      () => this.knowledge?.destroy(),
      () => this.repository?.flush(),
      () => this.audio?.destroy(),
      () => {
        const releases = [];
        for (const provider of this.ownedProviders.splice(0)) {
          if (this.registry.get(provider.id) !== provider) continue;
          this.registry.unregister(provider.id);
          try {
            releases.push(Promise.resolve(provider.dispose?.()));
          } catch (error) {
            releases.push(Promise.reject(error));
          }
        }
        return Promise.allSettled(releases).then((results) => {
          const failures = results.filter((result) => result.status === 'rejected');
          if (failures.length)
            throw new AggregateError(
              failures.map((result) => result.reason),
              'Provider cleanup failed.',
            );
        });
      },
    ];
    // Invoke synchronous releases immediately; settle every asynchronous release,
    // even if a previous cleanup throws or AudioContext.close() rejects.
    const pending = operations.map((release) => {
      try {
        return Promise.resolve(release());
      } catch (error) {
        return Promise.reject(error);
      }
    });
    Promise.allSettled(pending).then((results) => {
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length)
        console.error(
          'Application resource cleanup failed.',
          failures.map((result) => result.reason),
        );
      complete(failures.length === 0);
    });
    return this.shutdownPromise;
  }
}
