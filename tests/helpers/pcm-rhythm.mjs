// Original deterministic PCM fixture and radix-2 Blackman FFT. Timing labels
// belong only to test evaluation; they are never passed to the music analyser.
export function pcmRhythm({
  seconds = 24,
  offset = 0.175,
  bpm = 120,
  changeAt,
  nextBpm = 80,
  subdivisionGain = 0,
  mainMidGain = 0,
  bassGain = 1,
} = {}) {
  const sampleRate = 48000,
    fftSize = 2048;
  const hits = [];
  for (let time = offset; time < (changeAt ?? seconds); time += 60 / bpm) hits.push(time);
  if (changeAt !== undefined) for (let time = changeAt; time < seconds; time += 60 / nextBpm) hits.push(time);
  const samples = new Float32Array(Math.ceil(seconds * sampleRate));
  const subdivisionHits = hits.map(
    (hit) => hit + 30 / (changeAt !== undefined && hit >= changeAt ? nextBpm : bpm),
  );
  let last = -Infinity,
    cursor = 0,
    lastSubdivision = -Infinity,
    subdivisionCursor = 0;
  for (let index = 0; index < samples.length; index++) {
    const time = index / sampleRate;
    while (hits[cursor] <= time) last = hits[cursor++];
    while (subdivisionHits[subdivisionCursor] <= time) lastSubdivision = subdivisionHits[subdivisionCursor++];
    const age = time - last;
    const kick = Number.isFinite(age)
      ? Math.sin(2 * Math.PI * (55 * age + 5 * (1 - Math.exp(-age * 30)))) * Math.exp(-age * 20) * 0.48
      : 0;
    const click = Number.isFinite(age)
      ? Math.sin(time * 2 * Math.PI * 5300) * Math.exp(-age * 90) * 0.035
      : 0;
    const mid = Number.isFinite(age)
      ? Math.sin(time * 2 * Math.PI * 440) * Math.exp(-age * 22) * mainMidGain
      : 0;
    const offAge = time - lastSubdivision;
    const subdivision = Number.isFinite(offAge)
      ? Math.sin(time * 2 * Math.PI * 880) * Math.exp(-offAge * 30) * subdivisionGain
      : 0;
    samples[index] = kick * bassGain + click + mid + subdivision + 0.008 * Math.sin(time * 2 * Math.PI * 220);
  }
  const fft = new BlackmanFft(fftSize),
    wave = new Float32Array(fftSize),
    raw = new Float32Array(fftSize / 2),
    spectrum = new Float32Array(fftSize / 2);
  return {
    hits,
    subdivisionHits: subdivisionGain > 0 ? subdivisionHits : [],
    sampleRate,
    fftSize,
    seconds,
    frame(time) {
      const end = Math.min(samples.length, Math.floor(time * sampleRate));
      wave.fill(0);
      const start = Math.max(0, end - fftSize);
      wave.set(samples.subarray(start, end), fftSize - (end - start));
      let square = 0;
      for (const value of wave) square += value * value;
      fft.process(wave, raw);
      for (let bin = 0; bin < spectrum.length; bin++) spectrum[bin] = spectrum[bin] * 0.45 + raw[bin] * 0.55;
      return { time, spectrum, wave, rms: Math.sqrt(square / fftSize) };
    },
  };
}

export class BlackmanFft {
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
    this.reverse = Uint16Array.from({ length: size }, (_, i) => {
      let value = 0;
      for (let bit = 0; bit < Math.log2(size); bit++) {
        value = value * 2 + (i & 1);
        i >>= 1;
      }
      return value;
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
