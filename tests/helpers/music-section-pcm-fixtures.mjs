import { BlackmanFft } from './pcm-rhythm.mjs';

// Original test arrangements. Section labels are independently authored scoring
// references. Only samples and frame time enter production signal processing.
export const MUSIC_SECTION_CASES = Object.freeze([
  'steady-dj',
  'periodic-heavy',
  'short-fill',
  'light-to-strong',
  'fall-and-rise',
  'gain-only',
  'compressed-layer-rise',
]);

export function musicSectionPcmFixture({ profile = 'steady-dj', sampleRate = 48000, fftSize = 2048 } = {}) {
  if (!MUSIC_SECTION_CASES.includes(profile)) throw new TypeError(`Unknown section fixture: ${profile}`);
  const seconds = profile === 'fall-and-rise' ? 35 : 25;
  const samples = new Float32Array(Math.ceil(seconds * sampleRate));
  const changes =
    profile === 'light-to-strong' || profile === 'compressed-layer-rise'
      ? [{ time: 7, until: seconds, role: 'sustained-rise' }]
      : profile === 'fall-and-rise'
        ? [
            { time: 7, until: 16, role: 'first-rise' },
            { time: 25, until: seconds, role: 'second-rise' },
          ]
        : [];
  const beats = [];
  const period = profile === 'periodic-heavy' ? 0.65 : 0.5;
  for (let time = 0.25; time < seconds; time += period) beats.push(time);
  let seed = 18437;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  const strongAt = (time) =>
    profile === 'steady-dj' ||
    (profile === 'light-to-strong' && time >= 7) ||
    (profile === 'compressed-layer-rise' && time >= 7) ||
    (profile === 'fall-and-rise' && ((time >= 7 && time < 16) || time >= 25));
  const gainAt = (time) => (profile === 'gain-only' && time >= 7 ? 3 : 1);
  function add(start, duration, voice) {
    const first = Math.max(0, Math.ceil(start * sampleRate));
    const last = Math.min(samples.length, Math.ceil((start + duration) * sampleRate));
    for (let index = first; index < last; index++) {
      const time = index / sampleRate;
      samples[index] += gainAt(time) * voice(time - start, time);
    }
  }
  // Persistent harmonic backing prevents drum tails from becoming artificial
  // silence/reset evidence. No envelope is synthesized from detector output.
  add(0, seconds, (age, time) => {
    const attack = Math.min(1, age / 0.15);
    if (profile === 'periodic-heavy') return Math.sin(time * Math.PI * 2 * 220) * 0.009 * attack;
    const strong = strongAt(time);
    const gain = strong ? 0.09 : 0.024;
    const body = Math.sin(time * Math.PI * 2 * 164.81) + Math.sin(time * Math.PI * 2 * 329.62) * 0.28;
    const layer = strong
      ? Math.sin(time * Math.PI * 2 * 659.25) * 0.42 + Math.sin(time * Math.PI * 2 * 1318.5) * 0.22
      : Math.sin(time * Math.PI * 2 * 440) * 0.06;
    return (body + layer) * gain * attack;
  });
  for (let index = 0; index < beats.length; index++) {
    const time = beats[index];
    const strong = strongAt(time);
    const kickGain = profile === 'periodic-heavy' ? 0.5 : strong ? 0.39 : 0.14;
    add(time, 0.32, (age) => {
      const body = Math.sin(Math.PI * 2 * (52 * age + 3.8 * (1 - Math.exp(-age * 35))));
      return body * Math.exp(-age * 19) * kickGain;
    });
    if (profile !== 'periodic-heavy') {
      const snareGain = strong ? 0.12 : 0.035;
      if (index % 2)
        add(
          time,
          0.17,
          (age) =>
            (noise() * 0.65 + Math.sin(Math.PI * 2 * 820 * age) * 0.35) * Math.exp(-age * 34) * snareGain,
        );
      const parts = strong ? [0.25, 0.5, 0.75] : [0.5];
      for (const part of parts)
        add(
          time + period * part,
          0.075,
          (age) =>
            (noise() * 0.18 + Math.sin(Math.PI * 2 * 7800 * age) * 0.82) *
            Math.exp(-age * 85) *
            (strong ? 0.031 : 0.012),
        );
      // Ordinary DJ accents vary within the same arrangement. They are not
      // labelled section changes, even at the loudest periodic downbeat.
      if (strong && index % 8 === 0) add(time, 0.11, (age) => noise() * Math.exp(-age * 45) * 0.035);
    }
  }
  if (profile === 'short-fill') {
    for (let index = 0; index < 5; index++)
      add(
        9 + index * 0.06,
        0.12,
        (age) => (noise() * 0.6 + Math.sin(Math.PI * 2 * 850 * age) * 0.4) * Math.exp(-age * 31) * 0.45,
      );
  }
  if (profile === 'compressed-layer-rise') {
    // Half-second power normalization emulates a compressed mix: the second
    // arrangement gains layers/subdivisions without gaining average loudness.
    // This uses source samples only, never detector descriptors or labels.
    const blockLength = Math.round(sampleRate * 0.5);
    for (let start = 0; start < samples.length; start += blockLength) {
      const end = Math.min(samples.length, start + blockLength);
      let square = 0;
      for (let index = start; index < end; index++) square += samples[index] ** 2;
      const gain = 0.08 / Math.max(0.0001, Math.sqrt(square / (end - start)));
      for (let index = start; index < end; index++) samples[index] *= gain;
    }
  }
  // Identical samples are used for WAV and offline tests, including clipping.
  for (let index = 0; index < samples.length; index++)
    samples[index] = Math.max(-0.98, Math.min(0.98, samples[index]));
  return pcmSectionFixture({ profile, sampleRate, fftSize, seconds, samples, changes });
}

export function pcmSectionFixture({
  profile,
  sampleRate,
  fftSize = 2048,
  seconds,
  samples,
  changes = [],
  labelsAvailable = true,
}) {
  const fft = new BlackmanFft(fftSize);
  const wave = new Float32Array(fftSize);
  const rawSpectrum = new Float32Array(fftSize / 2);
  const spectrum = new Float32Array(fftSize / 2);
  return {
    profile,
    sampleRate,
    fftSize,
    seconds,
    samples,
    changes,
    labelsAvailable,
    frame(time) {
      const end = Math.min(samples.length, Math.max(0, Math.floor(time * sampleRate)));
      const start = Math.max(0, end - fftSize);
      wave.fill(0);
      wave.set(samples.subarray(start, end), fftSize - (end - start));
      let square = 0;
      for (const value of wave) square += value * value;
      fft.process(wave, rawSpectrum);
      for (let bin = 0; bin < spectrum.length; bin++)
        spectrum[bin] = spectrum[bin] * 0.45 + rawSpectrum[bin] * 0.55;
      return { time, spectrum, rawSpectrum, wave, rms: Math.sqrt(square / fftSize) };
    },
  };
}
