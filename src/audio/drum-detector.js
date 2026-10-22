/**
 * Original causal percussion-attack proxy. It measures positive changes in
 * unsmoothed linear FFT magnitudes and the current PCM envelope, independently
 * of tempo estimation. Band names describe attack colour, not instrument IDs.
 * No predicted grid pulse can create a hit here.
 */
export const EMPTY_DRUM = Object.freeze({
  hit: false,
  sequence: 0,
  weight: 0,
  strength: 0,
  kind: null,
  confidence: 0,
  time: null,
  attackTime: null,
  confirmedAt: null,
  ageSeconds: 0,
  envelope: 0,
  evidence: Object.freeze({ flux: 0, rise: 0, contrast: 0, low: 0, mid: 0, high: 0 }),
});

// Keep enough causal attack evidence to classify the head, without turning a
// 60 Hz frame's 16.67 ms observation into an extra 33.33 ms wait for 18 ms.
const ATTACK_CONFIRM_SECONDS = 0.016;
const MIN_ATTACK_INTERVAL_SECONDS = 0.07;
const MAX_EVENT_AGE_SECONDS = 0.25;

/** Audio-clock age, not a visual-clock timestamp or a device-latency estimate.
 * attackTime is the first observed candidate, which may follow the physical
 * onset. time stays the confirmation timestamp for existing consumers. */
export function ageDrumObservation(observation, audioTime) {
  const ageSeconds =
    Number.isFinite(observation?.attackTime) && Number.isFinite(audioTime)
      ? Math.max(0, Math.min(MAX_EVENT_AGE_SECONDS, audioTime - observation.attackTime))
      : 0;
  return Object.freeze({ ...(observation || EMPTY_DRUM), ageSeconds });
}

