export const SENTENCE_GROUP_BEATS = 4;

const STEPS_PER_BEAT = 4;
const GROUP_STEPS = SENTENCE_GROUP_BEATS * STEPS_PER_BEAT;
const LAST_SAFE_GROUP_STEP = Number.MAX_SAFE_INTEGER - (Number.MAX_SAFE_INTEGER % GROUP_STEPS);

/**
 * Plan a sentence transition on the existing internal four-beat grouping.
 * One shared beat lets the final glyph settle; holdBeats starts after that.
 * This does not estimate musical meter or alter the shared clock.
 * Non-number/missing inputs throw TypeError; invalid numeric ranges throw
 * RangeError, including a target whose quarter-tick identity would overflow.
 */
export function planSentenceBoundary(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('Sentence boundary options must be an object.');
  const { completeAtStep, holdBeats } = options;
  if (typeof completeAtStep !== 'number') throw new TypeError('completeAtStep must be a number.');
  if (!Number.isSafeInteger(completeAtStep) || completeAtStep < 0)
    throw new RangeError('completeAtStep must be a nonnegative safe integer.');
  if (typeof holdBeats !== 'number') throw new TypeError('holdBeats must be a number.');
  if (!Number.isInteger(holdBeats) || holdBeats < 1 || holdBeats > 32)
    throw new RangeError('holdBeats must be an integer from 1 through 32.');

  const settleSteps = STEPS_PER_BEAT;
  const holdSteps = holdBeats * STEPS_PER_BEAT;
  if (completeAtStep > LAST_SAFE_GROUP_STEP - settleSteps - holdSteps)
    throw new RangeError('The planned sentence boundary exceeds safe quarter-tick precision.');

  const readableAtStep = completeAtStep + settleSteps;
  const minimumEndStep = readableAtStep + holdSteps;
  const earliestBeat = Math.ceil(minimumEndStep / STEPS_PER_BEAT);
  const transitionBeat = Math.ceil(earliestBeat / SENTENCE_GROUP_BEATS) * SENTENCE_GROUP_BEATS;
  return {
    completeAtStep,
    readableAtStep,
    minimumEndStep,
    earliestBeat,
    transitionBeat,
    extraHoldBeats: transitionBeat - earliestBeat,
    groupBeats: SENTENCE_GROUP_BEATS,
    source: 'internal-four-beat-group',
  };
}
