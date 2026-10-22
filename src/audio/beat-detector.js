import { RhythmAnalyzer } from './rhythm/rhythm-analyzer.js';
import { resolveTempoHypotheses } from './rhythm/tempo-hypotheses.js';

/**
 * Lightweight, causal music features for animation, not a full musical meter tracker.
 * Input: linear FFT magnitudes (not decibels), seconds on a monotonic clock, RMS.
 * `beat` and `silent` are numeric 0/1; `onset` is a decaying transient envelope.
 * No beat is emitted by the phase predictor: beats require a measured transient.
 */
export class BeatDetector {
  constructor({ sampleRate = 48000, fftSize = 2048 } = {}) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.reset();
  }

  reset() {
    this.previous = null;
    this.lastTime = null;
    this.lastAudibleTime = -Infinity;
    this.lastBeatTime = -Infinity;
    this.fullLastBeatTime = -Infinity;
    this.fullBpm = 0;
    this.fullConfidence = 0;
    this.fullBeatTimes = [];
    this.fullOnsetObservations = [];
    this.tempoHypotheses = null;
    this.primaryTempoPrior = null;
    this.fullPhaseCoherence = 0;
    this.rhythm = new RhythmAnalyzer({ sampleRate: this.sampleRate, fftSize: this.fftSize });
    this.rhythmSource = 'interval';
    this.rhythmCandidates = { bass: null, spectral: null, harmonic: null };
    this.lowModel = null;
    this.intervals = [];
    this.fluxHistory = [];
    this.previousFlux = 0;
    this.bpm = 0;
    this.confidence = 0;
    this.onset = 0;
    this.energy = 0;
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.brightness = 0;
    this.rmsPeak = 0;
    this.lastSupportedBpm = 0;
    this.lastTempoSupportTime = -Infinity;
    this.reacquiringUntil = -Infinity;
    this.tempoReacquisitions = 0;
    this.lastTempoChangeTime = null;
  }

  process({ spectrum, time, rms = 0 } = {}) {
    if (!spectrum || !Number.isFinite(time)) {
      throw new TypeError('BeatDetector requires a spectrum and a finite time in seconds.');
    }
    if (this.lastTime !== null && time < this.lastTime) this.reset();
    if (this.lastTime !== null && time - this.lastTime > 0.25) {
      // A hidden/minimized renderer can sample at only 1 Hz. Those snapshots
      // cannot resolve percussion and would alias into a plausible false BPM.
      // Relearn after the gap instead of treating it as one musical interval.
      this.previous = null;
      this.previousFlux = 0;
      this.fluxHistory = [];
      this.intervals = [];
      this.lastBeatTime = -Infinity;
      this.fullLastBeatTime = -Infinity;
      this.fullBpm = 0;
      this.fullConfidence = 0;
      this.fullBeatTimes = [];
      this.fullOnsetObservations = [];
      this.primaryTempoPrior = null;
      this.fullPhaseCoherence = 0;
      this.rhythm.reset();
      this.lowModel = null;
      this.bpm = 0;
      this.confidence = 0;
      this.onset = 0;
      this.lastSupportedBpm = 0;
      this.lastTempoSupportTime = -Infinity;
    }
    const dt = this.lastTime === null ? 1 / 60 : Math.min(0.25, Math.max(0.001, time - this.lastTime));
    this.lastTime = time;
    const level = clamp(rms);
    // Capture/FFT magnitudes are often much smaller than the audible playback
    // level suggests. A -90 dB RMS gate protects the numerical noise floor
    // without treating quiet pad/bass between drum hits as a stopped song.
    const audible = level >= 0.00003;
    if (audible) this.lastAudibleTime = time;
    const silent = !audible && time - this.lastAudibleTime > 0.22;
    const firstFrame = !this.previous || this.previous.length !== spectrum.length;
    if (firstFrame) this.previous = new Float32Array(spectrum.length);

    const counts = [0, 0, 0];
    const powers = [0, 0, 0];
    const fluxes = [0, 0, 0];
    let weightedFrequency = 0;
    let spectralMass = 0;
    const hzPerBin = this.sampleRate / this.fftSize;
    for (let i = 1; i < spectrum.length; i++) {
      const magnitude = clamp(spectrum[i]);
      const frequency = i * hzPerBin;
      const band = frequency < 250 ? 0 : frequency < 4000 ? 1 : 2;
      if (frequency <= 16000) {
        counts[band]++;
        powers[band] += magnitude * magnitude;
        const increase = firstFrame ? 0 : Math.max(0, magnitude - this.previous[i]);
        fluxes[band] += increase * increase;
        // A log-frequency centroid distinguishes a bass-heavy track from a bright one.
        spectralMass += magnitude;
        weightedFrequency +=
          magnitude * clamp(Math.log2(Math.max(30, frequency) / 30) / Math.log2(16000 / 30));
      }
      this.previous[i] = magnitude;
    }
    this.previous[0] = clamp(spectrum[0]);
    const bands = powers.map((power, i) => Math.sqrt(power / Math.max(1, counts[i])));
    const rhythm = this.rhythm.process({ spectrum, time, rms: level });
    this.lowModel = rhythm.candidates.bass;
    this.rhythmCandidates = rhythm.candidates;
    const weights = [0.6, 0.3, 0.1];
    const rawFlux = fluxes.reduce(
      (sum, power, i) => sum + Math.sqrt(power / Math.max(1, counts[i])) * weights[i],
      0,
    );
    const spectralLevel = bands.reduce((sum, band, i) => sum + band * weights[i], 0);
    // Relative spectral flux preserves the attack at both high and low gain.
    // The absolute denominator/floor guards sub-audible FFT rounding noise.
    const flux = clamp(rawFlux / Math.max(0.0000001, spectralLevel));
    this.rmsPeak = Math.max(audible ? level : 0, this.rmsPeak * Math.exp(-dt / 3));
    const energyTarget = audible ? Math.sqrt(level / Math.max(0.00003, this.rmsPeak)) : 0;
    const perceivedBands = bands.map((band, i) =>
      audible ? clamp(Math.sqrt((band / Math.max(level, 0.00003)) * [2.4, 5, 10][i])) : 0,
    );
    const follow = 1 - Math.exp(-dt / 0.085);
    this.energy = lerp(this.energy, clamp(energyTarget), follow);
    this.bass = lerp(this.bass, perceivedBands[0], follow);
    this.mid = lerp(this.mid, perceivedBands[1], follow);
    this.treble = lerp(this.treble, perceivedBands[2], follow);
    this.brightness = lerp(this.brightness, spectralMass > 0 ? weightedFrequency / spectralMass : 0, follow);

    // The threshold adapts to roughly 1.5 s of relative measured flux. The
    // relative floor rejects slow drift; RMS/raw-flux gates reject noise floor.
    while (this.fluxHistory.length && time - this.fluxHistory[0].time > 1.5) this.fluxHistory.shift();
    const mean = average(this.fluxHistory.map((entry) => entry.flux));
    const variance = average(this.fluxHistory.map((entry) => (entry.flux - mean) ** 2));
    const threshold = Math.max(0.04, mean + Math.sqrt(variance) * 1.7);
    const transient =
      !firstFrame && audible && rawFlux > 0.0000001 && flux > threshold && flux > this.previousFlux * 1.12;
    let beat = 0;
    let strength = 0;
    this.onset *= Math.exp(-dt / 0.13);
    this.didReacquire = false;
    if (transient) {
      strength = clamp((flux - threshold) / Math.max(0.2, threshold * 1.5));
      this.onset = Math.max(this.onset, strength);
      // Refractory window suppresses the repeated attacks within one percussion hit.
      if (time - this.fullLastBeatTime >= 0.26) {
        beat = 1;
        this.fullBeatTimes.push(time);
        this.fullOnsetObservations.push({ time, weight: Math.max(rawFlux, level * 0.02) });
        if (this.fullOnsetObservations.length > 12) this.fullOnsetObservations.shift();
        if (this.fullBeatTimes.length > 12) this.fullBeatTimes.shift();
        const interval = time - this.fullLastBeatTime;
        if (Number.isFinite(interval) && interval <= 1.5) {
          this.intervals.push(interval);
          if (this.intervals.length > 16) this.intervals.shift();
          this.updateTempo(time);
        } else if (Number.isFinite(interval)) {
          this.intervals = [];
          this.fullConfidence = 0;
          this.fullBpm = 0;
          this.fullBeatTimes = [time];
        }
        this.fullLastBeatTime = time;
      }
    }
    this.fluxHistory.push({ time, flux });
    this.previousFlux = flux;

    this.bpm = this.fullBpm;
    this.confidence = this.fullConfidence;
    this.rhythmSource = 'interval';
    const resolved = resolveTempoHypotheses({
      intervalBpm: this.fullBpm,
      intervalConfidence: this.fullConfidence,
      candidates: this.rhythmCandidates,
      observations: this.fullOnsetObservations,
      candidate: this.didReacquire ? null : rhythm.candidate,
      previousBpm: this.lastSupportedBpm,
      primaryPrior: this.primaryTempoPrior,
      time,
    });
    const candidate = resolved.primaryCandidate;
    this.tempoHypotheses = resolved.diagnostics;
    const supportedPrimary = [
      'independent-bass-primary',
      'harmonic-and-strong-weak-grouping',
      'repeatable-strong-weak-grouping',
    ].includes(resolved.diagnostics.reason);
    if (supportedPrimary && candidate) this.primaryTempoPrior = { bpm: candidate.bpm, time };
    if (
      candidate &&
      candidate.confidence >= 0.3 &&
      (supportedPrimary || candidate.confidence > this.fullConfidence + 0.12)
    ) {
      this.rhythmSource = candidate.source;
      this.bpm = candidate.bpm;
      this.confidence = candidate.confidence;
      const period = 60 / candidate.bpm;
      const peakPhase = ((((time - candidate.origin) / period) % 1) + 1) % 1;
      // Choose actually observed bass/spectral/harmonic changes near a supported
      // local pulse. This evidence layer never generates the internal grid.
      const observedStrength =
        candidate.source === 'primary-onsets'
          ? transient
            ? strength
            : 0
          : candidate.source === 'bass'
            ? rhythm.lowRise
            : candidate.source === 'harmonic'
              ? rhythm.harmonicNovelty
              : rhythm.novelty;
      const minimumStrength =
        candidate.source === 'bass' || candidate.source === 'primary-onsets'
          ? 0.04
          : candidate.source === 'harmonic'
            ? 0.025
            : 0.018;
      const inAttackWindow =
        candidate.source === 'primary-onsets'
          ? peakPhase >= 0.82 || peakPhase <= 0.18
          : candidate.source === 'bass'
            ? peakPhase >= 0.7 || peakPhase <= 0.12
            : peakPhase >= 0.65 || peakPhase <= 0.16;
      beat =
        !firstFrame &&
        audible &&
        // Relative rise in an almost absent bass bin can be a FFT sidelobe,
        // not an audible low-frequency attack. Require actual spectral mass.
        (candidate.source !== 'bass' || rhythm.lowMagnitude >= Math.max(1e-8, rms * 0.002)) &&
        observedStrength >= minimumStrength &&
        inAttackWindow &&
        time - this.lastBeatTime >= period * 0.6
          ? 1
          : 0;
      if (beat) {
        strength = Math.max(strength, observedStrength);
        this.onset = Math.max(this.onset, observedStrength);
      }
    }
    if (beat) this.lastBeatTime = time;

    if (silent) {
      // A brief musical rest is unavailable current evidence, not a new song.
      // Preserve observed intervals/lane history across it, while publishing no
      // detected beat/tempo. Long stops and explicit source reset still relearn.
      this.bpm = 0;
      this.confidence = 0;
      if (time - this.lastAudibleTime > 1.3) {
        this.intervals = [];
        this.lastBeatTime = -Infinity;
        this.fullLastBeatTime = -Infinity;
        this.fullBpm = 0;
        this.fullConfidence = 0;
        this.fullBeatTimes = [];
        this.fullOnsetObservations = [];
        this.primaryTempoPrior = null;
        this.fullPhaseCoherence = 0;
        this.rhythm.reset();
        this.lowModel = null;
        this.onset = 0;
        this.lastSupportedBpm = 0;
        this.lastTempoSupportTime = -Infinity;
      }
      beat = 0;
      strength = 0;
    } else if (time - this.lastBeatTime > 1.5) {
      this.confidence *= Math.exp(-dt / 1.5);
      this.fullConfidence *= Math.exp(-dt / 1.5);
      if (time - this.lastBeatTime > 5) this.bpm = 0;
    }
    if (!silent && this.confidence >= 0.6 && this.bpm > 0) {
      this.lastSupportedBpm = this.bpm;
      this.lastTempoSupportTime = time;
    }
    const period = this.bpm > 0 ? 60 / this.bpm : 0;
    const phase =
      !silent && period > 0 && Number.isFinite(this.lastBeatTime)
        ? ((time - this.lastBeatTime) / period) % 1
        : 0;
    return {
      energy: clamp(this.energy),
      bass: clamp(this.bass),
      mid: clamp(this.mid),
      treble: clamp(this.treble),
      brightness: clamp(this.brightness),
      onset: clamp(this.onset),
      beat,
      bpm: this.bpm,
      confidence: clamp(this.confidence),
      phase: clamp(phase),
      strength,
      silent: silent ? 1 : 0,
    };
  }

  updateTempo(time) {
    const latest = this.intervals.slice(-3);
    const newPeriod = average(latest);
    const different =
      this.lastSupportedBpm > 0 &&
      Math.abs(newPeriod - 60 / this.lastSupportedBpm) > (60 / this.lastSupportedBpm) * 0.18;
    const coherent =
      latest.length === 3 && latest.every((interval) => Math.abs(interval - newPeriod) <= newPeriod * 0.08);
    const oldLaneStillStrong = Object.entries(this.rhythmCandidates).some(
      ([lane, model]) =>
        model &&
        (model.confidence >= 0.75 ||
          (lane === 'bass' &&
            model.confidence >= 0.45 &&
            Math.abs(newPeriod * 2 - 60 / model.bpm) <= (60 / model.bpm) * 0.08 &&
            model.octaveScore < model.score * 0.8)) &&
        Math.abs(model.bpm - this.lastSupportedBpm) < this.lastSupportedBpm * 0.06,
    );
    const bass = this.rhythmCandidates.bass;
    const heldPrimaryGrouping =
      this.primaryTempoPrior &&
      time - this.primaryTempoPrior.time <= 1.5 &&
      Math.abs(newPeriod * 2 - 60 / this.primaryTempoPrior.bpm) <= (60 / this.primaryTempoPrior.bpm) * 0.08 &&
      bass &&
      Math.abs(bass.bpm - this.primaryTempoPrior.bpm) < this.primaryTempoPrior.bpm * 0.07 &&
      bass.confidence >= 0.3 &&
      bass.score >= 0.2 &&
      bass.octaveScore < bass.score * 0.92;
    if (
      different &&
      coherent &&
      !oldLaneStillStrong &&
      !heldPrimaryGrouping &&
      newPeriod >= 60 / 190 &&
      newPeriod <= 60 / 55 &&
      time - this.lastTempoSupportTime <= 4
    ) {
      this.intervals = latest;
      this.fullBeatTimes = this.fullBeatTimes.slice(-4);
      this.fullOnsetObservations = this.fullOnsetObservations.slice(-4);
      this.fullBpm = 60 / newPeriod;
      this.rhythm.rebaseSince(this.fullBeatTimes[0]);
      this.rhythmCandidates = this.rhythm.candidates;
      this.lowModel = null;
      this.didReacquire = true;
      this.reacquiringUntil = time + 4;
      this.tempoReacquisitions++;
      this.lastTempoChangeTime = time;
      this.lastSupportedBpm = this.fullBpm;
    }
    // Median rejects occasional extra/missed attacks; only consistent intervals
    // raise confidence. Startup has a tempo guess, but low confidence.
    const recent = this.intervals.slice(-10);
    const folded = recent.map((interval) => {
      while (interval < 60 / 190) interval *= 2;
      while (interval > 60 / 55) interval /= 2;
      return interval;
    });
    const center = median(folded);
    const inliers = folded.filter((interval) => Math.abs(interval - center) < center * 0.18);
    const period = average(inliers);
    if (!(period > 0)) return;
    const candidate = 60 / period;
    const deviation = average(inliers.map((interval) => Math.abs(interval - period))) / period;
    const regularity = clamp(1 - deviation / 0.15);
    // A transition has three consecutive, consistent measured intervals and a
    // formerly supported rhythm. Its fresh local epoch need not relearn eight
    // attacks; irregular or first-use audio keeps the conservative support gate.
    const support =
      Math.min(1, inliers.length / (time <= this.reacquiringUntil ? 5 : 8)) *
      (inliers.length / folded.length);
    const times = this.fullBeatTimes.slice(-(recent.length + 1));
    const origin = times[0];
    const cos = average(times.map((time) => Math.cos((2 * Math.PI * (time - origin)) / period)));
    const sin = average(times.map((time) => Math.sin((2 * Math.PI * (time - origin)) / period)));
    this.fullPhaseCoherence = clamp(Math.hypot(cos, sin));
    // A few similar syllable intervals are not a stable musical pulse unless
    // the observed attacks also agree in phase over the whole local sequence.
    this.fullConfidence = regularity * support * this.fullPhaseCoherence ** 2;
    this.fullBpm = this.fullBpm
      ? lerp(this.fullBpm, candidate, this.fullConfidence >= 0.3 ? 0.35 : 0.08)
      : candidate;
  }

  getDiagnostics() {
    return {
      source: this.rhythmSource,
      candidates: this.rhythmCandidates,
      intervalBpm: this.fullBpm,
      intervalConfidence: this.fullConfidence,
      intervalPhaseCoherence: this.fullPhaseCoherence,
      tempoReacquisitions: this.tempoReacquisitions,
      lastTempoChangeTime: this.lastTempoChangeTime,
      tempoHypotheses: this.tempoHypotheses,
    };
  }
}

const clamp = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
const lerp = (from, to, amount) => from + (to - from) * amount;
const average = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
