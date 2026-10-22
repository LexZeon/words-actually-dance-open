import { directKnowledgeScene, findKnowledgeMarkers } from './knowledge-director.js';
import { phraseEnvelope, inkHeadlineFit } from './knowledge-spacing.js';
import { directKnowledgeEmphasis } from './knowledge-emphasis.js';
import { splitGraphemes as split } from '../content/text-boundaries.js';
import { QuarterTurnText } from './quarter-turn-text.js';
import { TextFlow } from './text-flow.js';
import { selectKnowledgeEffect, usesDirectedKnowledgeLayout } from './knowledge-effect-selector.js';
import { EFFECTS as EFFECT_CATALOG } from './effect-catalog.js';
import { createKnowledgeLine, refreshKnowledgeLine } from './knowledge-line.js';
import { KnowledgeDrumResponse } from './knowledge-drum-response.js';

const EFFECTS = new Set(EFFECT_CATALOG.filter(({ implemented }) => implemented).map(({ id }) => id));
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

/** Knowledge has one clock: every visible reveal and navigation starts on a music tick. */
export class KnowledgeStage {
  constructor(el, { onKeyword = () => {}, onLine = () => {}, onComplete = () => {} } = {}) {
    if (!el?.ownerDocument) throw new TypeError('KnowledgeStage requires a DOM element.');
    this.el = el;
    this.document = el.ownerDocument;
    this.onKeyword = onKeyword;
    this.onLine = onLine;
    this.onComplete = onComplete;
    this.effect = 'stack';
    this.manualEffect = 'stack';
    this.autoDirection = true;
    this.presentation = 'scene';
    this.autoEffectIndex = 0;
    this.previousAutoEffect = null;
    this.lastAutoPrevious = null;
    this.pendingAutoDirection = null;
    this.pendingDirection = false;
    this.scene = null;
    this.inkLayout = null;
    this.pendingEffect = null;
    this.rate = 2;
    this.playbackRate = this.rate;
    this.musicFeatures = {};
    this.drumResponse = new KnowledgeDrumResponse();
    this.paused = false;
    this.topic = { lines: [] };
    this.lines = [];
    this.history = [];
    this.current = null;
    this.quarterTurn = new QuarterTurnText(el);
    this.textFlow = new TextFlow(el);
    this.revealAfterTick = null;
    this.keyword = '';
    this.lineIndex = 0;
    this.cursor = 0;
    this.finished = false;
    this.pendingStep = null;
    this.completeAtBeat = null;
    this.lastTick = null;
    this.destroyed = false;
    el.classList.add('knowledge-stage');
    el.dataset.effect = this.effect;
    el.dataset.autoDirection = 'true';
    el.dataset.presentation = 'scene';
    el.dataset.layout = 'manual';
    el.dataset.paused = 'false';
    const Resize = this.document.defaultView?.ResizeObserver;
    this.resizeFrame = null;
    if (Resize) {
      this.resizeObserver = new Resize(() => {
        if (this.destroyed) return;
        const view = this.document.defaultView;
        // One pending read/write pass also handles a burst of observer notifications.
        if (this.resizeFrame !== null) return;
        this.resizeFrame = view.requestAnimationFrame(() => {
          this.resizeFrame = null;
          if (this.destroyed) return;
          this.layoutCurrent();
          this.positionHistory();
        });
      });
      this.resizeObserver.observe(el);
    }
  }

  setScript(topic, { initialKeyword = '' } = {}) {
    this.drumResponse.clear();
    this.quarterTurn.clear();
    this.textFlow.clear();
    this.revealAfterTick = null;
    this.autoEffectIndex = 0;
    this.previousAutoEffect = null;
    this.lastAutoPrevious = null;
    this.topic = topic && typeof topic === 'object' ? topic : { lines: [] };
    this.lines = Array.isArray(this.topic.lines)
      ? this.topic.lines
          .filter((line) => line && typeof line.text === 'string')
          .map((line) => ({
            ...line,
            text: line.text,
            keyword: typeof line.keyword === 'string' ? line.keyword : '',
            chars: split(line.text),
            holdBeats: clamp(Math.round(Number(line.holdBeats) || 8), 1, 32),
            markers: findKnowledgeMarkers(line),
          }))
      : [];
    this.el.replaceChildren();
    this.history = [];
    this.current = null;
    this.lineIndex = 0;
    this.cursor = 0;
    this.keyword = typeof initialKeyword === 'string' ? initialKeyword : '';
    this.finished = this.lines.length === 0;
    this.pendingStep = null;
    this.completeAtBeat = null;
    this.lastTick = null;
    this.scene = null;
    this.inkLayout = null;
    return this.getState();
  }

