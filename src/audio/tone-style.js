/** Original causal envelope/spectrum proxies for drawing, not synth or
 * instrument recognition. No BPM, musical grid, model or audio storage.
 * Events retain only bounded attack/decay summaries; reset keeps unique IDs.
 */
const unit = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
const signed = (value) => (Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0);
const mix = (from, to, dt, seconds) => from + (to - from) * (1 - Math.exp(-dt / seconds));
export const EMPTY_TONE_STYLE = Object.freeze({
  kind: null,
  confidence: 0,
  intensity: 0,
  hit: false,
  sequence: 0,
  strength: 0,
  trend: 0,
  time: 0,
  valid: false,
  source: 'envelope-spectrum-proxy',
});

export class ToneStyleAnalyzer {
  constructor() {
    this.sequence = 0;
    this.reset();
  }

  reset() {
    this.lastTime = null;
    this.quietSince = null;
    this.quietExpired = false;
    this.unknownSince = null;
    this.previousAmplitude = null;
    this.fastAmplitude = null;
    this.slowAmplitude = null;
    this.validSeconds = 0;
    this.lastAttackTime = -Infinity;
    this.stableSeconds = 0;
    this.attackArmed = false;
    this.pendingAttack = null;
    this.events = [];
    this.kind = null;
    this.candidate = null;
    this.candidateSeconds = 0;
    this.confidence = 0;
    this.intensity = 0;
    this.state = { ...EMPTY_TONE_STYLE, sequence: this.sequence };
  }

  holdTime(time) {
    if (!Number.isFinite(time)) return;
    const shift = this.lastTime === null ? 0 : Math.max(0, time - this.lastTime);
    for (const event of this.events) event.time += shift;
    if (this.quietSince !== null) this.quietSince += shift;
    if (this.unknownSince !== null) this.unknownSince += shift;
    if (Number.isFinite(this.lastAttackTime)) this.lastAttackTime += shift;
    // Pausing consumes an unfinished attack instead of scheduling it for resume.
    this.pendingAttack = null;
    this.attackArmed = false;
    this.stableSeconds = 0;
    this.lastTime = time;
    this.state = { ...this.state, hit: false, strength: 0 };
  }

