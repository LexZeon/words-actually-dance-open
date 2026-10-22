import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { BeatDetector } from '../src/audio/beat-detector.js';
import { BeatClock } from '../src/audio/beat-clock.js';
import { MotionFeatures } from '../src/audio/motion-features.js';

// Local-only offline analysis. Audio never leaves this process; reference BPM
// is used below for evaluation and is NEVER passed into any analysis module.
function main() {
  const { file, options } = parseArguments(process.argv.slice(2));
  if (!file || options.help) {
    console.log(
      'node scripts/audio-benchmark.mjs <local.wav> [--reference-bpm 120] [--fps 60] [--max-seconds 120] [--pitch false] [--output artifacts/result.json]',
    );
    if (!file && !options.help) process.exitCode = 1;
  } else {
    try {
      const recording = decodeWav(fs.readFileSync(file));
      const sampleRate = recording.sampleRate;
      const fftSize = 2048;
      const fps = numberOption(options.fps, 60, 20, 240);
      const maxSeconds = numberOption(
        options['max-seconds'],
        recording.samples.length / sampleRate,
        0.1,
        3600,
      );
      const referenceBpm =
        options['reference-bpm'] === undefined ? null : numberOption(options['reference-bpm'], null, 20, 400);
      const pitchEnabled = options.pitch !== 'false';
      const smoothing = 0.45;
      const hop = Math.max(1, Math.round(sampleRate / fps));
      const limit = Math.min(recording.samples.length, Math.floor(maxSeconds * sampleRate));
      const fft = new BlackmanFft(fftSize);
      const detector = new BeatDetector({ sampleRate, fftSize });
      const clock = new BeatClock();
      const motion = new MotionFeatures({ sampleRate, fftSize, estimatePitch: pitchEnabled });
      const wave = new Float32Array(fftSize);
      const spectrum = new Float32Array(fftSize / 2);
      const rawSpectrum = new Float32Array(fftSize / 2);
      const frameCosts = [],
        motionCosts = [],
        pitchCosts = [],
        confidentBpm = [];
      const candidates = [],
        analysisSources = {};
      const counts = {
        frames: 0,
        observedBeats: 0,
        confidentFrames: 0,
        silentFrames: 0,
        internalEvents: 0,
        internalBeats: 0,
        subdivisions: 0,
        continuityErrors: 0,
      };
      const motionTotals = {
        amplitude: 0,
        noisiness: 0,
        centroidHz: 0,
        pitchConfidence: 0,
        trustedPitchFrames: 0,
      };
      let previousStep = -1,
        lastCandidate = 0,
        features = {},
        descriptors = {},
        firstTime = null;
      const started = performance.now();
      for (let end = fftSize; end <= limit; end += hop) {
        const frameStarted = performance.now();
        wave.set(recording.samples.subarray(end - fftSize, end));
        let power = 0;
        for (const sample of wave) power += sample * sample;
        const rms = Math.sqrt(power / fftSize);
        fft.process(wave, rawSpectrum);
        for (let bin = 0; bin < spectrum.length; bin++)
          spectrum[bin] = spectrum[bin] * smoothing + rawSpectrum[bin] * (1 - smoothing);
        const time = end / sampleRate;
        firstTime ??= time;
        features = detector.process({ spectrum, time, rms });
        const analysisSource = detector.getDiagnostics().source;
        analysisSources[analysisSource] = (analysisSources[analysisSource] || 0) + 1;
        const beforePitch = motion.lastPitchTime;
        const motionStarted = performance.now();
        descriptors = motion.process({ spectrum, wave, time, rms, beatFeatures: features });
        const motionCost = performance.now() - motionStarted;
        motionCosts.push(motionCost);
        if (motion.lastPitchTime !== beforePitch && Number.isFinite(motion.lastPitchTime))
          pitchCosts.push(motionCost);
        counts.frames++;
        counts.observedBeats += features.beat ? 1 : 0;
        counts.silentFrames += features.silent ? 1 : 0;
        if (features.confidence >= 0.3 && features.bpm > 0) {
          counts.confidentFrames++;
          confidentBpm.push(features.bpm);
        }
        if (
          features.bpm > 0 &&
          (!lastCandidate || Math.abs(features.bpm - lastCandidate) >= Math.max(3, lastCandidate * 0.05))
        ) {
          candidates.push({
            time: rounded(time),
            bpm: rounded(features.bpm),
            confidence: rounded(features.confidence),
          });
          lastCandidate = features.bpm;
        }
        for (const event of clock.update(features, time)) {
          const step = event.beatIndex * 4 + event.subdivisionIndex;
          if (step !== previousStep + 1) counts.continuityErrors++;
          previousStep = step;
          counts.internalEvents++;
          if (event.kind === 'beat') counts.internalBeats++;
          else counts.subdivisions++;
        }
        for (const key of ['amplitude', 'noisiness', 'centroidHz', 'pitchConfidence'])
          motionTotals[key] += descriptors[key];
        if (descriptors.pitchHz > 0) motionTotals.trustedPitchFrames++;
        frameCosts.push(performance.now() - frameStarted);
      }
      const elapsed = performance.now() - started;
      const medianBpm = median(confidentBpm);
      const analyzedSeconds = Math.max(0, limit / sampleRate - (firstTime || 0));
      const summary = {
        file: path.resolve(file),
        format: recording.format,
        sampleRate,
        channels: recording.channels,
        fftSize,
        fftWindow: 'Blackman',
        fftSmoothing: smoothing,
        requestedAnalysisFps: fps,
        analyzedSeconds: rounded(analyzedSeconds),
        pitchEnabled,
        counts,
        detector: {
          finalBpm: rounded(features.bpm || 0),
          finalConfidence: rounded(features.confidence || 0),
          medianConfidentBpm: rounded(medianBpm),
          confidentFraction: rounded(counts.confidentFrames / Math.max(1, counts.frames)),
          bpmRange: confidentBpm.length
            ? [rounded(Math.min(...confidentBpm)), rounded(Math.max(...confidentBpm))]
            : [0, 0],
          candidateChanges: candidates,
          analysisSources,
        },
        internalClock: clock.getState(),
        motion: Object.fromEntries(
          Object.entries(motionTotals).map(([key, value]) => [
            key,
            key === 'trustedPitchFrames' ? value : rounded(value / Math.max(1, counts.frames)),
          ]),
        ),
        performance: {
          elapsedMs: rounded(elapsed),
          realtimeFactor: rounded(analyzedSeconds / Math.max(0.001, elapsed / 1000)),
          frame: costSummary(frameCosts),
          motion: costSummary(motionCosts),
          pitchEstimateFrames: costSummary(pitchCosts),
        },
        evaluation: referenceBpm ? evaluateTempo(medianBpm, referenceBpm) : null,
        limitations: [
          'Offline PCM/Blackman FFT approximation; not a browser rendering FPS measurement.',
          'A confident half/double-time candidate is reported, not corrected using reference metadata.',
          'Pitch is a periodicity proxy; polyphonic music can remain ambiguous.',
        ],
      };
      const json = JSON.stringify(summary, null, 2);
      if (options.output) {
        fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
        fs.writeFileSync(options.output, json + '\n');
      }
      console.log(json);
    } catch (error) {
      console.error('Audio benchmark failed: ' + error.message);
      process.exitCode = 1;
    }
  }
}