  setAutoDirection(value) {
    const next = Boolean(value);
    this.pendingAutoDirection = next === this.autoDirection ? null : next;
    this.pendingDirection = this.pendingAutoDirection !== null;
    return next;
  }

  setEffect(id) {
    if (!EFFECTS.has(id)) return false;
    if (id === this.manualEffect) return true;
    // Existing characters must not acquire a new entry animation between beats.
    this.pendingEffect = id;
    this.manualEffect = id;
    return true;
  }

  setRate(charsPerBeat) {
    this.rate = clamp(Math.round(Number(charsPerBeat) || 2), 1, 4);
    this.playbackRate = this.rate;
  }

  setFeatures(features = {}) {
    if (this.destroyed) return;
    this.musicFeatures = features;
    this.drumResponse.update(features, { paused: this.paused });
  }

  setPaused(value) {
    this.paused = Boolean(value);
    this.el.dataset.paused = String(this.paused);
  }

  requestStep(delta) {
    if (!this.lines.length || !Number.isFinite(delta) || delta === 0) return;
    this.pendingStep = clamp(
      (this.pendingStep || 0) + Math.trunc(delta),
      -this.lines.length,
      this.lines.length,
    );
  }

  onTick(event, features = {}) {
    if (this.destroyed || this.paused || !this.lines.length || !event) return;
    const subdivision = Number(event.subdivisionIndex);
    if (!Number.isInteger(subdivision) || subdivision < 0 || subdivision > 3) return;
    if (event.kind !== 'beat' && event.kind !== 'subdivision') return;
    if (!Number.isSafeInteger(event.beatIndex) || event.beatIndex < 0) return;
    if ((event.kind === 'beat') !== (subdivision === 0)) return;
    const identity = event.beatIndex * 4 + subdivision;
    if (this.lastTick !== null && identity <= this.lastTick) return;
    this.lastTick = identity;
    const beat = event.kind === 'beat' && subdivision === 0;
    const bpm = Number(event.bpm) || Number(features.bpm) || 120;
    if (beat) {
      const multiplier = Number(this.musicFeatures.delivery?.readingMultiplier) || 1;
      const drive = Number.isFinite(this.musicFeatures.delivery?.drive)
        ? this.musicFeatures.delivery.drive
        : clamp((multiplier - 1) / 0.75, 0, 1);
      const urgency = clamp((drive - 0.45) / 0.55, 0, 1);
      const readingLimit = Math.max(1, Math.floor((7.5 * 60) / bpm));
      this.playbackRate = clamp(
        this.rate + Math.round(this.rate * 0.75 * urgency),
        1,
        Math.min(4, readingLimit),
      );
    }
    const duration = clamp(60 / bpm, 0.2, 2);
    this.el.style.setProperty('--beat-duration', `${duration}s`);
    this.el.style.setProperty(
      '--char-duration',
      `${clamp((duration * 0.85) / this.playbackRate, 0.12, 0.65)}s`,
    );

    if (this.pendingAutoDirection !== null) {
      this.autoDirection = this.pendingAutoDirection;
      this.pendingAutoDirection = null;
      this.el.dataset.autoDirection = String(this.autoDirection);
    }
    if (this.pendingEffect) {
      if (!this.autoDirection) {
        this.clearTransientClasses();
        this.effect = this.pendingEffect;
        this.el.dataset.effect = this.effect;
        if (this.current) this.layoutCurrent();
      }
      this.pendingEffect = null;
    }
    if (this.pendingDirection && this.current) {
      this.pendingDirection = false;
      this.applyDirection(this.lines[this.lineIndex], { refresh: true });
    }
    if (beat && this.pendingStep !== null) {
      const target = clamp(this.lineIndex + this.pendingStep, 0, this.lines.length - 1);
      this.pendingStep = null;
      this.mount(target);
    }
    if (!this.current) this.mount(this.lineIndex);
    if (this.current.chars.length === 0 && this.completeAtBeat === null)
      this.completeAtBeat = event.beatIndex;

    if (
      beat &&
      this.completeAtBeat !== null &&
      !this.finished &&
      event.beatIndex - this.completeAtBeat >= this.lines[this.lineIndex].holdBeats
    ) {
      if (this.lineIndex < this.lines.length - 1) this.mount(this.lineIndex + 1);
      else {
        this.finished = true;
        this.onComplete();
      }
    }

    const slots = Array.from({ length: this.playbackRate }, (_, index) =>
      Math.round((index * 4) / this.playbackRate),
    );
    if (
      !this.finished &&
      slots.includes(subdivision) &&
      this.cursor < this.current.chars.length &&
      (this.revealAfterTick === null || identity >= this.revealAfterTick)
    ) {
      this.reveal(duration);
      if (this.cursor === this.current.chars.length) this.completeAtBeat = event.beatIndex;
    }
    if (beat) {
      this.pulseKeywords();
      if (this.effect === 'barrage') {
        const progress = this.cursor / Math.max(1, this.current.chars.length);
        this.el.style.setProperty('--barrage-offset', `${Math.round((0.5 - progress) * 160)}px`);
      }
      if (this.effect === 'wave') this.pulseWave();
    }
  }

