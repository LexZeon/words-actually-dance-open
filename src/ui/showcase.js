import { EVENTS } from '../core/events.js';
import { translate } from '../core/i18n.js';

/** Optional player chrome. All timing and audio commands stay in the shared app. */
export function mountShowcase({ app, documentRef = globalThis.document } = {}) {
  const get = (id) => documentRef?.getElementById(id);
  const text = (message) => translate(app.state?.preferences?.language, message);
  const recall = get('recall-button');
  if (typeof recall?.addEventListener !== 'function') return null;
  const abort = new AbortController();
  const releases = [];
  const welcome = get('showcase-welcome');
  const cover = get('recall-cover');
  const answer = get('recall-answer');
  const stage = get('knowledge-stage');
  const accessible = get('knowledge-accessible');
  let destroyed = false;
  let recalling = false;
  let busy = false;
  let generation = 0;
  let previousVisibility = null;

  const listen = (id, callback) => get(id)?.addEventListener('click', callback, { signal: abort.signal });
  const subscribe = (type, callback) => {
    const release = app.bus?.on(type, callback);
    if (typeof release === 'function') releases.push(release);
  };
  function revealAnswer({ focus = false } = {}) {
    generation++;
    recalling = false;
    if (cover) cover.hidden = true;
    recall.setAttribute('aria-pressed', 'false');
    recall.setAttribute('aria-label', text('暂停并回想这一句'));
    if (previousVisibility) {
      if (previousVisibility.aria === null) stage?.removeAttribute('aria-hidden');
      else stage?.setAttribute('aria-hidden', previousVisibility.aria);
      if (stage) {
        stage.inert = previousVisibility.inert;
        stage.removeAttribute('data-recall-hidden');
      }
      if (accessible) accessible.hidden = previousVisibility.accessibleHidden;
      previousVisibility = null;
    }
    if (focus && !destroyed) recall.focus({ preventScroll: true });
  }
  async function beginRecall() {
    if (destroyed || app.destroyed || busy || app.ui?.ready === false) return false;
    if (recalling) {
      revealAnswer({ focus: true });
      return true;
    }
    if (app.audioPending > 0) {
      app.ui?.toast('音乐正在切换，请稍后再回想。');
      return false;
    }
    const request = ++generation;
    busy = true;
    recall.disabled = true;
    recall.setAttribute('aria-busy', 'true');
    // Freeze the unified clock now; the existing audio queue owns suspension.
    try {
      app.setPlaying(false);
      const paused = await app.queueAudio(async () => {
        if (destroyed || app.destroyed || request !== generation) return false;
        app.setPlaying(false);
        return app.audio.mode ? app.audio.setPaused(true) : true;
      });
      if (destroyed || app.destroyed || request !== generation) return false;
      if (paused === false) {
        app.ui?.toast('音乐暂时未能暂停，请再试一次。');
        return false;
      }
      previousVisibility = {
        aria: stage?.getAttribute('aria-hidden') ?? null,
        inert: Boolean(stage?.inert),
        accessibleHidden: Boolean(accessible?.hidden),
      };
      if (stage) {
        stage.setAttribute('data-recall-hidden', 'true');
        stage.setAttribute('aria-hidden', 'true');
        stage.inert = true;
      }
      if (accessible) accessible.hidden = true;
      recalling = true;
      if (cover) cover.hidden = false;
      recall.setAttribute('aria-pressed', 'true');
      recall.setAttribute('aria-label', text('结束回想并查看答案'));
      answer?.focus({ preventScroll: true });
      app.bus?.emit(EVENTS.INTERACTION, { kind: 'recall', target: 'current-line' });
      return true;
    } catch (error) {
      if (!destroyed) app.ui?.toast(error?.message || '暂时无法暂停，请先按暂停再回想。');
      return false;
    } finally {
      busy = false;
      if (!destroyed) {
        recall.disabled = false;
        recall.removeAttribute('aria-busy');
      }
    }
  }
  function openLearning() {
    if (!destroyed) app.ui.openPanel('learning-dialog');
  }
  function updateProgress(index = 0, complete = false) {
    const total = app.activeTopic?.lines?.length || 1;
    const progress = Math.min(1, Math.max(0, complete ? 1 : Number(index) / total || 0));
    const fill = get('session-progress-fill');
    if (fill) fill.style.width = `${progress * 100}%`;
  }
  function renderLanguage() {
    const caption = get('play-caption');
    if (caption) caption.textContent = text(app.state?.playing ? '暂停' : '播放');
    const label = get('welcome-play-label');
    if (label)
      label.textContent = text(app.audio.mode && app.audio.mode !== 'demo' ? '开始播放' : '开始试听');
    recall.setAttribute('aria-label', text(recalling ? '结束回想并查看答案' : '暂停并回想这一句'));
  }

  listen('recall-button', () => void beginRecall());
  listen('recall-answer', () => revealAnswer({ focus: true }));
  listen('welcome-music', () => app.ui.openPanel('source-dialog'));
  listen('welcome-content', () => app.ui.openPanel('content-dialog'));
  listen('welcome-play', () => get('play-button')?.click());
  listen('welcome-dismiss', () => {
    if (welcome) welcome.hidden = true;
  });
  listen('learning-button', openLearning);
  listen('show-welcome-button', () => {
    app.ui.closePanel('learning-dialog');
    if (welcome) welcome.hidden = false;
    get('welcome-music')?.focus({ preventScroll: true });
  });
  documentRef.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !recalling || documentRef.querySelector('dialog[open]')) return;
      event.preventDefault();
      revealAnswer({ focus: true });
    },
    { signal: abort.signal },
  );
  subscribe(EVENTS.PLAYBACK_CHANGED, ({ playing }) => {
    const caption = get('play-caption');
    if (caption) caption.textContent = text(playing ? '暂停' : '播放');
    if (playing) {
      revealAnswer();
      if (welcome) welcome.hidden = true;
    }
  });
  subscribe(EVENTS.LINE_ENTER, ({ index }) => {
    revealAnswer();
    updateProgress(index);
  });
  subscribe(EVENTS.CONTENT_LOADED, () => {
    revealAnswer();
    updateProgress();
    renderLanguage();
  });
  subscribe(EVENTS.CONTENT_COMPLETE, () => updateProgress(0, true));
  subscribe(EVENTS.AUDIO_SOURCE_CHANGED, ({ mode }) => {
    revealAnswer();
    const label = get('welcome-play-label');
    if (label) label.textContent = text(mode && mode !== 'demo' ? '开始播放' : '开始试听');
  });
  subscribe(EVENTS.PREFERENCE_CHANGED, ({ key }) => {
    if (key === 'language') {
      revealAnswer();
      renderLanguage();
    }
  });
  renderLanguage();
  return {
    beginRecall,
    revealAnswer,
    openLearning,
    getState: () => ({ recalling, busy, welcomeVisible: Boolean(welcome && !welcome.hidden) }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      revealAnswer();
      abort.abort();
      releases.splice(0).forEach((release) => release());
    },
  };
}