export class DrumDetector {
  constructor({ sampleRate = 48000, fftSize = 2048 } = {}) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.sequence = 0;
    this.reset();
  }

  reset() {
    // A cached renderer snapshot cannot mistake the first event after a source
    // reset for an already consumed event. Source epochs still belong upstream.
    this.previous = null;
    this.lastTime = null;
    this.primedAt = null;
    this.pendingAttack = null;
    this.previousShortRms = 0;
    this.previousLevels = [0, 0, 0];
    this.fluxMean = [0, 0, 0];
    this.fluxDeviation = [0, 0, 0];
    this.lastHitTime = -Infinity;
    this.lastAttackTime = -Infinity;
    this.lastBandHits = [-Infinity, -Infinity, -Infinity];
    this.levelPeak = 0;
    this.bandPeaks = [0, 0, 0];
    this.envelope = 0;
    this.lastEvent = null;
    this.lastResult = Object.freeze({ ...EMPTY_DRUM, sequence: this.sequence });
  }

  process({ spectrum, wave, time, rms = 0 } = {}) {
    if (!spectrum || !Number.isFinite(time))
      throw new TypeError('DrumDetector requires linear spectrum and finite seconds.');
    if (this.lastTime === time) return Object.freeze({ ...this.lastResult, hit: false });
    if (this.lastTime !== null && (time < this.lastTime || time - this.lastTime > 0.25)) this.reset();
    const dt = this.lastTime === null ? 1 / 90 : time - this.lastTime;
    const first = !this.previous || this.previous.length !== spectrum.length;
    if (first) this.previous = new Float32Array(spectrum.length);
    const powers = [0, 0, 0],
      increases = [0, 0, 0];
    for (let bin = 1; bin < spectrum.length; bin++) {
      const frequency = (bin * this.sampleRate) / this.fftSize;
      const magnitude = unit(spectrum[bin]);
      if (frequency >= 35 && frequency <= Math.min(16000, this.sampleRate / 2)) {
        const band = frequency < 240 ? 0 : frequency < 2600 ? 1 : 2;
        powers[band] += magnitude ** 2;
        increases[band] += (first ? 0 : Math.max(0, magnitude - this.previous[bin])) ** 2;
      }
      this.previous[bin] = magnitude;
    }
    const levels = powers.map(Math.sqrt);
    const total = powers.reduce((sum, value) => sum + value, 0);
    const fluxes = increases.map((value, band) => Math.sqrt(value) / Math.max(1e-7, levels[band]));
    const shares = powers.map((value) => value / Math.max(1e-14, total));
    const shortRms = shortEnvelope(wave, this.sampleRate, rms);
    const audible = Math.max(shortRms, rms) >= 0.00003 && total > 1e-13;
    const rmsRise = unit((shortRms - this.previousShortRms) / Math.max(0.00003, shortRms));
    const rmsSlope = (shortRms - this.previousShortRms) / Math.max(0.001, dt);
    const rises = levels.map((level, band) => unit(1 - this.previousLevels[band] / Math.max(1e-7, level)));
    const bandSlopes = levels.map((level, band) => (level - this.previousLevels[band]) / Math.max(0.001, dt));
    this.lastTime = time;
    this.primedAt ??= time;
    this.previousShortRms = shortRms;
    this.previousLevels = levels;
    this.envelope *= Math.exp(-dt / 0.16);
    this.levelPeak *= Math.exp(-dt / 8);
    this.bandPeaks = this.bandPeaks.map((value) => value * Math.exp(-dt / 8));

    const candidates = [];
    for (let band = 0; band < 3; band++) {
      const threshold = Math.max(0.13, this.fluxMean[band] + this.fluxDeviation[band] * 2.6);
      const contrast = unit((fluxes[band] - threshold) / Math.max(0.15, threshold));
      const strongRise = rmsRise >= 0.075 || rises[band] >= 0.32;
      if (
        !first &&
        time - this.primedAt >= 0.04 &&
        audible &&
        shortRms >= Math.max(0.00003, this.levelPeak * 0.025) &&
        Math.sqrt(increases[band]) > 0.0000002 &&
        shares[band] > (band === 2 ? 0.008 : 0.035) &&
        levels[band] >= Math.max(1e-7, this.bandPeaks[band] * 0.035) &&
        fluxes[band] > threshold &&
        strongRise &&
        time - this.lastHitTime >= 0.045 &&
        // Earlier confirmation must not expose the same drum head's later
        // spectral movement as another colour. Anchor this guard to the
        // observed attack, preserving distinct 80 ms hits across bands.
        time - this.lastAttackTime >= MIN_ATTACK_INTERVAL_SECONDS &&
        time - this.lastBandHits[band] >= 0.075
      )
        candidates.push({
          band,
          score: contrast * Math.sqrt(shares[band]),
          contrast,
          sharpness: Math.max(rmsSlope, bandSlopes[band] * 3),
        });
      // Attack outliers cannot immediately raise the background gate enough to
      // hide a following light hit. Steady noise remains part of the baseline.
      const follow = 1 - Math.exp(-dt / 0.5);
      const bounded = Math.min(fluxes[band], this.fluxMean[band] + 0.18);
      const delta = bounded - this.fluxMean[band];
      this.fluxMean[band] += delta * follow;
      this.fluxDeviation[band] += (Math.abs(delta) - this.fluxDeviation[band]) * follow;
    }

    let hit = false;
    const sharpCandidate = candidates.find(
      (candidate) => candidate.sharpness >= (candidate.band === 2 ? 0.08 : 0.5),
    );
    if (!this.pendingAttack && sharpCandidate) {
      this.pendingAttack = {
        start: time,
        peakRms: shortRms,
        attackPowers: [0, 0, 0],
        attackBands: new Set(),
        evidence: null,
      };
    }
    if (this.pendingAttack) {
      const pending = this.pendingAttack;
      pending.peakRms = Math.max(pending.peakRms, shortRms, rms);
      for (let band = 0; band < 3; band++) pending.attackPowers[band] += increases[band];
      if (candidates.length) {
        candidates.sort((left, right) => right.score - left.score);
        for (const candidate of candidates) pending.attackBands.add(candidate.band);
        pending.evidence = { selected: candidates[0], rmsRise, rises, fluxes };
      }
      // A short attack window observes enough of the drum head to distinguish
      // low body from a leading click and to estimate its perceptual weight.
      // It is independent of any beat period or tempo confidence.
      if (time - pending.start >= ATTACK_CONFIRM_SECONDS) {
        this.pendingAttack = null;
        if (pending.evidence && audible) {
          const {
            selected,
            rmsRise: attackRise,
            rises: attackRises,
            fluxes: attackFluxes,
          } = pending.evidence;
          const attackTotal = pending.attackPowers.reduce((sum, value) => sum + value, 0);
          const attackShares = pending.attackPowers.map((value) => value / Math.max(1e-14, attackTotal));
          const band =
            attackShares[0] >= 0.48 && pending.attackBands.has(0)
              ? 0
              : attackShares[1] >= 0.15 && pending.attackBands.has(1)
                ? 1
                : selected.band;
          if (time - this.lastBandHits[band] >= 0.075) {
            // Broadband mid+high attacks read as a snap. A genuinely high-only
            // transient stays a tick; dominant bass energy stays a thump.
            const kind = ['thump', 'snap', 'tick'][band];
            const local = unit(pending.peakRms / Math.max(0.00003, this.levelPeak, pending.peakRms));
            const colourLevel = unit(levels[band] / Math.max(1e-7, this.bandPeaks[band], levels[band]));
            const loudness = unit(1 - Math.exp(-pending.peakRms * 9));
            const colourWeight = [1, 0.82, 0.46][band];
            const weight = unit(colourWeight * (0.3 * local + 0.15 * colourLevel + 0.55 * loudness));
            const strength = unit(0.55 * selected.contrast + 0.25 * attackRise + 0.2 * attackRises[band]);
            const confidence = unit(
              0.42 + 0.35 * selected.contrast + 0.23 * Math.max(attackRise, attackRises[band]),
            );
            this.sequence++;
            // Band identity uses the observed attack start. Otherwise an 80 ms
            // second snap can be excluded from its own band and incorrectly
            // fall back to a tick. The short global guard also covers the
            // confirmed drum head to reject late noise within that same hit.
            this.lastHitTime = time;
            this.lastAttackTime = pending.start;
            this.lastBandHits[band] = pending.start;
            this.levelPeak = Math.max(this.levelPeak, pending.peakRms);
            for (let index = 0; index < 3; index++)
              this.bandPeaks[index] = Math.max(this.bandPeaks[index], levels[index]);
            this.envelope = weight;
            this.lastEvent = {
              sequence: this.sequence,
              weight,
              strength,
              kind,
              confidence,
              time,
              attackTime: pending.start,
              confirmedAt: time,
              evidence: Object.freeze({
                flux: unit(attackFluxes[selected.band]),
                rise: attackRise,
                contrast: selected.contrast,
                low: unit(attackShares[0]),
                mid: unit(attackShares[1]),
                high: unit(attackShares[2]),
              }),
            };
            hit = true;
          }
        }
      }
    }
    if (!audible && this.envelope < 0.005) {
      this.envelope = 0;
      this.lastEvent = null;
    }
    this.lastResult = ageDrumObservation(
      {
        ...(this.lastEvent || EMPTY_DRUM),
        sequence: this.sequence,
        hit,
        envelope: unit(this.envelope),
      },
      time,
    );
    return this.lastResult;
  }
}

function shortEnvelope(wave, sampleRate, fallback) {
  if (!wave?.length) return unit(fallback);
  const start = Math.max(0, wave.length - Math.round(sampleRate * 0.012));
  let square = 0;
  for (let index = start; index < wave.length; index++) {
    const value = Number.isFinite(wave[index]) ? wave[index] : 0;
    square += value * value;
  }
  return unit(Math.sqrt(square / Math.max(1, wave.length - start)));
}

const unit = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
