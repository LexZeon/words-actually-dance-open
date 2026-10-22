/** Compare primary pulse and subdivision evidence; never globally divide BPM.
 * Equal fast pulses stay fast. A clear independent low-frequency fundamental
 * or repeatable strong/weak grouping can support a slower primary hypothesis.
 */
export function resolveTempoHypotheses({
  intervalBpm,
  intervalConfidence,
  candidates,
  observations = [],
  candidate,
  previousBpm,
  primaryPrior,
  time,
}) {
  const pulseBpm = intervalConfidence >= 0.3 ? intervalBpm : (candidate?.bpm ?? 0);
  const bass = candidates.bass;
  let primaryCandidate = candidate;
  let reason = 'regular-pulse',
    ambiguity = false,
    subdivisionBpm = null;
  const alternation = onsetAlternation(observations, pulseBpm);
  const continuedBassPrimary =
    primaryPrior &&
    time - primaryPrior.time <= 1.5 &&
    bass &&
    near(bass.bpm, primaryPrior.bpm) &&
    bass.confidence >= 0.3 &&
    bass.score >= 0.2 &&
    bass.octaveScore < bass.score * 0.92;
  if (
    bass &&
    ((bass.confidence >= 0.45 && bass.score >= 0.24 && bass.octaveScore < bass.score * 0.8) ||
      continuedBassPrimary) &&
    near(pulseBpm, bass.bpm * 2) &&
    bass.octaveScore < bass.score
  ) {
    primaryCandidate = { ...bass, source: 'bass' };
    reason = 'independent-bass-primary';
    ambiguity = true;
    subdivisionBpm = pulseBpm;
  } else if (pulseBpm >= 110 && intervalConfidence >= 0.55 && alternation.confidence >= 0.45) {
    const harmonicHalf =
      candidates.harmonic &&
      near(candidates.harmonic.bpm, pulseBpm / 2) &&
      candidates.harmonic.confidence >= 0.35;
    const priorHalf =
      (previousBpm > 0 && near(previousBpm, pulseBpm / 2)) ||
      (primaryPrior && time - primaryPrior.time <= 1.5 && near(primaryPrior.bpm, pulseBpm / 2));
    if (harmonicHalf || (alternation.contrast >= 0.55 && (priorHalf || alternation.confidence >= 0.75))) {
      primaryCandidate = {
        bpm: pulseBpm / 2,
        confidence: Math.min(intervalConfidence, alternation.confidence),
        origin: alternation.origin,
        source: 'primary-onsets',
      };
      reason = harmonicHalf ? 'harmonic-and-strong-weak-grouping' : 'repeatable-strong-weak-grouping';
      ambiguity = true;
      subdivisionBpm = pulseBpm;
    }
  }
  if (!ambiguity && bass && pulseBpm > 0 && (near(pulseBpm, bass.bpm * 2) || near(pulseBpm * 2, bass.bpm))) {
    ambiguity = true;
    reason = 'octave-evidence-insufficient';
    subdivisionBpm = Math.max(pulseBpm, bass.bpm);
  }
  return {
    primaryCandidate,
    diagnostics: {
      primaryBpm: primaryCandidate?.bpm ?? pulseBpm,
      subdivisionBpm,
      ambiguity,
      reason,
      bassBpm: bass?.bpm ?? null,
      bassConfidence: bass?.confidence ?? 0,
      bassPrimaryScore: bass?.score ?? 0,
      bassOctaveScore: bass?.octaveScore ?? 0,
      onsetAlternation: alternation.contrast,
      groupingConfidence: alternation.confidence,
    },
  };
}

function onsetAlternation(observations, pulseBpm) {
  const rows = observations.slice(-16);
  if (rows.length < 6 || !(pulseBpm > 0)) return { contrast: 0, confidence: 0, origin: 0 };
  const period = 120 / pulseBpm,
    origin = rows[0].time;
  // Index parity changes after a missed subdivision. Group measured timestamps
  // on the candidate cycle instead; a missing observation does not flip roles.
  const even = [],
    odd = [];
  for (const row of rows) {
    const phase = ((((row.time - origin) / period) % 1) + 1) % 1;
    if (phase < 0.25 || phase >= 0.75) even.push(row);
    else odd.push(row);
  }
  if (even.length < 3 || odd.length < 3) return { contrast: 0, confidence: 0, origin: 0 };
  const a = median(even.map((row) => row.weight)),
    b = median(odd.map((row) => row.weight));
  const contrast = Math.abs(a - b) / Math.max(1e-12, a + b);
  const stronger = a >= b ? even : odd;
  const strong = Math.max(a, b),
    deviation = median(stronger.map((row) => Math.abs(row.weight - strong))) / Math.max(1e-12, strong);
  const spacing = stronger.slice(1).map((row, i) => row.time - stronger[i].time);
  const regular = spacing.every((value) => {
    const multiples = Math.max(1, Math.round(value / period));
    return Math.abs(value - period * multiples) <= period * 0.12;
  });
  const confidence = regular
    ? Math.max(0, Math.min(1, (contrast - 0.2) / 0.5)) * Math.max(0, 1 - deviation / 0.4)
    : 0;
  return { contrast, confidence, origin: stronger[0].time };
}
const near = (a, b) => a > 0 && b > 0 && Math.abs(a - b) <= b * 0.07;
const median = (list) => {
  const values = [...list].sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
};