  mount(index) {
    const previousExit = this.scene?.exit || 'slide';
    const line = this.lines[index];
    this.applyDirection(line, { index });
    const turning = ['quarter-turn', 'waterfall-flow'].includes(this.effect);
    if (this.current) {
      const previous = this.current.el;
      previous.classList.remove('current', 'arriving');
      previous.classList.add('history');
      previous.classList.add('just-retired');
      previous.dataset.exit = previousExit;
      previous.removeAttribute('aria-label');
      previous.setAttribute('aria-hidden', 'true');
      for (const node of previous.querySelectorAll(
        '.new,.active,.hit,.wave-hit,.emphasis-current,.emphasis-settled',
      ))
        node.classList.remove('new', 'active', 'hit', 'wave-hit', 'emphasis-current', 'emphasis-settled');
      this.history.unshift(previous);
      while (this.history.length > 4) this.history.pop().remove();
      if (!turning)
        this.history.forEach((node, age) => {
          const upper = age < 2;
          const height = this.el.clientHeight || 200;
          const top = upper ? age * 22 : height - 42 + (age - 2) * 22;
          node.classList.toggle('deep', age > 1);
          if (age > 0) node.classList.remove('just-retired');
          node.style.top = `${top}px`;
          node.style.transform = `rotateX(${upper ? 18 : -18}deg)`;
          node.style.opacity = String(0.36 - age * 0.055);
          node.style.setProperty('--history-from-y', `${height / 2 - top - 10}px`);
          node.style.setProperty('--history-angle', `${upper ? 18 : -18}deg`);
          node.style.setProperty('--history-opacity', String(0.36 - age * 0.055));
          node.style.filter = 'none';
        });
    }

    this.lineIndex = index;
    this.cursor = 0;
    this.completeAtBeat = null;
    this.finished = false;
    this.positionHistory();
    this.current = createKnowledgeLine(this.document, line, {
      scene: this.scene,
      presentation: this.presentation,
    });
    this.el.append(this.current.el);
    this.directEmphasis(line);
    this.el.style.setProperty('--barrage-offset', '80px');
    this.revealAfterTick = turning && this.history.length ? (this.lastTick ?? 0) + 4 : null;
    this.layoutCurrent({ turn: turning && this.history.length > 0 });
    this.onLine(index, line);
  }

