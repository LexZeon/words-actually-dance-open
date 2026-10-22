/** Original procedural music. No external recording, song melody, or reference BPM enters analysis. */
export function createDemoPcm(profile = 'balanced', sampleRate = 48000) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
    throw new Error('Invalid demo sample rate.');
  const style = ['bass', 'balanced', 'bright'].includes(profile) ? profile : 'balanced';
  const bpm = { bass: 90, balanced: 108, bright: 126 }[style];
  const step = 60 / bpm;
  const samples = new Float32Array(Math.ceil(step * 16 * sampleRate));
  let seed = 3251;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  const roots = [110, 130.8128, 87.3071, 97.9989];
  const ratios = [1, 1.189207, 1.498307];
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate,
      position = t / step,
      beat = Math.floor(position),
      p = t % step;
    const root = roots[Math.floor(beat / 4) % roots.length];
    const half = t % (step / 2),
      quarter = t % (step / 4);
    const phrase = beat < 8 ? 0.72 : 1;
    const kickWeight = style === 'bass' ? [1, 0.15, 0.8, 0.2][beat % 4] : style === 'bright' ? 0.52 : 0.7;
    const kick =
      Math.sin(2 * Math.PI * (45 * p + 9 * (1 - Math.exp(-p * 25)))) *
      Math.exp(-p * (style === 'bass' ? 10 : 20)) *
      kickWeight;
    const clap =
      beat % 4 === 1 || beat % 4 === 3 ? random() * Math.exp(-p * 37) * (style === 'bass' ? 0.13 : 0.16) : 0;
    const hats =
      (Math.sin(2 * Math.PI * 6900 * t) + random() * 0.55) *
      Math.exp(-(style === 'bright' ? quarter : half) * 100) *
      (style === 'bright' ? 0.09 : 0.025);
    let tone = 0;
    if (style === 'bass') {
      const bend = (root / 2) * (1 + 0.08 * Math.exp(-p * 16));
      tone = Math.sin(2 * Math.PI * bend * t) * Math.exp(-p * 5) * 0.13;
      if (beat >= 8) tone += Math.sin(2 * Math.PI * root * 2 * t) * Math.exp(-half * 18) * 0.025;
    } else if (style === 'balanced') {
      for (const ratio of ratios) {
        const f = root * ratio * 2;
        tone +=
          (Math.sin(2 * Math.PI * f * t) + 0.2 * Math.sin(2 * Math.PI * f * 2 * t)) *
          0.028 *
          (0.6 + 0.4 * (1 - Math.exp(-p * 7)));
      }
      tone += Math.sin(2 * Math.PI * root * t) * (0.035 + 0.035 * Math.exp(-half * 9));
    } else {
      const note = [1, 1.498307, 2, 1.189207, 1.498307, 2.378414, 2, 1.498307][Math.floor(position * 2) % 8];
      const envelope = (1 - Math.exp(-half * 350)) * Math.exp(-half * 16);
      const f = root * note * 2;
      tone = (Math.sin(2 * Math.PI * f * t) + 0.28 * Math.sin(2 * Math.PI * f * 3 * t)) * envelope * 0.13;
    }
    const fade = Math.min(1, t / 0.008, (samples.length - i) / (sampleRate * 0.008));
    samples[i] = Math.tanh((kick * 0.48 + clap + hats + tone) * phrase) * 0.48 * fade;
  }
  return { samples, bpm, profile: style, duration: samples.length / sampleRate };
}
