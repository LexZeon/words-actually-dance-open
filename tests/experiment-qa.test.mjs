import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForNativeQACondition } from '../src/dev/experiment-qa.js';

// Fake elapsed time only tests the observer. It never supplies feature labels,
// clock ticks, or completion events to the actual application/detector.
test('native repeat observer waits for actual completion and repeat beyond the old 4.4-second window', async () => {
  let elapsed = 0,
    completions = 0;
  const entries = [];
  const result = await waitForNativeQACondition(
    () => entries.includes(1) && entries.filter((index) => index === 0).length >= 2 && completions >= 1,
    {
      now: () => elapsed,
      sleep: async (duration) => {
        elapsed += duration;
        if (elapsed === 25) entries.push(0);
        if (elapsed === 2500) entries.push(1);
        if (elapsed === 6000) entries.push(0);
        // A second line-zero event alone is insufficient: completion must
        // also be observed, retaining the original smoke-test requirement.
        if (elapsed === 6025) completions++;
      },
    },
  );
  assert.equal(result.conditionMet, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.elapsedMs, 6025);
});

test('native repeat observer fails a genuinely stalled app and terminates at its bounded deadline', async () => {
  let elapsed = 0;
  const result = await waitForNativeQACondition(() => false, {
    timeoutMs: 137,
    now: () => elapsed,
    sleep: async (duration) => (elapsed += duration),
  });
  assert.deepEqual(result, { conditionMet: false, timedOut: true, cancelled: false, elapsedMs: 137 });
});

test('native repeat observer rejects pause/source disposal even if the last condition is cached true', async () => {
  let elapsed = 0;
  const result = await waitForNativeQACondition(() => elapsed > 0, {
    now: () => elapsed,
    isActive: () => elapsed === 0,
    sleep: async (duration) => (elapsed += duration),
  });
  assert.deepEqual(result, { conditionMet: false, timedOut: false, cancelled: true, elapsedMs: 25 });
});

test('native repeat observer forbids unbounded waiting', async () => {
  for (const timeoutMs of [NaN, Infinity, -1, 30001])
    await assert.rejects(
      waitForNativeQACondition(() => false, { timeoutMs }),
      TypeError,
    );
});