  update(features = {}, time, { spectralConcentration = 0, paused = false } = {}) {
    if (!Number.isFinite(time)) return this.getState();
    if (paused) {
      this.holdTime(time);
      return this.getState();
    }
    let dt = this.lastTime === null ? 0 : time - this.lastTime;
    if (this.lastTime !== null && dt === 0) return this.getState();
    if (dt < 0 || dt > 0.25) {
      this.reset();
      dt = 0;
    }
    const amplitude = unit(features.amplitude ?? features.rms);
    if (features.signalValid === 0 || features.silent || features.audioSilent || amplitude < 0.00003) {
      if (amplitude < 0.00003) return this.updateQuiet(time, dt);
      // Missing/inconsistent spectral evidence with measurable RMS is unknown,
      // not a measured quiet baseline from which to invent the next attack.
      return this.updateUnknown(amplitude, time, dt);
    }
    this.lastTime = time;
    this.quietSince = null;
    this.quietExpired = false;
    this.unknownSince = null;
    this.validSeconds += dt;
    const slope =
      this.previousAmplitude !== null && dt > 0
        ? Math.log(amplitude / Math.max(this.previousAmplitude, 0.00003)) / dt
        : 0;
    // Compare physical envelopes over fixed durations rather than a per-frame
    // percentage. The same gradual rise must not disappear at a faster display
    // cadence. These are local RMS summaries, not an independent animation clock.
    this.fastAmplitude =
      this.fastAmplitude === null ? amplitude : mix(this.fastAmplitude, amplitude, dt, 0.015);
    this.slowAmplitude =
      this.slowAmplitude === null ? amplitude : mix(this.slowAmplitude, amplitude, dt, 0.075);
    const rise = unit(1 - this.slowAmplitude / Math.max(this.fastAmplitude, 0.00003));
    const rising = rise >= 0.12 && slope >= 5 && amplitude >= 0.001;
    // Bootstrap from an observed settled/declining envelope. A source that starts
    // midway through a soft ramp supplies no preceding quiet baseline, so its
    // startup cannot be claimed as a measured fresh attack. Short interference
    // dips during one crescendo also cannot rearm the same physical rise.
    this.stableSeconds = rise <= 0.045 ? this.stableSeconds + dt : 0;
    if (this.stableSeconds >= 0.05) this.attackArmed = true;
    if (this.attackArmed && rising && !this.pendingAttack && time - this.lastAttackTime >= 0.09) {
      this.attackArmed = false;
      this.pendingAttack = { time, peak: amplitude, rise };
    }
    // A short causal peak confirmation prevents an almost-empty first FFT
    // window from making the same physical attack seem weak at a faster FPS.
    // This is not a BPM lock or a synthetic event: only a measured rise starts it.
    if (this.pendingAttack) {
      this.pendingAttack.peak = Math.max(this.pendingAttack.peak, amplitude);
      this.pendingAttack.rise = Math.max(this.pendingAttack.rise, rise);
    }
    const hit = Boolean(this.pendingAttack && time - this.pendingAttack.time >= 0.022);
    // A high cached attack flag is not a fresh envelope rise. Repeated render
    // snapshots also retain the same sequence and must be consumed only once.
    this.previousAmplitude = amplitude;
    const strength = hit
      ? unit(Math.sqrt(this.pendingAttack.peak) * 1.8 * 0.75 + this.pendingAttack.rise * 0.25)
      : 0;
    if (hit) {
      const peak = this.pendingAttack.peak;
      this.pendingAttack = null;
      this.sequence++;
      this.lastAttackTime = time;
      this.events.push({ time, peak, highSeconds: 0, resolved: false, fastDecay: false });
    }
    this.events = this.events.filter((event) => time - event.time <= 2).slice(-24);
    const event = this.events.at(-1);
    if (event) {
      const age = time - event.time;
      if (age <= 0.12) event.peak = Math.max(event.peak, amplitude);
      if (amplitude >= event.peak * 0.72 && age <= 0.6) event.highSeconds += dt;
      if (!event.resolved && age >= 0.06 && amplitude < event.peak * 0.5) {
        event.fastDecay = age <= 0.38 && event.highSeconds < 0.12;
        event.resolved = true;
      } else if (!event.resolved && event.highSeconds >= 0.14) event.resolved = true;
    }
    const periodicity = unit(features.pitchConfidence);
    const focus = unit(spectralConcentration);
    const flatness = unit(features.noisiness);
    const tonal = Math.max(unit((focus - 0.025) / 0.2), periodicity * unit((1 - flatness) / 0.6));
    const brightness = unit(features.timbreBrightness ?? features.brightness);
    const contour = Math.max(
      Math.abs(signed(features.frequencyTrend)),
      Math.abs(signed(features.pitchTrend)) * periodicity,
    );
    const leading = unit((brightness - 0.39) / 0.23 + contour * 0.85);
    const resolved = this.events.filter((attack) => attack.resolved);
    const decays = resolved.filter((attack) => attack.fastDecay);
    const decayShare = decays.length / Math.max(1, resolved.length);
    const heldShare =
      resolved.filter((attack) => attack.highSeconds >= 0.14).length / Math.max(1, resolved.length);
    const intervals = this.events.slice(1).map((attack, index) => attack.time - this.events[index].time);
    const meanInterval = intervals.reduce((sum, value) => sum + value, 0) / Math.max(1, intervals.length);
    const variation = meanInterval
      ? Math.sqrt(
          intervals.reduce((sum, value) => sum + (value - meanInterval) ** 2, 0) /
            Math.max(1, intervals.length),
        ) / meanInterval
      : 1;
    const regular = this.events.length >= 3 ? unit(1 - variation / 0.35) : 0;
    const scores = {
      pulse: tonal * regular * heldShare * 0.96,
      pluck: tonal * decayShare * 0.96,
      lead: tonal * leading * (1 - decayShare * 0.7),
      pad: tonal * (1 - leading) * (1 - decayShare * 0.9) * unit(this.validSeconds / 0.5),
      noise: Math.max(unit((flatness - 0.12) / 0.4), (1 - tonal) * unit((0.1 - focus) / 0.09) * 0.9),
    };
    const [candidate, score] = Object.entries(scores).sort((left, right) => right[1] - left[1])[0];
    const currentScore = this.kind ? scores[this.kind] : 0;
    if (score >= 0.45 && candidate !== this.kind && (!this.kind || score >= currentScore + 0.08)) {
      if (this.candidate !== candidate) {
        this.candidate = candidate;
        this.candidateSeconds = 0;
      }
      this.candidateSeconds += dt;
      if (this.validSeconds >= 0.18 && this.candidateSeconds >= 0.15) {
        this.kind = candidate;
        this.candidate = null;
        this.candidateSeconds = 0;
      }
    } else {
      this.candidate = null;
      this.candidateSeconds = 0;
    }
    this.confidence = mix(this.confidence, this.kind ? scores[this.kind] : 0, dt, 0.12);
    const attackEnvelope = Number.isFinite(this.lastAttackTime)
      ? Math.exp(-(time - this.lastAttackTime) / 0.2)
      : 0;
    this.intensity = mix(
      this.intensity,
      unit(Math.sqrt(amplitude) * 1.8 * 0.7 + attackEnvelope * 0.2 + brightness * 0.1),
      dt,
      0.08,
    );
    this.state = {
      kind: this.kind,
      confidence: unit(this.confidence),
      intensity: unit(this.intensity),
      hit,
      sequence: this.sequence,
      strength: hit ? strength : 0,
      trend: signed(
        signed(features.amplitudeTrend) * 0.6 +
          signed(features.frequencyTrend) * 0.45 +
          signed(features.pitchTrend) * periodicity * 0.25,
      ),
      time,
      valid: true,
      source: 'envelope-spectrum-proxy',
    };
    return this.getState();
  }

