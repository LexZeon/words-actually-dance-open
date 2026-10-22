const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const ease = (value) => {
  const p = clamp(value);
  return p * p * (3 - 2 * p);
};
const neutral = () => ({ y: 0, scaleY: 1, brightness: 1, envelope: 0, kind: null, weight: 0 });

/** Finite reading accents sampled by the shared coordinator, without a timer.
 * Knowledge cursor/line progression still belongs exclusively to grid ticks.
 */
export class KnowledgeDrumResponse {
  constructor() {
    this.lastSequence = -1;
    this.sourceGeneration = null;
    this.command = null;
    this.pausedAt = null;
    this.lastTime = 0;
    this.track = null;
    this.previousStyle = null;
    this.pose = neutral();
    this.travel = 0;
  }

  update(features = {}, { paused = false } = {}) {
    const time = Number.isFinite(features.time) ? features.time : this.lastTime;
    if (features.sourceGeneration !== this.sourceGeneration) {
      this.sourceGeneration = features.sourceGeneration;
      this.command = null;
      this.lastSequence = -1;
    }
    if (paused) {
      this.pausedAt ??= this.lastTime;
      if (features.drum?.hit) this.lastSequence = Math.max(this.lastSequence, features.drum.sequence || 0);
      return;
    }
    if (this.pausedAt !== null) {
      if (this.command) this.command.started += Math.max(0, time - this.pausedAt);
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
      return;
    }
    if (!fresh) return;
    const kind = ['thump', 'snap', 'tick'].includes(drum.kind) ? drum.kind : 'tick';
    const weight = clamp(Number(drum.weight) || 0);
    this.command = {
      kind,
      weight,
      sequence: drum.sequence,
      started: time,
      duration: (kind === 'tick' ? 0.12 : 0.19) + weight * 0.12,
      from: this.sample(time),
    };
  }

  sample(time = this.lastTime, { reducedMotion = false } = {}) {
    if (this.pausedAt !== null) time = this.pausedAt;
    const c = this.command;
    if (!c) return neutral();
    const age = Math.max(0, time - c.started);
    const peak = 0.024;
    if (age >= c.duration) return neutral();
    const envelope = age < peak ? ease(age / peak) : 1 - ease((age - peak) / (c.duration - peak));
    const strength = (0.12 + c.weight * 0.88) * envelope * (reducedMotion ? 0.12 : 1);
    const sign = c.kind === 'thump' ? 1 : -1;
    const blend = 1 - ease(age / peak);
    return {
      y: sign * strength * (c.kind === 'tick' ? 1.25 : c.kind === 'snap' ? 4 : 5.5) + c.from.y * blend,
      scaleY:
        1 -
        strength * (c.kind === 'thump' ? 0.075 : c.kind === 'snap' ? 0.032 : 0.012) +
        (c.from.scaleY - 1) * blend,
      brightness: 1 + strength * (c.kind === 'tick' ? 0.08 : 0.24) + (c.from.brightness - 1) * blend,
      envelope,
      kind: c.kind,
      weight: c.weight,
    };
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
    this.track = null;
    this.previousStyle = null;
  }

  clear() {
    this.command = null;
    this.pose = neutral();
    this.restore();
  }

  getState() {
    return {
      sequence: this.lastSequence,
      source: 'observed-drum',
      active: this.pose.envelope > 0,
      pose: { ...this.pose },
      maxTravelPx: this.travel,
    };
  }
}
