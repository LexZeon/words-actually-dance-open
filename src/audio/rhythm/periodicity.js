/** Original JS periodicity estimators; concepts referenced in docs/open-source-references.md. */
export function estimateAmplitudeRhythm(history) {
  if (history.length < 50) return null;
  const start = history[0].time,
    span = history.at(-1).time - start;
  if (span < 2) return null;
  const mean = average(history.map((entry) => entry.value));
  const values = history.map((entry) => entry.value - mean);
  const square = values.reduce((sum, value) => sum + value * value, 0);
  if (Math.sqrt(square / history.length) < Math.max(1e-7, mean * 0.12)) return null;
  let best = null;
  for (let bpm = 55; bpm <= 190; bpm++) {
    const period = 60 / bpm;
    if (span < period * 3.5) continue;
    const { score, origin } = sinusoidFit(history, values, square, bpm);
    if (!best || score > best.score) best = { bpm, score, origin };
  }
  if (!best || best.score < 0.2) return null;
  const support = Math.min(1, span / ((60 / best.bpm) * 6));
  const octaveBpm = best.bpm * 2 <= 190 ? best.bpm * 2 : best.bpm / 2 >= 55 ? best.bpm / 2 : null;
  const octaveScore = octaveBpm ? sinusoidFit(history, values, square, octaveBpm).score : 0;
  return {
    ...best,
    confidence: unit((best.score - 0.1) / 0.45) * support,
    octaveAlternativeBpm: octaveBpm,
    octaveScore,
  };
}

/** Short-window autocorrelation retains narrow melodic-change pulses that
 * Fourier-only amplitude tracking misses. No tempo/song metadata is used. */
export function estimateNoveltyRhythm(history) {
  if (history.length < 50) return null;
  const start = history[0].time,
    span = history.at(-1).time - start;
  if (span < 2.2) return null;
  const rate = 50,
    length = Math.floor(span * rate);
  const signal = new Float64Array(length);
  let cursor = 0;
  for (let i = 0; i < length; i++) {
    const time = start + i / rate;
    while (cursor + 1 < history.length && history[cursor + 1].time < time) cursor++;
    const left = history[cursor],
      right = history[Math.min(cursor + 1, history.length - 1)];
    const fraction = right.time > left.time ? unit((time - left.time) / (right.time - left.time)) : 0;
    signal[i] = left.value + (right.value - left.value) * fraction;
  }
  const mean = average(signal);
  let square = 0;
  for (let i = 0; i < length; i++) {
    signal[i] -= mean;
    square += signal[i] ** 2;
  }
  if (Math.sqrt(square / length) < Math.max(0.002, mean * 0.18)) return null;
  let best = null;
  const tempoCandidates = [];
  for (let bpm = 55; bpm <= 190; bpm++) {
    const period = 60 / bpm;
    if (span < period * 3.5) continue;
    const lag = rate * period,
      integer = Math.floor(lag),
      fraction = lag - integer;
    let dot = 0,
      aa = 0,
      bb = 0;
    for (let i = 0; i + integer + 1 < length; i++) {
      const a = signal[i],
        b = signal[i + integer] * (1 - fraction) + signal[i + integer + 1] * fraction;
      dot += a * b;
      aa += a * a;
      bb += b * b;
    }
    const correlation = aa * bb > 1e-12 ? Math.max(0, dot / Math.sqrt(aa * bb)) : 0;
    // Tiny tie-break toward the shorter actual repetition. It does not force
    // a reference BPM and octave ambiguity is still reported by benchmarks.
    const score = correlation * (0.99 + (0.01 * bpm) / 190);
    tempoCandidates.push({ bpm, score, correlation });
    if (!best || score > best.score) best = { bpm, score, correlation };
  }
  if (!best || best.correlation < 0.35) return null;
  // Two cycles can correlate slightly better than one because of window and
  // interpolation alignment. Keep the shorter measured repetition when its
  // support is nearly as strong, while retaining the alternative for diagnostics.
  const originalBest = best;
  const faster = tempoCandidates
    .filter(
      (candidate) =>
        candidate.bpm > best.bpm * 1.8 &&
        candidate.bpm < best.bpm * 2.2 &&
        candidate.correlation >= best.correlation * 0.92,
    )
    .sort((a, b) => b.score - a.score)[0];
  if (faster) best = { ...faster, octaveAlternativeBpm: originalBest.bpm };
  // An ornament/vibrato can repeat well above the tempo range; selecting one
  // of its slower correlation multiples would manufacture a plausible beat.
  // Reject that ambiguity rather than treating each vocal fluctuation as meter.
  let fast = { correlation: 0, lag: 0 };
  for (let lag = rate / 15; lag <= rate / 4; lag += 0.25) {
    const correlation = correlationAt(signal, lag);
    if (correlation > fast.correlation) fast = { correlation, lag };
  }
  const ratio = (rate * 60) / best.bpm / fast.lag;
  if (
    fast.correlation > Math.max(0.72, best.correlation - 0.08) &&
    Math.round(ratio) >= 2 &&
    Math.abs(ratio - Math.round(ratio)) < 0.14
  )
    return null;
  const values = history.map((entry) => entry.value - mean);
  const fit = sinusoidFit(
    history,
    values,
    values.reduce((sum, value) => sum + value * value, 0),
    best.bpm,
  );
  const support = Math.min(1, span / ((60 / best.bpm) * 6));
  return { ...best, origin: fit.origin, confidence: unit((best.correlation - 0.2) / 0.7) * support * 0.95 };
}

function correlationAt(signal, lag) {
  const integer = Math.floor(lag),
    fraction = lag - integer;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i + integer + 1 < signal.length; i++) {
    const a = signal[i],
      b = signal[i + integer] * (1 - fraction) + signal[i + integer + 1] * fraction;
    dot += a * b;
    aa += a * a;
    bb += b * b;
  }
  return aa * bb > 1e-12 ? Math.max(0, dot / Math.sqrt(aa * bb)) : 0;
}

function sinusoidFit(history, values, square, bpm) {
  const start = history[0].time,
    omega = (2 * Math.PI * bpm) / 60;
  let sin = 0,
    cos = 0,
    ss = 0,
    cc = 0;
  for (let i = 0; i < history.length; i++) {
    const angle = omega * (history[i].time - start),
      s = Math.sin(angle),
      c = Math.cos(angle);
    sin += values[i] * s;
    cos += values[i] * c;
    ss += s * s;
    cc += c * c;
  }
  const score = square > 1e-20 ? ((sin * sin) / ss + (cos * cos) / cc) / square : 0;
  return { score, origin: start + Math.atan2(sin / ss, cos / cc) / omega };
}
const unit = (value) => Math.max(0, Math.min(1, value));
const average = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