  applyDirection(line, { refresh = false, index = this.lineIndex } = {}) {
    const from = this.keyword || this.topic.keyword || line.keyword;
    const relation =
      (Array.isArray(this.topic.relations)
        ? this.topic.relations.find((entry) => entry.from === from && entry.to === line.keyword)
        : null) || {};
    this.scene = directKnowledgeScene({
      line,
      index,
      lineCount: this.lines.length,
      relation,
    });
    if (this.autoDirection) {
      this.effect = selectKnowledgeEffect({
        scene: this.scene,
        line,
        index: Math.max(0, this.autoEffectIndex - (refresh ? 1 : 0)),
        lineCount: this.lines.length,
        previousEffect: refresh ? this.lastAutoPrevious : this.previousAutoEffect,
      });
      if (!refresh) {
        this.lastAutoPrevious = this.previousAutoEffect;
        this.autoEffectIndex++;
        this.previousAutoEffect = this.effect;
      }
      this.presentation = usesDirectedKnowledgeLayout(this.scene, this.effect) ? 'scene' : 'effect';
      this.el.dataset.layout = this.presentation === 'scene' ? this.scene.layout : 'automatic-effects';
      this.el.dataset.entrance = this.scene.entrance;
      this.el.dataset.sentenceType = this.scene.sentenceType || '';
      this.el.dataset.directionSource = this.scene.directionSource;
      this.el.style.setProperty('--scene-font', `${this.scene.typography.fontPx}px`);
      this.el.style.setProperty('--scene-line-height', String(this.scene.typography.lineHeight));
      this.el.style.setProperty('--scene-weight', String(this.scene.typography.weight));
    } else {
      this.effect = this.manualEffect;
      this.presentation = 'effect';
      this.el.dataset.layout = 'manual';
      this.el.dataset.entrance = 'lift';
      this.el.dataset.sentenceType = '';
      this.el.dataset.directionSource = 'manual';
      this.el.style.setProperty('--scene-font', '27px');
      this.el.style.setProperty('--scene-line-height', '1.5');
      this.el.style.setProperty('--scene-weight', '400');
    }
    this.el.dataset.effect = this.effect;
    this.el.dataset.presentation = this.presentation;
    this.pendingDirection = false;
    if (refresh && this.current) this.refreshScene(line);
  }

  refreshScene(line) {
    const current = this.current;
    refreshKnowledgeLine(current, { scene: this.scene, presentation: this.presentation });
    if (this.presentation === 'scene' && this.scene.layout === 'ink') {
      const last = current.keywords.filter((marker) => current.firedRanges.has(marker.key)).at(-1);
      if (last) this.updateInkKeyword(last.text);
    }
    this.positionHistory();
    this.directEmphasis(line);
    this.layoutCurrent();
  }

  directEmphasis(line) {
    if (!this.current) return;
    for (const [index, marker] of this.current.keywords.entries())
      marker.emphasis =
        this.presentation === 'scene'
          ? directKnowledgeEmphasis({ scene: this.scene, marker, primaryKeyword: line.keyword, index })
          : null;
    this.current.groups.forEach((group) => {
      group.el.classList.remove('emphasis-current', 'emphasis-settled');
      if (!group.keyword || this.presentation !== 'scene') {
        delete group.el.dataset.emphasis;
        delete group.el.dataset.role;
        group.emphasis = null;
        group.envelopes = [];
        return;
      }
      const markers = this.current.keywords.filter((marker) => marker.els.includes(group.el));
      const marker =
        markers.find((entry) => entry.role === 'primary') ||
        markers.find((entry) => entry.text === line.keyword) ||
        markers[0];
      // Shared glyphs can take either logical word's emphasis; reserve the union once.
      group.envelopes = markers.map((entry) => entry.emphasis.envelope);
      this.applyGroupEmphasis(group, marker?.emphasis);
    });
    if (this.presentation === 'scene' && this.current.firedRanges.size) this.pulseKeywords();
  }

  applyGroupEmphasis(group, emphasis) {
    if (!emphasis) return;
    group.emphasis = emphasis;
    group.el.dataset.emphasis = emphasis.variant;
    group.el.dataset.role = emphasis.role;
    group.el.style.setProperty('--emphasis-scale', String(emphasis.peakScale));
    group.el.style.setProperty('--emphasis-direction', String(emphasis.direction));
  }

