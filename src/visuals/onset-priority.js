const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Map an audio-clock age onto the renderer's clock without mixing epochs. */
export function onsetAgeSeconds(cue) {
  return Number.isFinite(cue?.ageSeconds) ? clamp(cue.ageSeconds, 0, 0.25) : 0;
}

/** A recent physical onset takes visual priority, without moving the grid. */
export function onsetPriority(lastOnset, time) {
  if (!Number.isFinite(lastOnset) || !Number.isFinite(time)) return 0;
  const age = Math.max(0, time - lastOnset);
  if (age <= 0.9) return 1;
  const p = clamp((age - 0.9) / 0.45, 0, 1);
  return 1 - p * p * (3 - 2 * p);
}

/** Confirmation already follows a causal attack window: add no second rise. */
export function onsetEnvelope(age, duration) {
  if (!Number.isFinite(age) || age < 0 || age >= duration) return 0;
  const p = clamp(age / duration, 0, 1);
  return 1 - p * p * (3 - 2 * p);
}
