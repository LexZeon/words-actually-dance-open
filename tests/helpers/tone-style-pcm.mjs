import { BlackmanFft } from './pcm-rhythm.mjs';

// Original samples. Profile names/attack references are expectations only;
// the classifier receives the windowed PCM/FFT and computed RMS, never labels.
export function toneStylePcm({
  profile = 'pad',
  seconds = 5,
  sampleRate = 24000,
  fftSize = 1024,
  background = 0.003,
  noteSeconds = Infinity,
} = {}) {
  if (!['pulse', 'pluck', 'lead', 'pad', 'noise', 'drum-weights', 'gradual-attack'].includes(profile))
    throw new TypeError('Unknown original tone fixture');
  const samples = new Float32Array(Math.ceil(seconds * sampleRate));
  const attacks = [];
  const period = profile === 'pulse' ? 0.5 : profile === 'pluck' ? 0.55 : 0.65;
  if (['pulse', 'pluck', 'drum-weights'].includes(profile))
    for (let time = 0.3, index = 0; time < seconds; time += period, index++)
      attacks.push({ time, weight: profile === 'drum-weights' ? (index % 2 ? 0.5 : 0.12) : 1 });
  if (profile === 'gradual-attack') for (const time of [1, 3]) attacks.push({ time, weight: 1 });
  let phase = 0,
    seed = 73814;
  for (let index = 0; index < samples.length; index++) {
    const time = index / sampleRate;
    const pulseAge = time >= 0.3 ? (time - 0.3) % period : -1;
    const backing = Math.sin(time * Math.PI * 2 * 110) * background;
    let value;
    if (profile === 'pulse') {
      const envelope = pulseAge >= 0 && pulseAge < 0.25 ? Math.min(1, pulseAge / 0.006) : 0;
      value = backing + Math.sin(time * Math.PI * 2 * 440) * envelope * 0.18;
    } else if (profile === 'pluck') {
      const envelope =
        pulseAge >= 0 && pulseAge < noteSeconds
          ? Math.min(1, pulseAge / 0.006) * Math.exp(-pulseAge * 18)
          : 0;
      value =
        backing +
        (Math.sin(time * Math.PI * 2 * 660) + Math.sin(time * Math.PI * 2 * 1320) * 0.25) * envelope * 0.22;
    } else if (profile === 'lead') {
      const frequency = 680 + Math.sin(time * 1.3) * 220;
      phase += (frequency / sampleRate) * Math.PI * 2;
      value =
        (Math.sin(phase) + Math.sin(phase * 2) * 0.4 + Math.sin(phase * 3) * 0.2) *
        Math.min(1, time / 0.15) *
        0.11;
    } else if (profile === 'pad') {
      const envelope = Math.min(1, time / 0.9) * (0.95 + Math.sin(time * 0.6) * 0.05);
      value =
        (Math.sin(time * Math.PI * 2 * 110) +
          Math.sin(time * Math.PI * 2 * 165) * 0.3 +
          Math.sin(time * Math.PI * 2 * 220) * 0.2) *
        envelope *
        0.12;
    } else if (profile === 'noise') {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      value = (seed / 2147483648 - 1) * Math.min(1, time / 0.15) * 0.16;
    } else if (profile === 'gradual-attack') {
      const shot = attacks.filter((attack) => attack.time <= time).at(-1);
      const age = shot ? time - shot.time : -1;
      const growth =
        age < 0
          ? 1
          : age < 0.22
            ? Math.exp(age * 8)
            : age < 0.47
              ? Math.exp(0.22 * 8)
              : age < 0.72
                ? Math.exp((((0.72 - age) * 0.22) / 0.25) * 8)
                : 1;
      value = Math.sin(time * Math.PI * 2 * 660) * 0.035 * growth;
    } else {
      const shot = attacks.filter((attack) => attack.time <= time).at(-1);
      const age = shot ? time - shot.time : -1;
      const body =
        age >= 0 && age < 0.4
          ? Math.sin(Math.PI * 2 * (62 * age + 3 * (1 - Math.exp(-age * 35)))) *
            Math.min(1, age / 0.003) *
            Math.exp(-age * 18) *
            shot.weight
          : 0;
      value = backing + body;
    }
    samples[index] = value;
  }
  const fft = new BlackmanFft(fftSize),
    wave = new Float32Array(fftSize),
    rawSpectrum = new Float32Array(fftSize / 2),
    spectrum = new Float32Array(fftSize / 2);
  return {
    profile,
    seconds,
    sampleRate,
    rate: sampleRate,
    fftSize,
    samples,
    attacks,
    frame(time) {
      const end = Math.min(samples.length, Math.max(0, Math.floor(time * sampleRate)));
      const start = Math.max(0, end - fftSize);
      wave.fill(0);
      wave.set(samples.subarray(start, end), fftSize - (end - start));
      fft.process(wave, rawSpectrum);
      let square = 0;
      for (const value of wave) square += value * value;
      for (let bin = 0; bin < spectrum.length; bin++)
        spectrum[bin] = spectrum[bin] * 0.45 + rawSpectrum[bin] * 0.55;
      return { time, wave, spectrum, rawSpectrum, rms: Math.sqrt(square / fftSize) };
    },
  };
}