  layoutCurrent({ turn = false } = {}) {
    if (this.destroyed || !this.current) return;
    const current = this.current;
    this.drumResponse.restore();
    const view = this.document.defaultView;
    const ink = this.presentation === 'scene' && this.scene?.layout === 'ink';
    const quarter = this.effect === 'quarter-turn';
    const flow = this.effect === 'waterfall-flow';
    if (!flow && this.textFlow.state) {
      this.textFlow.clear();
      this.revealAfterTick = null;
      this.positionHistory();
    }
    if (!quarter && this.quarterTurn.plan) {
      this.quarterTurn.clear();
      this.revealAfterTick = null;
      this.positionHistory();
    }
    if (quarter)
      this.el.style.setProperty('--quarter-reading-width', `${(this.el.clientWidth || 900) * 0.7}px`);
    if (flow && this.textFlow.has(current.el)) {
      this.textFlow.layout(current.el, this.history);
      this.drumResponse.frame(current, this.el, this.musicFeatures.time, this.effect);
      return;
    }
    if (flow) this.el.style.setProperty('--flow-reading-width', `${(this.el.clientWidth || 900) * 0.66}px`);
    if (!ink) this.inkLayout = null;
    current.el.style.fontSize = '';
    const computedFont = parseFloat(view?.getComputedStyle(current.el).fontSize);
    let fontPx = ink
      ? 27
      : computedFont || (this.presentation === 'scene' ? this.scene.typography.fontPx : 27);
    const height = this.el.clientHeight || 200;
    const budget = flow
      ? Math.max(80, height * 0.8)
      : quarter
        ? Math.max(80, height * 0.58)
        : ink
          ? Math.max(80, height - 58)
          : Math.max(80, height - 4);
    const layout = this.presentation === 'scene' ? this.scene.layout : 'manual';
    const focusScale =
      layout === 'spotlight' ? 1.12 : layout === 'diagonal' ? 1.06 : layout === 'steps' ? 1.05 : 1;
    // offsetWidth excludes transforms and margins. Active emphasis never changes this width.
    const reserve = () => {
      current.el.style.fontSize = `${fontPx}px`;
      // Flush the font change once, then read all widths before writing any lanes.
      const measured = current.groups.map((group) => ({
        group,
        width: group.el.offsetWidth || (group.end - group.start) * fontPx,
        available:
          group.el.parentElement?.clientWidth || current.track.clientWidth || this.el.clientWidth || 900,
      }));
      let widthRatio = 1;
      for (const { group, width, available } of measured) {
        const candidates = group.envelopes?.length ? group.envelopes : [null];
        const envelopes = candidates.map((candidate) =>
          phraseEnvelope({
            width,
            fontPx,
            keyword: group.keyword,
            marker: candidate ? candidate.marker : this.effect === 'marker',
            karaoke: this.effect === 'karaoke',
            focusScale,
            angle: Math.max(layout === 'diagonal' ? 2 : 0, candidate?.angle || 0),
            decorationPx: candidate?.decorationPx || 0,
            shiftX: candidate?.shiftX || 0,
            shiftY: candidate?.shiftY || 0,
          }),
        );
        const envelope = {
          x: Math.max(...envelopes.map(({ x }) => x)),
          y: Math.max(...envelopes.map(({ y }) => y)),
        };
        group.el.style.setProperty('--phrase-reserve-x', `${envelope.x}px`);
        group.el.style.setProperty('--phrase-reserve-y', `${envelope.y}px`);
        widthRatio = Math.max(widthRatio, (width + envelope.x * 2) / available);
      }
      return widthRatio;
    };
    let widthRatio = reserve();
    // Unread glyphs already occupy flow, so this does not move text as it is revealed.
    for (let attempt = 0; attempt < 8 && fontPx > 18; attempt++) {
      const heightRatio = (current.track.offsetHeight || 0) / budget;
      const overflow = Math.max(heightRatio, widthRatio);
      if (overflow <= 1) break;
      fontPx = Math.max(18, Math.min(fontPx - 1, Math.floor(fontPx / overflow)));
      widthRatio = reserve();
    }
    if (this.presentation !== 'scene')
      current.el.style.top = `${Math.max(0, (height - (current.track.offsetHeight || fontPx)) / 2)}px`;
    else current.el.style.top = '';
    if (ink && current.inkForeground?.textContent) this.fitInkHeadline();
    if (quarter)
      this.quarterTurn.layout(current.el, this.history, {
        startBeat: (this.lastTick ?? 0) / 4,
        animate: turn,
      });
    if (flow)
      this.textFlow.layout(current.el, this.history, {
        startBeat: (this.lastTick ?? 0) / 4,
        animate: turn,
      });
    this.drumResponse.frame(current, this.el, this.musicFeatures.time, this.effect);
  }