  getState() {
    return { ...this.state };
  }

  updateQuiet(time, dt) {
    // Short real gaps are part of a pluck's measured decay. Long quiet retires
    // classification history while retaining only the actually observed zero
    // envelope as a fresh onset baseline. Explicit source reset clears both.
    this.unknownSince = null;
    if (this.quietSince === null) this.quietSince = time;
    if (time - this.quietSince >= 0.8 && !this.quietExpired) {
      const quietSince = this.quietSince;
      this.reset();
      this.quietSince = quietSince;
      this.quietExpired = true;
    }
    this.lastTime = time;
    this.previousAmplitude = 0;
    this.fastAmplitude = mix(this.fastAmplitude ?? 0, 0, dt, 0.015);
    this.slowAmplitude = mix(this.slowAmplitude ?? 0, 0, dt, 0.075);
    this.stableSeconds += dt;
    if (this.stableSeconds >= 0.05 || time - this.quietSince >= 0.05) this.attackArmed = true;
    this.pendingAttack = null;
    this.events = this.events.filter((event) => time - event.time <= 2).slice(-24);
    const event = this.events.at(-1);
    if (event && !event.resolved && time - event.time >= 0.06) {
      event.fastDecay = time - event.time <= 0.38 && event.highSeconds < 0.12;
      event.resolved = true;
    }
    this.intensity = mix(this.intensity, 0, dt, 0.08);
    this.state = {
      ...this.state,
      hit: false,
      strength: 0,
      intensity: unit(this.intensity),
      trend: 0,
      valid: false,
      time,
    };
    return this.getState();
  }

  updateUnknown(amplitude, time, dt) {
    this.quietSince = null;
    this.quietExpired = false;
    if (this.unknownSince === null) this.unknownSince = time;
    if (time - this.unknownSince >= 0.08) {
      const unknownSince = this.unknownSince;
      this.reset();
      this.unknownSince = unknownSince;
    }
    // The start of an FFT window can contain a few real PCM samples before its
    // spectrum has enough power. Preserve that measured RMS and the preceding
    // baseline briefly; do not manufacture silence, an event or a style there.
    this.lastTime = time;
    this.previousAmplitude = amplitude;
    this.fastAmplitude =
      this.fastAmplitude === null ? amplitude : mix(this.fastAmplitude, amplitude, dt, 0.015);
    this.slowAmplitude =
      this.slowAmplitude === null ? amplitude : mix(this.slowAmplitude, amplitude, dt, 0.075);
    this.stableSeconds = 0;
    this.pendingAttack = null;
    this.intensity = mix(this.intensity, 0, dt, 0.08);
    this.state = {
      ...this.state,
      valid: false,
      hit: false,
      strength: 0,
      trend: 0,
      intensity: unit(this.intensity),
      time,
    };
    return this.getState();
  }
}
