import { BlackmanFft } from './pcm-rhythm.mjs';

// Original deterministic test music, not a recording or a source of tempo
// metadata. Labels remain outside frame(); production receives only PCM/FFT.
export const DRUM_FIXTURE_CASES = Object.freeze([
  'alternating-weight',
  'different-drum-bands',
  'dense-double-hits',
  'sustained-tones',
  'polyphonic-syncopation',
  'same-stream-change',
  'same-pulse-sparse-to-dense',
]);

export function drumPcmFixture({ profile = 'alternating-weight', sampleRate = 48000, fftSize = 2048 } = {}) {
  if (!DRUM_FIXTURE_CASES.includes(profile)) throw new TypeError(`Unknown drum fixture: ${profile}`);
  const seconds = profile === 'polyphonic-syncopation' || profile === 'same-pulse-sparse-to-dense' ? 12 : 10;
  const samples = new Float32Array(Math.ceil(seconds * sampleRate));
  const hits = [];
  let seed = 59273;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  const voices = {
    thump: (age) =>
      (Math.sin(2 * Math.PI * (52 * age + 3.8 * (1 - Math.exp(-age * 35)))) +
        Math.sin(2 * Math.PI * 1700 * age) * Math.exp(-age * 130) * 0.045) *
      Math.exp(-age * 22),
    snap: (age) => (noise() * 0.58 + Math.sin(2 * Math.PI * 760 * age) * 0.42) * Math.exp(-age * 39),
    tick: (age) => (noise() * 0.18 + Math.sin(2 * Math.PI * 7800 * age) * 0.82) * Math.exp(-age * 95),
  };
  function add(start, duration, gain, voice) {
    const first = Math.max(0, Math.ceil(start * sampleRate));
    const last = Math.min(samples.length, Math.ceil((start + duration) * sampleRate));
    for (let index = first; index < last; index++) samples[index] += gain * voice(index / sampleRate - start);
  }
  function hit(time, kind, gain, role = 'primary') {
    hits.push({ time, kind, gain, role });
    add(time, kind === 'thump' ? 0.28 : 0.16, gain, voices[kind]);
  }
  if (profile === 'alternating-weight') {
    for (let i = 0; i < 14; i++)
      hit(0.45 + i * 0.65, 'thump', i % 2 ? 0.48 : 0.105, i % 2 ? 'heavy' : 'light');
  } else if (profile === 'different-drum-bands') {
    for (let i = 0; i < 15; i++) {
      const kind = ['thump', 'snap', 'tick'][i % 3];
      hit(0.45 + i * 0.6, kind, kind === 'tick' ? 0.045 : 0.24);
    }
  } else if (profile === 'dense-double-hits') {
    for (let group = 0; group < 8; group++) {
      const time = 0.5 + group;
      const gap = [0.08, 0.12, 0.18, 0.08][group % 4];
      hit(time, 'snap', 0.25, 'first');
      hit(time + gap, 'snap', 0.2, 'second');
    }
  } else if (profile === 'sustained-tones') {
    add(0.5, 8, 0.07, (age) => {
      const envelope = Math.min(1, age / 0.22, Math.max(0, (8 - age) / 0.3));
      return envelope * (Math.sin(2 * Math.PI * 110 * age) + Math.sin(2 * Math.PI * 330 * age) * 0.3);
    });
  } else if (profile === 'same-stream-change') {
    for (let i = 0; i < 16; i++)
      hit(
        0.45 + i * 0.48,
        i < 12 ? 'thump' : 'snap',
        i < 6 ? 0.11 : 0.44,
        i < 6 ? 'light-section' : i < 12 ? 'heavy-section' : 'changed-timbre',
      );
  } else if (profile === 'same-pulse-sparse-to-dense') {
    for (let i = 0; i < 23; i++) {
      const time = 0.45 + i * 0.5;
      hit(time, 'thump', 0.24, time < 6 ? 'sparse-primary' : 'dense-primary');
      if (time >= 6)
        for (const part of [0.25, 0.5, 0.75]) hit(time + 0.5 * part, 'tick', 0.03, 'dense-subdivision');
    }
    add(0, seconds, 0.008, (age) => Math.sin(2 * Math.PI * 220 * age) * Math.min(1, age / 0.25));
  } else {
    // Kick and snare share some attacks; hats and shifted notes occupy other
    // subdivisions. Unmerged labels do not pretend coincident hits are two
    // distinguishable frame-level detector events.
    for (let i = 0; i < 22; i++) {
      const time = 0.45 + i * 0.49;
      const kind = i % 4 === 1 || i % 4 === 3 ? 'snap' : 'thump';
      hit(time, kind, kind === 'thump' ? 0.32 : 0.22, 'primary');
      for (const part of [0.25, 0.5, 0.75])
        hit(time + 0.49 * part, 'tick', part === 0.5 ? 0.032 : 0.019, 'subdivision');
      const note = [220, 293.66, 329.63, 261.63][i % 4];
      add(
        time + (i % 3 === 1 ? 0.12 : 0),
        0.65,
        0.04,
        (age) =>
          (Math.sin(2 * Math.PI * note * age) + Math.sin(2 * Math.PI * note * 2 * age) * 0.22) *
          Math.min(1, age / 0.055) *
          Math.exp(-age * 5),
      );
    }
    add(0, seconds, 0.01, (age) => Math.sin(2 * Math.PI * 164.81 * age) * Math.min(1, age / 0.25));
  }
  hits.sort((a, b) => a.time - b.time);
  const fft = new BlackmanFft(fftSize),
    wave = new Float32Array(fftSize),
    spectrum = new Float32Array(fftSize / 2);
  return {
    profile,
    sampleRate,
    fftSize,
    seconds,
    hits,
    samples,
    frame(time) {
      const end = Math.min(samples.length, Math.max(0, Math.floor(time * sampleRate)));
      const start = Math.max(0, end - fftSize);
      wave.fill(0);
      wave.set(samples.subarray(start, end), fftSize - (end - start));
      let square = 0;
      for (const value of wave) square += value * value;
      // Deliberately raw magnitudes. The production attack path uses its own
      // causal detector and must not inherit a display analyser's smoothing.
      fft.process(wave, spectrum);
      return { time, spectrum, wave, rms: Math.sqrt(square / fftSize) };
    },
  };
}

export function pcm16Wav(fixture) {
  const bytes = Buffer.alloc(44 + fixture.samples.length * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(fixture.sampleRate, 24);
  bytes.writeUInt32LE(fixture.sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(fixture.samples.length * 2, 40);
  for (let i = 0; i < fixture.samples.length; i++)
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, fixture.samples[i])) * 32767), 44 + i * 2);
  return bytes;
}
