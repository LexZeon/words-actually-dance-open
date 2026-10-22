import { onsetAgeSeconds, onsetEnvelope, onsetPriority } from './onset-priority.js';

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const neutral = () => ({ y: 0, scaleY: 1, focusScale: 1, brightness: 1, envelope: 0, kind: null, weight: 0 });

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
    const track = ['pop', 'flash'].includes(effect) ? current?.spotlight : current?.track;
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
    const reducedMotion = Boolean(
      host.ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    );
    this.pose = this.sample(time, { reducedMotion });
    this.pose.y = clamp(this.pose.y, -this.travel, this.travel);
    const focus = current?.featuredMarker?.els || (current?.featuredKeyword ? [current.featuredKeyword] : []);
    if (focus.length !== this.focus.length || focus.some((node, index) => node !== this.focus[index].node)) {
      this.restoreFocus();
      this.focus = focus
        .filter((node) => node?.style)
        .map((node) => ({ node, scale: node.style.scale || '' }));
    }
    for (const { node } of this.focus) node.style.scale = String(this.pose.focusScale);
    if (!track) return;
    // Individual transforms compose with the existing effect; compression
    // cannot expand the line or change keyword-to-body spacing.
    track.style.translate = `0px ${this.pose.y.toFixed(4)}px`;
    track.style.scale = `1 ${this.pose.scaleY.toFixed(5)}`;
    track.style.filter = `brightness(${this.pose.brightness.toFixed(5)})`;
  }

  measure(host) {
    const box = this.track?.getBoundingClientRect?.();
    const stage = host?.getBoundingClientRect?.();
    this.travel =
      box && stage ? clamp(Math.min(box.top - stage.top, stage.bottom - box.bottom) - 4, 0, 6) : 4;
  }

  restore() {
    if (this.track && this.previousStyle) Object.assign(this.track.style, this.previousStyle);
    this.restoreFocus();
    this.track = null;
    this.previousStyle = null;
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
      maxTravelPx: this.travel,
    };
  }
}
