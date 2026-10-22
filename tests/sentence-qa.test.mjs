import test from 'node:test';
import assert from 'node:assert/strict';
import { installSentenceQA, validateSentenceTimingEvidence } from '../src/dev/sentence-qa.js';
import { planSentenceBoundary } from '../src/playback/sentence-boundary.js';

// Scoring fixtures are host evidence only. This test neither drives an audio
// analyzer nor claims that a native/WebAudio process has been run.
function evidence() {
  return {
    actualWebAudio: true,
    frames: 500,
    voicedFrames: 450,
    labelsFedToDetector: false,
    source: 'actual-post-frame-production-clock',
    trueDownbeatDetection: false,
    overflow: false,
    elapsedSeconds: 9,
    rows: [0, 1, 2, 0].map((lineIndex, id) => ({
      id,
      lineIndex,
      totalChars: 3,
      holdBeats: 1,
      lastGlyphStep: id * 16 + 2,
      readAtExit: 3,
      cursorAtExit: 3,
      cursorMatchesDOM: true,
      orderedGlyphs: true,
      settledVisibleFrames: 10,
      sentenceTiming: planSentenceBoundary({ completeAtStep: id * 16 + 2, holdBeats: 1 }),
    })),
    transitions: [0, 1, 2].map((fromId) => ({
      phase: 'natural',
      fromId,
      toId: fromId + 1,
      mountStep: (fromId + 1) * 16,
    })),
    lifecycle: {
      pauseFrozen: true,
      resumedWithoutReplay: true,
      manualOnSharedBeat: true,
      sourceCommitted: true,
      sourceRetainsCurrentReading: true,
      sourceTicksMonotonic: true,
    },
  };
}

test('sentence native scoring accepts three complete, settled internal-group transitions including repeat', () => {
  const score = validateSentenceTimingEvidence(evidence());
  assert.equal(score.pass, true);
  assert.deepEqual(score.failures, []);
});

test('sentence native scoring rejects cutoff, hidden glyphs, missing settle, wrong group, fake source and lifecycle failures', () => {
  const invalid = [
    ['unread retirement', (row) => (row.rows[0].readAtExit = 2)],
    ['cursor cutoff', (row) => (row.rows[0].cursorAtExit = 2)],
    ['hidden settled text', (row) => (row.rows[0].settledVisibleFrames = 0)],
    ['wrong group', (row) => (row.transitions[0].mountStep = 12)],
    ['missing settle beat', (row) => (row.rows[0].sentenceTiming.readableAtStep = 3)],
    ['mismatched glyph DOM', (row) => (row.rows[0].cursorMatchesDOM = false)],
    ['nonsequential glyphs', (row) => (row.rows[0].orderedGlyphs = false)],
    ['no repeat', (row) => (row.rows[3].lineIndex = 1)],
    ['missing natural transition', (row) => row.transitions.splice(2, 1)],
    ['manual counted as natural', (row) => (row.transitions[1].phase = 'manual')],
    ['paused clock advanced', (row) => (row.lifecycle.pauseFrozen = false)],
    ['resumed replay', (row) => (row.lifecycle.resumedWithoutReplay = false)],
    ['source not committed', (row) => (row.lifecycle.sourceCommitted = false)],
    ['source reset reading', (row) => (row.lifecycle.sourceRetainsCurrentReading = false)],
    ['old ticks after source', (row) => (row.lifecycle.sourceTicksMonotonic = false)],
    ['no WebAudio', (row) => (row.actualWebAudio = false)],
    ['no signal', (row) => (row.voicedFrames = 0)],
    ['label injection', (row) => (row.labelsFedToDetector = true)],
    ['claims true downbeat', (row) => (row.trueDownbeatDetection = true)],
    ['over deadline', (row) => (row.elapsedSeconds = 25)],
    ['unbounded capture', (row) => (row.overflow = true)],
  ];
  for (const [name, mutate] of invalid) {
    const changed = evidence();
    mutate(changed);
    assert.equal(validateSentenceTimingEvidence(changed).pass, false, name);
  }
});

test('sentence QA is absent in production; native installer disposal only removes its own hook', () => {
  const production = { desktop: { testMode: false } };
  assert.equal(installSentenceQA({}, { target: production }), false);
  assert.equal('__wadSentenceSmokeTest' in production, false);
  const listeners = new Set();
  const target = {
    desktop: { testMode: true },
    addEventListener(name, callback) {
      assert.equal(name, 'beforeunload');
      listeners.add(callback);
    },
    removeEventListener(name, callback) {
      assert.equal(name, 'beforeunload');
      listeners.delete(callback);
    },
  };
  const dispose = installSentenceQA({}, { target });
  assert.equal(typeof target.__wadSentenceSmokeTest, 'function');
  const otherOwner = () => {};
  target.__wadSentenceSmokeTest = otherOwner;
  dispose();
  dispose();
  assert.equal(target.__wadSentenceSmokeTest, otherOwner);
  assert.equal(listeners.size, 0);
});