  frame(grid) {
    if (this.destroyed || this.paused) return;
    if (!Number.isFinite(grid?.beatIndex) || !Number.isFinite(grid?.phase)) return;
    if (this.effect === 'quarter-turn') this.quarterTurn.frame(grid.beatIndex + grid.phase);
    if (this.effect === 'waterfall-flow') this.textFlow.frame(grid.beatIndex + grid.phase);
    this.drumResponse.frame(this.current, this.el, grid.time, this.effect);
  }

  fitInkHeadline() {
    const { inkForeground, track, el } = this.current;
    if (!inkForeground) return;
    const width = this.el.clientWidth || 900;
    const desired = Math.min(120, (width * 0.66) / Math.max(1, split(inkForeground.textContent).length));
    el.style.setProperty('--ink-word-font', `${desired}px`);
    const fit = inkHeadlineFit({
      width: width - 32,
      stageHeight: this.el.clientHeight || 200,
      readingHeight: track.offsetHeight || 54,
      measuredWordWidth: inkForeground.offsetWidth || desired * split(inkForeground.textContent).length,
      fontPx: desired,
    });
    el.style.setProperty('--ink-word-font', `${fit.fontPx}px`);
    el.style.setProperty('--ink-center-y', `${fit.centerY}px`);
    this.inkLayout = fit;
  }

  destroy() {
    this.destroyed = true;
    this.drumResponse.clear();
    this.quarterTurn.clear();
    this.textFlow.clear();
    this.resizeObserver?.disconnect();
    if (this.resizeFrame !== null) this.document.defaultView?.cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = null;
    this.onKeyword = () => {};
    this.onLine = () => {};
    this.onComplete = () => {};
  }

  positionHistory() {
    if (['quarter-turn', 'waterfall-flow'].includes(this.effect)) return;
    const ink = this.presentation === 'scene' && this.scene?.layout === 'ink';
    const height = this.el.clientHeight || 200;
    this.history.forEach((node, age) => {
      const upper = ink || age < 2;
      const top = ink ? age * 22 : upper ? age * 22 : height - 42 + (age - 2) * 22;
      node.style.top = `${top}px`;
      node.style.left = '0px';
      node.style.right = ink ? 'auto' : '0px';
      node.style.maxWidth = ink ? '130px' : '650px';
      node.style.setProperty('--history-from-y', `${height / 2 - top - 10}px`);
      node.style.setProperty('--history-angle', `${upper ? 18 : -18}deg`);
    });
  }

  reveal(duration) {
    this.clearTransientClasses();
    const character = this.current.chars[this.cursor];
    this.cursor++;
    character.el.classList.remove('unread');
    character.el.classList.add('read', 'new');
    this.current.groups.forEach((group) => group.el.classList.toggle('focus', group === character.group));
    const group = character.group;
    const fragment = this.lines[this.lineIndex].chars
      .slice(group.start, Math.min(group.end, this.cursor))
      .join('');
    if (!/^[\p{P}\p{Z}\p{C}]*$/u.test(fragment)) {
      this.current.spotlight.textContent = fragment;
      this.current.spotlight.classList.toggle('keyword-focus', group.keyword && this.cursor >= group.end);
    }
    if (this.effect === 'pop' || this.effect === 'flash') void this.current.spotlight.offsetWidth;
    this.current.spotlight.classList.add('hit');
    let newKeyword = false;
    for (const marker of this.current.keywords) {
      if (this.cursor < marker.end) continue;
      marker.els.forEach((el) => el.classList.add('active'));
      if (this.current.firedRanges.has(marker.key)) continue;
      this.current.firedRanges.add(marker.key);
      this.current.featuredKeyword = marker.el;
      this.current.featuredMarker = marker;
      newKeyword = true;
      const keyword = marker.text;
      const from = this.keyword || this.topic.keyword || keyword;
      const relation = (marker.relation?.from === from ? marker.relation : null) ||
        (Array.isArray(this.topic.relations)
          ? this.topic.relations.find((entry) => entry.from === from && entry.to === keyword)
          : null) || {
          from,
          to: keyword,
          type: from === keyword ? 'focus' : 'context',
          label: from === keyword ? '当前概念' : '概念连接',
        };
      this.keyword = keyword;
      this.updateInkKeyword(keyword);
      this.onKeyword(keyword, { ...relation, from, to: keyword }, duration);
    }
    if (newKeyword && this.presentation === 'scene') this.pulseKeywords();
  }

