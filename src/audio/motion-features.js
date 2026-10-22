/**
 * Finite, causal audio descriptors for dance. Frequency is the POWER-weighted
 * spectral centroid in Hz, not the fundamental pitch. Beat phase is musical
 * phase from BeatDetector, not the phase of the raw waveform.
 *
 * Centroid/flatness definitions: https://www.mathworks.com/help/audio/ref/spectralcentroid.html
 * https://www.mathworks.com/help/signal/ref/spectralflatness.html
 * Optional pitch uses an independent normalized-autocorrelation estimator;
 * it is meaningful mainly for one stable periodic source, not polyphonic music.
 */
import { ToneStyleAnalyzer, EMPTY_TONE_STYLE } from './tone-style.js';

export const EMPTY_MOTION_FEATURES = Object.freeze({
  amplitude: 0,
  rms: 0,
  amplitudeTrend: 0,
  amplitudeRise: 0,
  centroidHz: 0,
  frequencyHz: 0,
  frequencyTrend: 0,
  noisiness: 0,
  timbreBrightness: 0,
  attack: 0,
  beatPhase: 0,
  pitchHz: 0,
  pitchConfidence: 0,
  pitchTrend: 0,
  signalValid: 0,
  toneStyle: EMPTY_TONE_STYLE,
});

export class MotionFeatures {
  constructor({ sampleRate = 48000, fftSize = 2048, estimatePitch = true, pitchInterval = 0.12 } = {}) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.estimatePitch = estimatePitch;
    this.pitchInterval = Math.max(0.08, pitchInterval);
    this.toneStyle = new ToneStyleAnalyzer();
    this.reset();
  }

  reset({ preserveTone = false } = {}) {
    this.lastTime = null;
    this.previousAmplitude = null;
    this.previousCentroid = null;
    this.amplitudeTrend = 0;
    this.frequencyTrend = 0;
    this.lastPitchTime = -Infinity;
    this.nextPitchTime = -Infinity;
    this.pitchFailures = 0;
    this.previousPitch = null;
    this.pitchHz = 0;
    this.pitchConfidence = 0;
    this.pitchTrend = 0;
    if (!preserveTone) this.toneStyle?.reset();
  }

  process({ spectrum, wave, time, rms = 0, beatFeatures = {} } = {}) {
    if (!spectrum || !Number.isFinite(time))
      throw new TypeError('MotionFeatures requires a spectrum and finite seconds.');
    if (this.lastTime !== null && (time <= this.lastTime || time - this.lastTime > 0.25)) this.reset();
    const dt = this.lastTime === null ? 1 / 60 : time - this.lastTime;
    const amplitude = unit(rms);
    const hzPerBin = this.sampleRate / this.fftSize;
    const powers = [];
    let totalPower = 0,
      weightedFrequency = 0,
      peakPower = 0,
      pitchBandPower = 0;
    for (let bin = 1; bin < spectrum.length; bin++) {
      const hz = bin * hzPerBin;
      if (hz < 20 || hz > Math.min(16000, this.sampleRate / 2)) continue;
      const power = unit(spectrum[bin]) ** 2;
      powers.push(power);
      totalPower += power;
      peakPower = Math.max(peakPower, power);
      weightedFrequency += hz * power;
      if (hz >= 70 && hz <= 1500) pitchBandPower += power;
    }
    const valid = amplitude >= 0.00003 && totalPower > 1e-12 && !beatFeatures.silent;
    if (!valid) {
      this.reset({ preserveTone: true });
      return {
        ...EMPTY_MOTION_FEATURES,
        toneStyle: this.toneStyle.update({ amplitude, rms: amplitude, signalValid: 0 }, time),
      };
    }
    this.lastTime = time;
    const centroidHz = weightedFrequency / totalPower;
    const arithmetic = totalPower / Math.max(1, powers.length);
    const floor = Math.max(1e-20, arithmetic * 1e-10);
    const geometric = Math.exp(
      powers.reduce((sum, power) => sum + Math.log(Math.max(floor, power)), 0) / powers.length,
    );
    const noisiness = unit(geometric / arithmetic);
    const follow = 1 - Math.exp(-dt / 0.16);
    const amplitudeSlope = relativeSlope(amplitude, this.previousAmplitude, dt);
    const frequencySlope = relativeSlope(centroidHz, this.previousCentroid, dt);
    this.amplitudeTrend = mix(this.amplitudeTrend, trend(amplitudeSlope, 2.8), follow);
    this.frequencyTrend = mix(this.frequencyTrend, trend(frequencySlope, 1.8), follow);
    const positiveRise =
      this.previousAmplitude === null ? 0 : Math.max(0, 1 - this.previousAmplitude / amplitude);
    const attack = unit(Math.max(positiveRise * 3, beatFeatures.strength || 0, beatFeatures.onset || 0));
    this.previousAmplitude = amplitude;
    this.previousCentroid = centroidHz;

    const pitchSupported = noisiness < 0.55 && pitchBandPower / totalPower >= 0.15;
    if (!pitchSupported) {
      // Negative evidence is available every frame, even between expensive
      // pitch scans. A held low pitch must not survive a sudden hiss/high tone.
      this.pitchHz = 0;
      this.pitchConfidence = 0;
      this.pitchTrend = 0;
      this.previousPitch = null;
    }

    if (this.estimatePitch && wave && time >= this.nextPitchTime) {
      const pitchDt = Number.isFinite(this.lastPitchTime) ? time - this.lastPitchTime : this.pitchInterval;
      // Original-spectrum evidence must agree with the supported pitch band.
      // High-frequency tones must not alias into a confident low pitch.
      const pitch = pitchSupported ? estimatePeriodicPitch(wave, this.sampleRate) : { hz: 0, confidence: 0 };
      this.lastPitchTime = time;
      this.pitchConfidence = pitch.confidence;
      if (pitch.hz > 0 && pitch.confidence >= 0.85) {
        this.pitchFailures = 0;
        this.pitchHz = pitch.hz;
        const pitchSlope = relativeSlope(pitch.hz, this.previousPitch, pitchDt);
        this.pitchTrend = mix(this.pitchTrend, trend(pitchSlope, 1.8), 1 - Math.exp(-pitchDt / 0.16));
        this.previousPitch = pitch.hz;
      } else {
        this.pitchFailures++;
        this.pitchHz = 0;
        this.pitchTrend = 0;
        this.previousPitch = null;
      }
      // Mixed/non-periodic material does not need eight unsuccessful pitch
      // scans per second. Back off to at most 0.48 s, while trusted tones keep
      // the regular interval. Silence/source reset clears this backoff.
      this.nextPitchTime = time + Math.min(0.48, this.pitchInterval * (1 + this.pitchFailures));
    } else if (!this.estimatePitch || !wave) {
      this.pitchHz = 0;
      this.pitchConfidence = 0;
      this.pitchTrend = 0;
      this.previousPitch = null;
    }
    const features = {
      amplitude,
      rms: amplitude,
      amplitudeTrend: this.amplitudeTrend,
      amplitudeRise: unit(positiveRise),
      centroidHz,
      frequencyHz: centroidHz,
      frequencyTrend: this.frequencyTrend,
      noisiness,
      timbreBrightness: unit(Math.log2(Math.max(20, centroidHz) / 20) / Math.log2(16000 / 20)),
      attack,
      beatPhase: unit(beatFeatures.phase),
      pitchHz: this.pitchHz,
      pitchConfidence: this.pitchConfidence,
      pitchTrend: this.pitchTrend,
      signalValid: 1,
    };
    return {
      ...features,
      toneStyle: this.toneStyle.update(features, time, {
        spectralConcentration: peakPower / totalPower,
      }),
    };
  }
}