function parseArguments(args) {
  const options = {};
  let file;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      if (file) throw new Error('Only one WAV file is accepted.');
      file = arg;
      continue;
    }
    const [key, inline] = arg.slice(2).split('=', 2);
    if (key === 'help') options.help = true;
    else options[key] = inline ?? args[++index];
  }
  return { file, options };
}

function numberOption(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum)
    throw new Error('Invalid numeric option: ' + value);
  return number;
}

function decodeWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Expected a little-endian RIFF WAV file.');
  let fmt, data;
  for (let cursor = 12; cursor + 8 <= buffer.length;) {
    const id = buffer.toString('ascii', cursor, cursor + 4),
      size = buffer.readUInt32LE(cursor + 4),
      offset = cursor + 8;
    if (offset + size > buffer.length) throw new Error('Truncated WAV chunk.');
    if (id === 'fmt ') fmt = { offset, size };
    if (id === 'data') data ??= { offset, size };
    cursor = offset + size + (size % 2);
  }
  if (!fmt || !data || fmt.size < 16) throw new Error('WAV is missing format/data chunks.');
  let format = buffer.readUInt16LE(fmt.offset);
  const channels = buffer.readUInt16LE(fmt.offset + 2),
    sampleRate = buffer.readUInt32LE(fmt.offset + 4);
  const blockAlign = buffer.readUInt16LE(fmt.offset + 12),
    bits = buffer.readUInt16LE(fmt.offset + 14);
  if (format === 0xfffe && fmt.size >= 40) format = buffer.readUInt16LE(fmt.offset + 24);
  if (
    ![1, 3].includes(format) ||
    ![8, 16, 24, 32, 64].includes(bits) ||
    !channels ||
    !sampleRate ||
    !blockAlign
  )
    throw new Error('Unsupported WAV encoding. Use PCM16/24/32 or Float32 WAV.');
  const bytes = bits / 8,
    frames = Math.floor(data.size / blockAlign),
    samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      const offset = data.offset + frame * blockAlign + channel * bytes;
      let value;
      if (format === 3)
        value = bits === 64 ? buffer.readDoubleLE(offset) : bits === 32 ? buffer.readFloatLE(offset) : NaN;
      else if (bits === 8) value = (buffer.readUInt8(offset) - 128) / 128;
      else if (bits === 16) value = buffer.readInt16LE(offset) / 32768;
      else if (bits === 24) value = buffer.readIntLE(offset, 3) / 8388608;
      else if (bits === 32) value = buffer.readInt32LE(offset) / 2147483648;
      else throw new Error('Unsupported integer WAV precision.');
      sum += Number.isFinite(value) ? value : 0;
    }
    samples[frame] = Math.max(-1, Math.min(1, sum / channels));
  }
  return { samples, sampleRate, channels, format: (format === 3 ? 'float' : 'pcm') + bits };
}