  clearTransientClasses() {
    if (!this.current) return;
    for (const node of this.current.el.querySelectorAll('.new,.hit')) node.classList.remove('new', 'hit');
  }

  updateInkKeyword(keyword) {
    if (!this.current.inkForeground) return;
    this.current.inkForeground.textContent = keyword;
    this.current.inkGhost.textContent = keyword;
    this.fitInkHeadline();
    this.current.inkForeground.classList.remove('ink-hit');
    this.current.inkGhost.classList.remove('ink-hit');
    void this.current.inkForeground.offsetWidth;
    this.current.inkForeground.classList.add('ink-hit');
    this.current.inkGhost.classList.add('ink-hit');
  }

  pulseKeywords() {
    if (!this.current) return;
    const completed = this.current.keywords.filter((marker) => this.cursor >= marker.end);
    const visible = [...new Set(completed.flatMap((marker) => marker.els))];
    if (!visible.length) return;
    if (this.presentation === 'scene') {
      const featured = this.current.featuredKeyword || visible.at(-1);
      const marker = this.current.featuredMarker;
      // A dev peak probe may select an individual segment; production selects a range.
      const featuredEls = marker?.el === featured ? marker.els : [featured];
      for (const group of visible) {
        group.classList.remove('emphasis-current');
        group.classList.add('active');
        group.classList.toggle('emphasis-settled', !featuredEls.includes(group));
        const logical =
          featuredEls.includes(group) && marker?.el === featured
            ? marker
            : completed.filter((entry) => entry.els.includes(group)).at(-1);
        const record = this.current.groups.find((entry) => entry.el === group);
        if (record) this.applyGroupEmphasis(record, logical?.emphasis);
      }
      void this.current.el.offsetWidth;
      featuredEls.forEach((el) => el.classList.add('emphasis-current'));
      return;
    }
    visible.forEach((group) => group.classList.remove('active'));
    // One layout read restarts all finite keyword interpolations at this music beat.
    void this.current.el.offsetWidth;
    visible.forEach((group) => group.classList.add('active'));
  }

  pulseWave() {
    const visible = [];
    for (let index = Math.max(0, this.cursor - 12); index < this.cursor; index++) {
      const char = this.current.chars[index].el;
      char.classList.remove('wave-hit');
      visible.push(char);
    }
    if (!visible.length) return;
    void this.current.el.offsetWidth;
    visible.forEach((char) => char.classList.add('wave-hit'));
  }

  getState() {
    return {
      lineIndex: this.lineIndex,
      cursor: this.cursor,
      lineCount: this.lines.length,
      keyword: this.keyword,
      finished: this.finished,
      historyCount: this.history.length,
      effect: !this.autoDirection && this.pendingEffect ? this.pendingEffect : this.effect,
      paused: this.paused,
      charsPerBeat: this.rate,
      effectiveCharsPerBeat: this.playbackRate,
      delivery: this.musicFeatures.delivery ? { ...this.musicFeatures.delivery } : null,
      drum: this.drumResponse.getState(),
      pendingStep: this.pendingStep,
      holdBeats: this.lines[this.lineIndex]?.holdBeats || 0,
      autoDirection: this.autoDirection,
      presentation: this.presentation,
      autoEffectIndex: this.autoEffectIndex,
      layout: this.el.dataset.layout || null,
      keywordsSeen: this.current?.firedRanges.size || 0,
      emphasis:
        this.current?.keywords
          .filter((marker) => marker.emphasis)
          .map((marker) => ({
            text: marker.text,
            start: marker.start,
            end: marker.end,
            variant: marker.emphasis.variant,
            role: marker.emphasis.role,
            featured:
              this.current.featuredMarker === marker &&
              marker.els.some((el) => el.classList.contains('emphasis-current')),
          })) || [],
      scene: this.scene
        ? {
            layout: this.scene.layout,
            sentenceType: this.scene.sentenceType,
            directionSource: this.scene.directionSource,
            effect: this.scene.effect,
            entrance: this.scene.entrance,
            exit: this.scene.exit,
          }
        : null,
      quarterTurn: this.effect === 'quarter-turn' ? this.quarterTurn.getState() : null,
      textFlow: this.effect === 'waterfall-flow' ? this.textFlow.getState() : null,
    };
  }
}

export default KnowledgeStage;
