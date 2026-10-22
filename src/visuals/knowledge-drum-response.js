import { onsetAgeSeconds, onsetEnvelope, onsetPriority } from './onset-priority.js';

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const neutral = () => ({ y: 0, scaleY: 1, focusScale: 1, brightness: 1, envelope: 0, kind: null, weight: 0 });
const DRUM_BRIGHTNESS = '--wad-drum-brightness';

/** Finite reading accents sampled by the shared coordinator, without a timer.
 * Knowledge cursor/line progression still belongs exclusively to grid ticks.
 */
export class KnowledgeDrumResponse {
  constructor() {
    this.lastSequence = -1;
    this.sourceGeneration = null;
    this.command = null;
    this.bodyCommand = null;
    this.lastDrumTime = -Infinity;
    this.pausedAt = null;
    this.lastTime = 0;
    this.track = null;
    this.previousStyle = null;
    this.focus = [];
    this.presentation = null;
    this.spotlightText = null;
    this.spotlightFocusLimit = 1.13;
    this.animatedBrightness = null;
    this.pose = neutral();
    this.travel = 0;
  }

  update(features = {}, { paused = false } = {}) {
    const time = Number.isFinite(features.time) ? features.time : this.lastTime;
    if (features.sourceGeneration !== this.sourceGeneration) {
      this.sourceGeneration = features.sourceGeneration;
      this.command = null;
      this.bodyCommand = null;
      this.lastDrumTime = -Infinity;
      this.lastSequence = -1;
    }
    if (paused) {
      this.pausedAt ??= this.lastTime;
      if (features.drum?.hit) this.lastSequence = Math.max(this.lastSequence, features.drum.sequence || 0);
      return;
    }
    if (this.pausedAt !== null) {
      const gap = Math.max(0, time - this.pausedAt);
      if (this.command) this.command.started += gap;
      if (this.bodyCommand && this.bodyCommand !== this.command) this.bodyCommand.started += gap;
      if (Number.isFinite(this.lastDrumTime)) this.lastDrumTime += gap;
      this.pausedAt = null;
    }
    this.lastTime = time;
    const drum = features.drum;
    const fresh = Boolean(
      drum?.hit && Number.isSafeInteger(drum.sequence) && drum.sequence > this.lastSequence,
    );
    if (Number.isSafeInteger(drum?.sequence)) this.lastSequence = Math.max(this.lastSequence, drum.sequence);
    if (features.audioSilent || features.signalValid === 0) {
      this.command = null;
      this.bodyCommand = null;
      return;
    }
    if (
      !fresh ||
      !['thump', 'snap', 'tick'].includes(drum.kind) ||
      !(drum.confidence >= 0.2) ||
      !(drum.weight > 0)
    )
      return;
    const kind = drum.kind;
    const weight = clamp(Number(drum.weight) || 0);
    const started = time - onsetAgeSeconds(drum);
    this.lastDrumTime = started;
    this.command = {
      kind,
      weight,
      sequence: drum.sequence,
      started,
      duration: (kind === 'tick' ? 0.12 : 0.19) + weight * 0.12,
    };
    if (kind !== 'tick') this.bodyCommand = this.command;
  }

  sample(time = this.lastTime, { reducedMotion = false } = {}) {
    if (this.pausedAt !== null) time = this.pausedAt;
    const current = this.sampleCommand(this.command, time, reducedMotion);
    if (this.command?.kind !== 'tick' || this.bodyCommand === this.command) return current;
    const body = this.sampleCommand(this.bodyCommand, time, reducedMotion);
    if (!body.envelope) return current;
    return {
      ...body,
      focusScale: Math.max(body.focusScale, current.focusScale),
      envelope: Math.max(body.envelope, current.envelope),
      kind: current.envelope ? current.kind : body.kind,
      bodySequence: this.bodyCommand.sequence,
    };
  }

  sampleCommand(c, time, reducedMotion) {
    if (!c) return neutral();
    const age = Math.max(0, time - c.started);
    if (age >= c.duration) return neutral();
    const envelope = onsetEnvelope(age, c.duration);
    const strength = (0.12 + c.weight * 0.88) * envelope * (reducedMotion ? 0.12 : 1);
    const sign = c.kind === 'thump' ? 1 : -1;
    return {
      // Ticks stay local to a keyword; they never shake a complete sentence.
      y: c.kind === 'tick' ? 0 : sign * strength * (c.kind === 'snap' ? 4 : 5.5),
      scaleY: 1 - strength * (c.kind === 'thump' ? 0.075 : c.kind === 'snap' ? 0.032 : 0),
      focusScale: 1 + strength * (c.kind === 'tick' ? 0.018 : 0.13),
      brightness: 1 + strength * (c.kind === 'tick' ? 0 : 0.24),
      envelope,
      kind: c.kind,
      weight: c.weight,
    };
  }

  getPriority(time = this.lastTime) {
    return onsetPriority(this.lastDrumTime, this.pausedAt ?? time);
  }