function estimatePeriodicPitch(wave, sampleRate) {
  // Keep the original sample rate. Stride-decimation without an anti-alias
  // filter can turn an 11.3 kHz tone into a false 700 Hz periodic signal.
  const stride = 1;
  const rate = sampleRate / stride;
  const length = Math.floor(wave.length / stride);
  if (length < 128) return { hz: 0, confidence: 0 };
  const data = new Float32Array(length);
  let mean = 0;
  for (let i = 0; i < length; i++) {
    data[i] = Number.isFinite(wave[i * stride]) ? wave[i * stride] : 0;
    mean += data[i];
  }
  mean /= length;
  for (let i = 0; i < length; i++) data[i] -= mean;
  const minimum = Math.max(2, Math.ceil(rate / 1500));
  const maximum = Math.min(Math.floor(rate / 70), Math.floor(length / 3));
  const correlations = new Float32Array(maximum + 1);
  let negative = false,
    best = 0,
    peak = 0;
  for (let lag = minimum; lag <= maximum; lag++) {
    let ab = 0,
      aa = 0,
      bb = 0;
    for (let i = 0; i < length - lag; i++) {
      ab += data[i] * data[i + lag];
      aa += data[i] ** 2;
      bb += data[i + lag] ** 2;
    }
    const correlation = aa * bb > 1e-20 ? ab / Math.sqrt(aa * bb) : 0;
    correlations[lag] = correlation;
    if (correlation < 0) negative = true;
    if (
      negative &&
      lag > minimum + 1 &&
      correlations[lag - 1] > correlations[lag - 2] &&
      correlations[lag - 1] > correlation
    ) {
      const candidate = correlations[lag - 1];
      if (candidate > best) {
        best = candidate;
        peak = lag - 1;
      }
      if (candidate >= 0.9) break; // Prefer the first strong period over its multiples.
    }
  }
  const confidence = unit(best);
  if (!peak || confidence < 0.85) return { hz: 0, confidence };
  const left = correlations[peak - 1],
    center = correlations[peak],
    right = correlations[peak + 1];
  const denominator = left - 2 * center + right;
  const correction =
    Math.abs(denominator) > 1e-10 ? Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denominator)) : 0;
  return { hz: rate / (peak + correction), confidence };
}

const unit = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
const mix = (from, to, amount) => from + (to - from) * amount;
const relativeSlope = (value, previous, dt) => (previous > 0 && dt > 0 ? Math.log(value / previous) / dt : 0);
const trend = (slope, scale) => (Math.abs(slope) < 0.06 ? 0 : Math.tanh(slope / scale));