class BlackmanFft {
  constructor(size) {
    this.size = size;
    this.real = new Float64Array(size);
    this.imag = new Float64Array(size);
    this.window = Float64Array.from(
      { length: size },
      (_, i) => 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / size) + 0.08 * Math.cos((4 * Math.PI * i) / size),
    );
    this.cos = Float64Array.from({ length: size / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / size));
    this.sin = Float64Array.from({ length: size / 2 }, (_, i) => -Math.sin((2 * Math.PI * i) / size));
    const bits = Math.log2(size);
    this.reverse = Uint16Array.from({ length: size }, (_, i) => {
      let reversed = 0;
      for (let bit = 0; bit < bits; bit++) {
        reversed = reversed * 2 + (i & 1);
        i >>= 1;
      }
      return reversed;
    });
  }
  process(wave, result) {
    const n = this.size,
      real = this.real,
      imag = this.imag;
    imag.fill(0);
    for (let i = 0; i < n; i++) real[this.reverse[i]] = wave[i] * this.window[i];
    for (let length = 2; length <= n; length *= 2) {
      const half = length / 2,
        stride = n / length;
      for (let base = 0; base < n; base += length) {
        for (let offset = 0; offset < half; offset++) {
          const left = base + offset,
            right = left + half,
            twiddle = offset * stride;
          const tr = real[right] * this.cos[twiddle] - imag[right] * this.sin[twiddle];
          const ti = real[right] * this.sin[twiddle] + imag[right] * this.cos[twiddle];
          real[right] = real[left] - tr;
          imag[right] = imag[left] - ti;
          real[left] += tr;
          imag[left] += ti;
        }
      }
    }
    for (let bin = 0; bin < result.length; bin++) result[bin] = Math.hypot(real[bin], imag[bin]) / n;
  }
}

function costSummary(values) {
  if (!values.length) return { frames: 0, meanMs: 0, p95Ms: 0, maxMs: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    frames: values.length,
    meanMs: rounded(values.reduce((sum, value) => sum + value, 0) / values.length),
    p95Ms: rounded(sorted[Math.floor(sorted.length * 0.95)]),
    maxMs: rounded(sorted.at(-1)),
  };
}
function evaluateTempo(bpm, referenceBpm) {
  const errors = [0.5, 1, 2].map((ratio) => ({
    ratio,
    errorPercent: bpm ? (Math.abs(bpm - referenceBpm * ratio) / (referenceBpm * ratio)) * 100 : null,
  }));
  const best = [...errors].sort((a, b) => (a.errorPercent ?? Infinity) - (b.errorPercent ?? Infinity))[0];
  return {
    referenceBpm,
    measuredMedianBpm: rounded(bpm),
    directErrorPercent: errors[1].errorPercent === null ? null : rounded(errors[1].errorPercent),
    bestOctaveRatio: bpm ? best.ratio : null,
    bestOctaveErrorPercent: best.errorPercent === null ? null : rounded(best.errorPercent),
  };
}
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
function rounded(value) {
  return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : 0;
}

main();
