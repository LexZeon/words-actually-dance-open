/** Independent evaluator. Musical reference timestamps are never analyzer input. */
export function nearestReference(beats, time) {
  if (!beats.length || !Number.isFinite(time)) return null;
  let low = 0,
    high = beats.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (beats[middle].time < time) low = middle + 1;
    else high = middle;
  }
  const right = Math.min(low, beats.length - 1),
    left = Math.max(0, low - 1);
  const index = Math.abs(time - beats[left].time) <= Math.abs(time - beats[right].time) ? left : right;
  return { ...beats[index], index, error: time - beats[index].time };
}

export function normalizeReferences(beats) {
  const normalized = beats
    .map((beat) => (typeof beat === 'number' ? { time: beat } : { ...beat }))
    .sort((left, right) => left.time - right.time);
  for (let index = 0; index < normalized.length; index++) {
    const beat = normalized[index];
    if (!Number.isFinite(beat.time) || (index && beat.time <= normalized[index - 1].time))
      throw new TypeError('Reference beat times must be finite and unique.');
    const interval = normalized[index + 1]?.time - beat.time || beat.time - normalized[index - 1]?.time;
    if (!(beat.bpm > 0)) beat.bpm = interval > 0 ? 60 / interval : null;
  }
  return normalized;
}

function normalizeEvents(events) {
  const normalized = events
    .map((event) =>
      typeof event === 'number' ? { kind: 'beat', time: event } : { ...event, kind: event.kind ?? 'beat' },
    )
    .filter((event) => event.kind === 'beat')
    .sort((left, right) => left.time - right.time);
  for (let index = 0; index < normalized.length; index++) {
    const event = normalized[index];
    if (!Number.isFinite(event.time)) throw new TypeError('Internal beat times must be finite.');
    const interval = index
      ? event.time - normalized[index - 1].time
      : normalized[index + 1]?.time - event.time;
    if (!(event.bpm > 0)) event.bpm = interval > 0 ? 60 / interval : null;
  }
  return normalized;
}

function oneToOneMatches(events, references, tolerance) {
  let gridCursor = 0,
    referenceCursor = 0,
    matched = 0;
  while (gridCursor < events.length && referenceCursor < references.length) {
    const difference = events[gridCursor].time - references[referenceCursor].time;
    if (difference < -tolerance) gridCursor++;
    else if (difference > tolerance) referenceCursor++;
    else {
      matched++;
      gridCursor++;
      referenceCursor++;
    }
  }
  const precision = events.length ? matched / events.length : null;
  const recall = references.length ? matched / references.length : null;
  return {
    toleranceMs: tolerance * 1000,
    matched,
    falsePositives: events.length - matched,
    missedReferences: references.length - matched,
    precision,
    recall,
    f1:
      precision === null || recall === null
        ? null
        : precision + recall > 0
          ? (2 * precision * recall) / (precision + recall)
          : 0,
  };
}

export function scoreInternalGrid(events, beats, { from = 0, to = Infinity, tolerance = 0.04 } = {}) {
  beats = normalizeReferences(beats);
  events = normalizeEvents(events);
  const referenceIndexes = new Set(
    beats
      .map((beat, index) => ({ ...beat, index }))
      .filter((beat) => beat.time >= from && beat.time < to)
      .map((beat) => beat.index),
  );
  const windowEvents = events.filter((event) => event.time >= from && event.time < to);
  const rows = windowEvents
    .map((event) => ({ ...event, reference: nearestReference(beats, event.time) }))
    .filter((event) => event.reference);
  const errors = rows.map((row) => Math.abs(row.reference.error));
  const matches = rows.filter((row) => Math.abs(row.reference.error) <= tolerance);
  const covered = new Set(
    matches.map((row) => row.reference.index).filter((index) => referenceIndexes.has(index)),
  );
  const ratios = rows.map((row) => row.bpm / row.reference.bpm).filter(Number.isFinite);
  const windowReferences = beats.filter((beat) => beat.time >= from && beat.time < to);
  const matching40 = oneToOneMatches(windowEvents, windowReferences, 0.04);
  const matching70 = oneToOneMatches(windowEvents, windowReferences, 0.07);
  let previousReference = null,
    consecutive = 0,
    misses = 0,
    locked = false,
    firstLock = null;
  const losses = [],
    acquisitions = [];
  for (const row of rows) {
    const phaseCorrect = Math.abs(row.reference.error) <= tolerance;
    const tempoCorrect = Math.abs(row.bpm / row.reference.bpm - 1) <= 0.04;
    const consecutiveReference = previousReference === null || row.reference.index === previousReference + 1;
    const correct = phaseCorrect && tempoCorrect && consecutiveReference;
    if (correct) {
      misses = 0;
      consecutive++;
      if (!locked && consecutive >= 4) {
        locked = true;
        const acquired = { time: row.time, secondsFromWindowStart: row.time - from };
        acquisitions.push(acquired);
        firstLock ??= acquired;
      }
    } else {
      consecutive = 0;
      misses += Math.max(1, previousReference === null ? 1 : row.reference.index - previousReference - 1);
      if (locked && misses >= 2) {
        locked = false;
        losses.push({
          time: row.time,
          reason: !phaseCorrect ? 'phase' : !tempoCorrect ? 'tempo' : 'missing-or-extra-beat',
        });
      }
    }
    previousReference = row.reference.index;
  }
  return {
    from,
    to: Number.isFinite(to) ? to : null,
    toleranceMs: tolerance * 1000,
    evaluationAvailable: beats.length > 1,
    gridBeats: windowEvents.length,
    referenceBeats: referenceIndexes.size,
    absoluteErrorMedianMs: quantile(errors, 0.5) * 1000 || (errors.length ? 0 : null),
    absoluteErrorP95Ms: quantile(errors, 0.95) * 1000 || (errors.length ? 0 : null),
    signedErrorMedianMs:
      quantile(
        rows.map((row) => row.reference.error),
        0.5,
      ) * 1000 || (rows.length ? 0 : null),
    withinToleranceFraction: rows.length ? matches.length / rows.length : null,
    within40msFraction: rows.length
      ? rows.filter((row) => Math.abs(row.reference.error) <= 0.04).length / rows.length
      : null,
    within70msFraction: rows.length
      ? rows.filter((row) => Math.abs(row.reference.error) <= 0.07).length / rows.length
      : null,
    referenceCoverageFraction: referenceIndexes.size ? covered.size / referenceIndexes.size : null,
    matching40,
    matching70,
    doubleTempoFraction: ratios.length
      ? ratios.filter((ratio) => Math.abs(ratio - 2) < 0.1).length / ratios.length
      : null,
    halfTempoFraction: ratios.length
      ? ratios.filter((ratio) => Math.abs(ratio - 0.5) < 0.05).length / ratios.length
      : null,
    firstFourBeatLock: firstLock,
    lossEpisodes: losses,
    acquisitions,
    lockedAtEnd: locked,
  };
}

export function quantile(values, fraction) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}
