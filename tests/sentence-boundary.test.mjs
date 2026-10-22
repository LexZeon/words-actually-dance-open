import test from 'node:test';
import assert from 'node:assert/strict';
import { SENTENCE_GROUP_BEATS, planSentenceBoundary } from '../src/playback/sentence-boundary.js';

test('a completed quarter tick gets a full settle beat before the minimum readable hold', () => {
  assert.equal(SENTENCE_GROUP_BEATS, 4);
  assert.deepEqual(planSentenceBoundary({ completeAtStep: 43, holdBeats: 2 }), {
    completeAtStep: 43,
    readableAtStep: 47,
    minimumEndStep: 55,
    earliestBeat: 14,
    transitionBeat: 16,
    extraHoldBeats: 2,
    groupBeats: 4,
    source: 'internal-four-beat-group',
  });
});

for (const subdivision of [0, 1, 2, 3]) {
  for (const holdBeats of [1, 2, 8, 32]) {
    test(`subdivision ${subdivision} and hold ${holdBeats} never shorten reading time`, () => {
      for (const globalBeat of [0, 1, 2, 3, 15, 37, 100001]) {
        const completeAtStep = globalBeat * 4 + subdivision;
        const plan = planSentenceBoundary({ completeAtStep, holdBeats });
        assert.equal(plan.readableAtStep - completeAtStep, 4);
        assert.equal(plan.minimumEndStep - plan.readableAtStep, holdBeats * 4);
        assert.equal(plan.earliestBeat, Math.ceil(plan.minimumEndStep / 4));
        assert.ok(plan.earliestBeat * 4 >= plan.minimumEndStep);
        assert.ok((plan.earliestBeat - 1) * 4 < plan.minimumEndStep);
        assert.equal(plan.transitionBeat % 4, 0);
        assert.ok(plan.transitionBeat >= plan.earliestBeat);
        assert.ok(plan.transitionBeat - 4 < plan.earliestBeat);
        assert.equal(plan.extraHoldBeats, plan.transitionBeat - plan.earliestBeat);
        assert.ok(plan.extraHoldBeats >= 0 && plan.extraHoldBeats <= 3);
        assert.ok(plan.transitionBeat * 4 >= completeAtStep + 4 + holdBeats * 4);
        assert.ok(plan.transitionBeat * 4 - plan.minimumEndStep < 16);
      }
    });
  }
}

test('whole-beat padding covers zero through three without adding an unnecessary group', () => {
  const padding = [0, 4, 8, 12].map(
    (completeAtStep) => planSentenceBoundary({ completeAtStep, holdBeats: 1 }).extraHoldBeats,
  );
  assert.deepEqual(padding, [2, 1, 0, 3]);
  const alreadyAligned = planSentenceBoundary({ completeAtStep: 8, holdBeats: 1 });
  assert.equal(alreadyAligned.minimumEndStep, 16);
  assert.equal(alreadyAligned.transitionBeat, 4);
});

test('the existing global position is retained instead of restarting a sentence-local group', () => {
  const first = planSentenceBoundary({ completeAtStep: 5, holdBeats: 2 });
  const later = planSentenceBoundary({ completeAtStep: 5 + 400, holdBeats: 2 });
  assert.equal(later.transitionBeat - first.transitionBeat, 100);
  assert.equal(later.extraHoldBeats, first.extraHoldBeats);
});

test('the last safe aligned quarter-tick target is accepted and the next one is rejected', () => {
  const lastSafeGroupStep = Number.MAX_SAFE_INTEGER - (Number.MAX_SAFE_INTEGER % 16);
  for (const holdBeats of [1, 2, 8, 32]) {
    const completeAtStep = lastSafeGroupStep - 4 - holdBeats * 4;
    const plan = planSentenceBoundary({ completeAtStep, holdBeats });
    assert.equal(plan.minimumEndStep, lastSafeGroupStep);
    assert.equal(plan.transitionBeat * 4, lastSafeGroupStep);
    assert.ok(Number.isSafeInteger(plan.transitionBeat * 4));
    assert.throws(() => planSentenceBoundary({ completeAtStep: completeAtStep + 1, holdBeats }), RangeError);
    assert.throws(
      () => planSentenceBoundary({ completeAtStep: Number.MAX_SAFE_INTEGER, holdBeats }),
      RangeError,
    );
  }
});

test('missing objects and non-number values are TypeErrors without numeric coercion', () => {
  for (const options of [undefined, null, 1, '1', true, []])
    assert.throws(() => planSentenceBoundary(options), TypeError);
  for (const value of [undefined, null, '4', 4n, true, {}, []]) {
    assert.throws(() => planSentenceBoundary({ completeAtStep: value, holdBeats: 2 }), TypeError);
    assert.throws(() => planSentenceBoundary({ completeAtStep: 0, holdBeats: value }), TypeError);
  }
});

test('invalid numeric identities and hold values are RangeErrors', () => {
  for (const completeAtStep of [-1, -0.5, 0.25, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => planSentenceBoundary({ completeAtStep, holdBeats: 2 }), RangeError);
  for (const holdBeats of [-1, 0, 0.5, 1.5, 33, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(() => planSentenceBoundary({ completeAtStep: 0, holdBeats }), RangeError);
});

test('planning is deterministic and does not mutate its input or share mutable results', () => {
  const options = Object.freeze({ completeAtStep: 19, holdBeats: 8 });
  const first = planSentenceBoundary(options);
  const second = planSentenceBoundary(options);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  first.transitionBeat = -1;
  assert.notEqual(first.transitionBeat, planSentenceBoundary(options).transitionBeat);
  assert.deepEqual(options, { completeAtStep: 19, holdBeats: 8 });
});
