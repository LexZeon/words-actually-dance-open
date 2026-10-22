import { BlackmanFft } from './pcm-rhythm.mjs';

/** Original polyphonic fixture. Score labels exist only outside frame(), and
 * changing the reference labels never changes detector/clock inputs. */
export function complexPcmRhythm({
  seconds = 48,
  offset = 0.175,
  bpm = 128,
  profile = 'syncopated',
  changeAt,
  nextBpm = 86,
  rampAt,
  rampSeconds = 20,
  finalBpm = 132,
  longSections = false,
} = {}) {
  const sampleRate = 48000,
    fftSize = 2048;
  const beats = [],
    samples = new Float32Array(Math.ceil(seconds * sampleRate));
  const tempoAt = (time) => {
    if (changeAt !== undefined && time >= changeAt) return nextBpm;
    if (rampAt !== undefined && time >= rampAt)
      return bpm + (finalBpm - bpm) * Math.min(1, (time - rampAt) / rampSeconds);
    return bpm;
  };
  const sectionAt = (time) =>
    !longSections
      ? profile
      : time < 24
        ? 'weak-drums'
        : time < 48
          ? 'syncopated'
          : time < 56
            ? 'break'
            : 'dense';
  for (let time = offset, index = 0; time < seconds; index++) {
    const tempo = tempoAt(time);
    beats.push({ time, bpm: tempo, period: 60 / tempo, section: sectionAt(time), index });
    const next = time + 60 / tempo;
    time = changeAt !== undefined && time < changeAt && next >= changeAt ? changeAt : next;
  }
  const arrangements = {
    syncopated: { kick: 0.24, bass: 0.08, snare: 0.17, hat: 0.026, lead: 0.05, pad: 0.012 },
    'strong-offbeat': {
      kick: 0.025,
      bass: 0.035,
      snare: 0.2,
      hat: 0.028,
      lead: 0.025,
      pad: 0.008,
      offbeat: 0.28,
    },
    'weak-drums': { kick: 0.007, bass: 0.012, snare: 0.012, hat: 0.009, lead: 0.1, pad: 0.022 },
    swing: { kick: 0.12, bass: 0.065, snare: 0.16, hat: 0.026, lead: 0.05, pad: 0.012 },
    dense: { kick: 0.2, bass: 0.09, snare: 0.23, hat: 0.032, lead: 0.09, pad: 0.015 },
    break: { kick: 0, bass: 0, snare: 0, hat: 0, lead: 0, pad: 0.016 },
  };
  const attacks = [];
  let seed = 18425;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  function add(start, duration, amplitude, voice) {
    if (!amplitude || start >= seconds) return;
    const first = Math.max(0, Math.floor(start * sampleRate));
    const last = Math.min(samples.length, Math.ceil((start + duration) * sampleRate));
    for (let index = first; index < last; index++) {
      const age = index / sampleRate - start;
      samples[index] += amplitude * voice(age, duration);
    }
    attacks.push(start);
  }
  const kick = (age) =>
    Math.sin(2 * Math.PI * (52 * age + 5 * (1 - Math.exp(-age * 29)))) * Math.exp(-age * 20);
  const snare = (age) => (noise() * 0.68 + Math.sin(2 * Math.PI * 180 * age) * 0.32) * Math.exp(-age * 32);
  const hat = (age) => (noise() * 0.65 + Math.sin(2 * Math.PI * 6700 * age) * 0.35) * Math.exp(-age * 85);
  const notes = [220, 261.63, 329.63, 293.66, 392, 329.63, 246.94, 293.66];
  for (const beat of beats) {
    const arrangement = arrangements[beat.section] || arrangements.syncopated;
    const { time, period, index } = beat;
    const swing = beat.section === 'swing' ? 2 / 3 : 1 / 2;
    // Strong and weak quarter-note clues coexist with 8th/16th syncopation.
    const fullKick = index % 2 === 0 || index % 8 === 3;
    add(time, 0.32, arrangement.kick * (fullKick ? 1 : 0.18), kick);
    const bassFrequency = index % 8 < 4 ? 55 : 73.42;
    add(
      time,
      period * 0.9,
      arrangement.bass,
      (age) =>
        (Math.sin(2 * Math.PI * bassFrequency * age) +
          Math.sin(2 * Math.PI * bassFrequency * 2 * age) * 0.3) *
        Math.min(1, age / 0.009) *
        Math.exp(-age / (period * 0.28)),
    );
    if (index % 4 === 1 || index % 4 === 3) add(time, 0.21, arrangement.snare, snare);
    for (const subdivision of [0, swing, 0.75])
      add(time + period * subdivision, 0.11, arrangement.hat * (subdivision ? 1 : 0.6), hat);
    if (arrangement.offbeat)
      add(
        time + period / 2,
        0.2,
        arrangement.offbeat,
        (age) => Math.sin(2 * Math.PI * 880 * age) * Math.exp(-age * 30),
      );
    const note = notes[index % notes.length];
    const melodyOnset = beat.section === 'weak-drums' ? time : time + period * (index % 3 === 1 ? 0.25 : 0);
    add(
      melodyOnset,
      period * 1.05,
      arrangement.lead,
      (age, duration) =>
        (Math.sin(2 * Math.PI * note * age + 0.018 * Math.sin(2 * Math.PI * 5.7 * age)) +
          Math.sin(2 * Math.PI * note * 2 * age) * 0.25) *
        Math.min(1, age / 0.035) *
        Math.exp(-age / (duration * 0.4)),
    );
    if (index % 4 === 0) {
      const chord = index % 8 < 4 ? 220 : 293.66;
      add(
        time,
        period * 4.2,
        arrangement.pad,
        (age, duration) =>
          (Math.sin(2 * Math.PI * chord * age) + Math.sin(2 * Math.PI * chord * 1.5 * age)) *
          Math.min(1, age / 0.12, Math.max(0, (duration - age) / 0.2)),
      );
    }
    if ((beat.section === 'syncopated' || beat.section === 'dense') && index % 4 === 2)
      add(
        time + period * 0.75,
        0.26,
        arrangement.bass * 0.8,
        (age) => Math.sin(2 * Math.PI * 82.41 * age) * Math.exp(-age * 18),
      );
  }
  for (let index = 0; index < samples.length; index++)
    samples[index] = Math.tanh(samples[index] * 1.1) * 0.55;
  const fft = new BlackmanFft(fftSize),
    wave = new Float32Array(fftSize),
    raw = new Float32Array(fftSize / 2),
    spectrum = new Float32Array(fftSize / 2);
  return {
    beats,
    attacks: attacks.sort((left, right) => left - right),
    sampleRate,
    fftSize,
    seconds,
    frame(time) {
      const end = Math.min(samples.length, Math.max(0, Math.floor(time * sampleRate)));
      const start = Math.max(0, end - fftSize);
      wave.fill(0);
      wave.set(samples.subarray(start, end), fftSize - (end - start));
      let square = 0;
      for (const sample of wave) square += sample * sample;
      fft.process(wave, raw);
      for (let bin = 0; bin < spectrum.length; bin++) spectrum[bin] = spectrum[bin] * 0.45 + raw[bin] * 0.55;
      // The only analyzer input: no BPM, known beats, section or profile labels.
      return { time, spectrum, wave, rms: Math.sqrt(square / fftSize) };
    },
  };
}