  frame(current, host, time = this.lastTime, effect = '') {
    const spotlight = ['pop', 'flash'].includes(effect);
    const track = spotlight ? current?.spotlight : current?.track;
    if (track !== this.track) {
      this.restore();
      this.track = track || null;
      if (track) {
        this.previousStyle = {
          translate: track.style.translate || '',
          scale: track.style.scale || '',
          filter: track.style.filter || '',
        };
        this.measure(host);
      }
    }
    // The spotlight reuses one element as the typed fragment changes. Reserve
    // its real layout size again only on a text/track/layout change, not per frame.
    if (spotlight && track && this.spotlightText !== track.textContent) {
      this.spotlightText = track.textContent;
      this.measure(host);
    }
    const reducedMotion = Boolean(
      host.ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    );
    this.pose = this.sample(time, { reducedMotion });
    this.pose.y = clamp(this.pose.y, -this.travel, this.travel);
    // pop/flash make the reading track invisible. Its marker wrappers cannot
    // count as a visible emphasis target; the actual displayed fragment owns it.
    const focus = spotlight
      ? track
        ? [track]
        : []
      : current?.featuredMarker?.els || (current?.featuredKeyword ? [current.featuredKeyword] : []);
    if (focus.length !== this.focus.length || focus.some((node, index) => node !== this.focus[index].node)) {
      this.restoreFocus();
      this.focus = focus
        .filter((node) => node?.style)
        .map((node) => ({ node, scale: node.style.scale || '' }));
    }
    for (const { node } of this.focus) if (!spotlight) node.style.scale = String(this.pose.focusScale);
    if (!track) return;
    const focusScale = spotlight
      ? Math.min(this.pose.focusScale, this.spotlightFocusLimit)
      : this.pose.focusScale;
    const scaleX = spotlight ? focusScale : 1;
    const scaleY = this.pose.scaleY * (spotlight ? focusScale : 1);
    const animatedFilter =
      effect === 'flash' ||
      (!spotlight && host.dataset?.presentation === 'scene' && host.dataset?.entrance === 'zoom');
    if (animatedFilter) {
      if (!this.animatedBrightness)
        this.animatedBrightness = {
          node: track,
          value: track.style.getPropertyValue?.(DRUM_BRIGHTNESS) ?? track.style[DRUM_BRIGHTNESS] ?? '',
          priority: track.style.getPropertyPriority?.(DRUM_BRIGHTNESS) || '',
        };
      // Animation filter declarations outrank a normal inline filter. Feed
      // that same finite brightness into the original animated blur chain.
      this.setAnimatedBrightness(track, this.pose.brightness.toFixed(5));
    } else this.restoreAnimatedBrightness();
    // Individual transforms compose with the existing effect; compression
    // remains on the sentence, while spotlight focus is composed exactly once.
    track.style.translate = `0px ${this.pose.y.toFixed(4)}px`;
    track.style.scale = `${scaleX.toFixed(5)} ${scaleY.toFixed(5)}`;
    track.style.filter = `brightness(${this.pose.brightness.toFixed(5)})`;
    this.presentation = { target: spotlight ? 'spotlight' : 'reading-track', focusScale, scaleX, scaleY };
  }

  measure(host) {
    const box = this.track?.getBoundingClientRect?.();
    const stage = host?.getBoundingClientRect?.();
    this.travel =
      box && stage ? clamp(Math.min(box.top - stage.top, stage.bottom - box.bottom) - 4, 0, 6) : 4;
    this.spotlightFocusLimit = 1.13;
    if (box && stage) {
      const width = this.track.offsetWidth || box.width || box.right - box.left;
      const height = this.track.offsetHeight || box.height || box.bottom - box.top;
      const centerX = (box.left + box.right) / 2;
      const centerY = (box.top + box.bottom) / 2;
      // Both existing spotlight entrance keyframes peak at scale(1.08).
      // Do not add focus growth where its reserved viewport has no room.
      const x = ((Math.min(centerX - stage.left, stage.right - centerX) - 4) * 2) / (width * 1.08);
      const y = ((Math.min(centerY - stage.top, stage.bottom - centerY) - 4) * 2) / (height * 1.08);
      const limits = [x, y].filter(Number.isFinite);
      if (limits.length) this.spotlightFocusLimit = clamp(Math.min(...limits), 1, 1.13);
    }
  }

  restore() {
    if (this.track && this.previousStyle) Object.assign(this.track.style, this.previousStyle);
    this.restoreAnimatedBrightness();
    this.restoreFocus();
    this.track = null;
    this.previousStyle = null;
    this.presentation = null;
    this.spotlightText = null;
  }

  setAnimatedBrightness(node, value, priority = '') {
    if (node.style.setProperty) node.style.setProperty(DRUM_BRIGHTNESS, value, priority);
    else node.style[DRUM_BRIGHTNESS] = value;
  }

  restoreAnimatedBrightness() {
    const saved = this.animatedBrightness;
    if (!saved) return;
    if (saved.value) this.setAnimatedBrightness(saved.node, saved.value, saved.priority);
    else if (saved.node.style.removeProperty) saved.node.style.removeProperty(DRUM_BRIGHTNESS);
    else delete saved.node.style[DRUM_BRIGHTNESS];
    this.animatedBrightness = null;
  }

  restoreFocus() {
    for (const { node, scale } of this.focus) node.style.scale = scale;
    this.focus = [];
  }

  clear() {
    this.command = null;
    this.bodyCommand = null;
    this.lastDrumTime = -Infinity;
    this.pose = neutral();
    this.restore();
  }

  getState() {
    return {
      sequence: this.lastSequence,
      source: 'observed-drum',
      active: this.pose.envelope > 0,
      priority: this.getPriority(),
      pose: { ...this.pose },
      presentation: this.presentation ? { ...this.presentation } : null,
      maxTravelPx: this.travel,
    };
  }
}
