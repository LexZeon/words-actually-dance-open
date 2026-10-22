import { estimateAmplitudeRhythm, estimateNoveltyRhythm } from './periodicity.js';

/** Independent evidence lanes for drums, spectral attacks and melodic change.
 * Only compact envelopes are retained; no recording/model/cloud dependency.
 */
export class RhythmAnalyzer {
  constructor({ sampleRate = 48000, fftSize = 2048 } = {}) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.reset();
  }

  reset() {
    this.previousLog = null;
    this.previousChroma = null;
    this.previousLow = 0;
    this.lastTime = null;
    this.lastAudibleTime = -Infinity;
    this.lastEstimate = -Infinity;
    this.noveltyEnvelope = 0;
    this.harmonicEnvelope = 0;
    this.histories = { bass: [], spectral: [], harmonic: [] };
    this.candidates = { bass: null, spectral: null, harmonic: null };
    this.selectedCandidate = null;
  }

  /** Retain actual frames from a supported rhythm change, rather than waiting
   * for six seconds of the previous song to leave the sliding window. */
  rebaseSince(time) {
    for (const history of Object.values(this.histories))
      while (history.length && history[0].time < time) history.shift();
    this.candidates = { bass: null, spectral: null, harmonic: null };
    this.selectedCandidate = null;
    this.lastEstimate = -Infinity;
  }

  process({ spectrum, time, rms }) {
    if (this.lastTime !== null && (time < this.lastTime || time - this.lastTime > 0.25)) this.reset();
    const audible = rms >= 0.00003;
    if (audible) this.lastAudibleTime = time;
    // Short musical rests contribute real zero envelope samples. Skipping them
    // would interpolate a false plateau, while resetting at every zero would
    // erase a sparse kick's repetition before a bass primary can be supported.
    if (!audible && time - this.lastAudibleTime > 1.3) {
      this.reset();
      return this.result(0, 0, 0, 0);
    }
    const dt = this.lastTime === null ? 1 / 60 : Math.max(0.001, time - this.lastTime);
    this.lastTime = time;
    const first = !this.previousLog || this.previousLog.length !== spectrum.length;
    const log = new Float32Array(spectrum.length),
      chroma = new Float32Array(12);
    const hzPerBin = this.sampleRate / this.fftSize;
    const scale = Math.max(1e-7, rms * 0.015);
    let lowPower = 0,
      logFlux = 0,
      bins = 0,
      chromaMass = 0;
    for (let bin = 1; bin < spectrum.length; bin++) {
      const magnitude = audible && Number.isFinite(spectrum[bin]) ? Math.max(0, spectrum[bin]) : 0;
      const hz = bin * hzPerBin;
      if (hz >= 40 && hz < 110) lowPower += magnitude * magnitude;
      if (hz < 60 || hz > 12000) continue;
      bins++;
      log[bin] = Math.log1p(magnitude / scale);
      if (!first) {
        // Frequency-neighborhood maximum reduces novelty due solely to a
        // vibrating partial moving across neighboring FFT bins (SuperFlux idea).
        const previous = Math.max(
          this.previousLog[bin - 1] || 0,
          this.previousLog[bin] || 0,
          this.previousLog[bin + 1] || 0,
        );
        logFlux += Math.max(0, log[bin] - previous);
      }
      if (hz >= 100 && hz <= 3500 && magnitude > 1e-7) {
        const midi = 69 + 12 * Math.log2(hz / 440),
          integer = Math.floor(midi),
          fraction = midi - integer;
        const pitchClass = ((integer % 12) + 12) % 12;
        // Fractional pitch-class interpolation avoids sharp quantization jumps.
        const weight = magnitude / Math.sqrt(Math.max(1, hz / 440));
        chroma[pitchClass] += weight * (1 - fraction);
        chroma[(pitchClass + 1) % 12] += weight * fraction;
        chromaMass += weight;
      }
    }
    if (chromaMass > 0) for (let i = 0; i < 12; i++) chroma[i] /= chromaMass;
    let harmonicNovelty = 0;
    if (this.previousChroma && chromaMass > 0) {
      for (let i = 0; i < 12; i++) {
        const reference = Math.max(
          this.previousChroma[i],
          this.previousChroma[(i + 11) % 12],
          this.previousChroma[(i + 1) % 12],
        );
        harmonicNovelty += Math.max(0, chroma[i] - reference);
      }
    }
    // A tiny continuous pitch/vowel fluctuation is not a fresh note onset.
    harmonicNovelty = harmonicNovelty < 0.015 ? 0 : harmonicNovelty;
    const novelty = unit((logFlux / Math.max(1, bins)) * 12);
    const lowMagnitude = Math.sqrt(lowPower);
    const lowRise = first ? 0 : unit((lowMagnitude - this.previousLow) / Math.max(1e-7, lowMagnitude));
    this.previousLow = lowMagnitude;
    this.previousLog = log;
    this.previousChroma = chroma;
    const follow = 1 - Math.exp(-dt / 0.045);
    this.noveltyEnvelope += (novelty - this.noveltyEnvelope) * follow;
    this.harmonicEnvelope += (harmonicNovelty - this.harmonicEnvelope) * follow;
    const values = { bass: lowMagnitude, spectral: this.noveltyEnvelope, harmonic: this.harmonicEnvelope };
    for (const [lane, history] of Object.entries(this.histories)) {
      if (!history.length || time - history.at(-1).time >= 0.015) history.push({ time, value: values[lane] });
      while (history.length && time - history[0].time > 6) history.shift();
    }
    if (time - this.lastEstimate >= 0.28) {
      this.lastEstimate = time;
      this.candidates = {
        bass: estimateAmplitudeRhythm(this.histories.bass),
        spectral: estimateNoveltyRhythm(this.histories.spectral),
        harmonic: estimateNoveltyRhythm(this.histories.harmonic),
      };
    }
    return this.result(lowMagnitude, lowRise, novelty, harmonicNovelty);
  }

  result(lowMagnitude, lowRise, novelty, harmonicNovelty) {
    const candidates = Object.entries(this.candidates)
      .filter(([, model]) => model)
      .map(([source, model]) => ({ ...model, source }));
    let candidate = candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
    if (candidate && this.selectedCandidate) {
      const continuation = candidates.find(
        (model) =>
          model.confidence >= 0.3 &&
          Math.abs(model.bpm - this.selectedCandidate.bpm) <= this.selectedCandidate.bpm * 0.06,
      );
      if (continuation) {
        const ratio = candidate.bpm / continuation.bpm;
        const octaveAmbiguous = Math.abs(ratio - 0.5) < 0.07 || Math.abs(ratio - 2) < 0.14;
        if (octaveAmbiguous && candidate.confidence < continuation.confidence + 0.15) {
          candidate = { ...continuation, octaveAlternativeBpm: candidate.bpm };
        }
      }
    }
    this.selectedCandidate = candidate;
    return { candidate, candidates: this.candidates, lowMagnitude, lowRise, novelty, harmonicNovelty };
  }
}

const unit = (value) => Math.max(0, Math.min(1, value));
