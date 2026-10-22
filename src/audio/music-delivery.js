const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

/** Causal delivery cues from observed sound, never from the internal beat grid.
 * Onset density is a proxy for urgency; it is not speech-rate recognition.
 */
export class MusicDelivery {
  constructor() {
    this.reset();
  }

  reset() {
    this.onsets = [];
    this.lastTime = null;
    this.lastOnset = -Infinity;
    this.lastDrumSequence = -1;
    this.lastRise = false;
    this.energyBaseline = null;
    this.drive = 0;
    this.density = 0;
    this.pausedAt = null;
    this.sourceGeneration = null;
  }

  update(features, time, { paused = false } = {}) {
    if (!Number.isFinite(time)) return this.getState();
    if (Number.isFinite(features.sourceGeneration) && features.sourceGeneration !== this.sourceGeneration) {
      this.reset();
      this.sourceGeneration = features.sourceGeneration;
    }
    if (paused) {
      if (Number.isSafeInteger(features.drum?.sequence))
        this.lastDrumSequence = Math.max(this.lastDrumSequence, features.drum.sequence);
      this.pausedAt ??= this.lastTime ?? time;
      this.lastTime = time;
      return this.getState();
    }
    if (this.pausedAt !== null) {
      const gap = Math.max(0, time - this.pausedAt);
      this.onsets = this.onsets.map((onset) => onset + gap);
      if (Number.isFinite(this.lastOnset)) this.lastOnset += gap;
      this.pausedAt = null;
      this.lastTime = time;
    }
    const dt = clamp(this.lastTime === null ? 1 / 60 : time - this.lastTime, 0, 0.25);
    this.lastTime = time;
    const valid = !features.silent && features.signalValid !== 0;
    const energy = clamp(finite(features.energy));
    const drum = features.drum;
    const newDrum = Boolean(
      valid && drum?.hit && Number.isSafeInteger(drum.sequence) && drum.sequence > this.lastDrumSequence,
    );
    if (Number.isSafeInteger(drum?.sequence))
      this.lastDrumSequence = Math.max(this.lastDrumSequence, drum.sequence);
    const rise = valid && features.amplitudeRise >= 0.2 && features.attack >= 0.4;
    if ((newDrum || (rise && !this.lastRise)) && time - this.lastOnset >= 0.06) {
      this.onsets.push(time);
      this.lastOnset = time;
    }
    this.lastRise = rise;
    this.onsets = this.onsets.filter((onset) => time - onset <= 1.6).slice(-32);
    this.density = valid ? this.onsets.length / 1.6 : 0;
    const baseline = this.energyBaseline ?? energy;
    const lift = valid ? clamp((energy - baseline) / Math.max(0.2, baseline * 0.75)) : 0;
    this.energyBaseline = baseline + (energy - baseline) * (1 - Math.exp(-dt / 2.8));
    const densityDrive = clamp((this.density - 1.4) / 4.2);
    const target = valid
      ? clamp(densityDrive * 0.86 + lift * 0.32 + clamp(finite(features.amplitudeTrend)) * 0.12)
      : 0;
    this.drive += (target - this.drive) * (1 - Math.exp(-dt / (target > this.drive ? 0.16 : 0.8)));
    return this.getState();
  }

  getState() {
    return {
      drive: this.drive,
      density: this.density,
      mode: this.drive > 0.6 ? 'intense' : this.drive > 0.25 ? 'flow' : 'calm',
      readingMultiplier: 1 + this.drive * 0.75,
      source: 'observed-audio',
      interpretation: 'onset-density-and-energy-proxy',
    };
  }
}
