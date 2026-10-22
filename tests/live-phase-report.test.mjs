import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLivePhase } from '../scripts/live-phase-report.mjs';

function row(time, { phase = 0, beat = true, accepted = true, confidence = 0.9, ...rest } = {}) {
  return {
    time,
    measured: { beat, confidence, silent: false, bpm: 120 },
    grid: {
      phase,
      bpm: 120,
      effectiveBpm: 120,
      observationAccepted: accepted,
      phaseLockSource: 'observed-onsets',
    },
    ...rest,
  };
}

test('wraparound phases remain close to zero and repeated sampled flags count one observation', () => {
  const report = analyzeLivePhase([
    row(0, { phase: 0.98 }),
    row(0.01, { phase: 0.99 }),
    row(0.25, { beat: false }),
    row(0.5, { phase: 0.02 }),
    row(0.75, { beat: false }),
    row(1, { phase: 0, accepted: false }),
  ]);
  assert.equal(report.detectedOnsets.observations, 3);
  assert.equal(report.acceptedPeriodicOnsets.observations, 2);
  assert.ok(report.acceptedPeriodicOnsets.phaseConcentration > 0.99);
  assert.ok(Math.abs(report.acceptedPeriodicOnsets.circularMeanPhaseBeats) < 0.001);
  assert.equal(report.acceptedPeriodicOnsets.p95AbsoluteGridDifferenceMs, 10);
  assert.equal(report.acceptedPeriodicOnsets.windows.comparisonSupported, false);
});

test('high concentration alone does not hide a consistent quarter-beat offset', () => {
  const rows = Array.from({ length: 121 }, (_, index) =>
    row(index * 0.25, { beat: index % 2 === 0, phase: 0.25 }),
  );
  const report = analyzeLivePhase(rows);
  assert.equal(report.acceptedPeriodicOnsets.phaseConcentration, 1);
  assert.equal(report.acceptedPeriodicOnsets.medianAbsolutePhaseErrorBeats, 0.25);
  assert.equal(report.acceptedPeriodicOnsets.p95AbsoluteGridDifferenceMs, 125);
  assert.equal(report.acceptedPeriodicOnsets.medianGridMinusObservationMs, -125);
  assert.ok(report.limitations.some((text) => text.includes('never music accuracy')));
});

test('first and last windows show detector-relative alignment change with sufficient periodic evidence', () => {
  const rows = Array.from({ length: 121 }, (_, index) => {
    const time = index * 0.25;
    return row(time, { beat: index % 2 === 0, phase: time < 10 ? (index % 8 < 4 ? 0.2 : 0.8) : 0.01 });
  });
  const report = analyzeLivePhase(rows);
  const windows = report.acceptedPeriodicOnsets.windows;
  assert.equal(windows.comparisonSupported, true);
  assert.ok(windows.concentrationDelta > 0.6);
  assert.ok(windows.medianAbsolutePhaseErrorDeltaBeats < -0.18);
  const replay = analyzeLivePhase(rows, { replayOnly: true });
  assert.equal(replay.evidence, 'offline-replay-of-subsampled-fft');
  assert.equal(replay.renderedAccentTiming, null);
  assert.equal(replay.renderedGroups, null);
});

test('rendered periodic accents measure sampled first influence and peak rather than a hardcoded peak delay', () => {
  const group = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const rows = [0, 0.004, 0.024, 0.064, 0.12].map((time, index) =>
    row(time, {
      beat: index === 0,
      rendering: { observedBeat: index === 0, observedAccentSource: 'periodic-onset' },
      accent: {
        source: 'observed',
        evidence: 'periodic-onset',
        ageSeconds: time,
        envelope: [0, 0.2, 1, 0.4, 0][index],
      },
      group,
    }),
  );
  rows.push(
    row(0.5, {
      beat: false,
      rendering: { observedBeat: true, observedAccentSource: 'transient' },
      accent: { source: 'observed', evidence: 'transient', ageSeconds: 0, envelope: 0 },
      group,
    }),
  );
  const report = analyzeLivePhase(rows);
  assert.equal(report.renderedAccentTiming.periodicTriggers, 1);
  assert.equal(report.renderedAccentTiming.matchedRenderedAccents, 1);
  assert.equal(report.renderedAccentTiming.firstNonzeroEnvelopeDelayMs.median, 4);
  assert.equal(report.renderedAccentTiming.sampledPeakEnvelopeDelayMs.median, 24);
  assert.equal(report.renderedGroups.allFinite, true);
});

test('absent first-window evidence stays inconclusive rather than producing a false improvement', () => {
  const rows = Array.from({ length: 121 }, (_, index) =>
    row(index * 0.25, { beat: index % 2 === 0, confidence: index < 80 ? 0 : 0.9 }),
  );
  const report = analyzeLivePhase(rows);
  assert.equal(report.acceptedPeriodicOnsets.windows.comparisonSupported, false);
  assert.equal(report.acceptedPeriodicOnsets.windows.concentrationDelta, null);
  assert.equal(report.acceptedPeriodicOnsets.windows.medianAbsolutePhaseErrorDeltaBeats, null);
  assert.throws(() => analyzeLivePhase([{ time: 1 }, { time: 2 }]), /time, measured and grid/u);
  assert.throws(() => analyzeLivePhase([row(2), row(1)]), /monotonic/u);
});

test('a silent system capture cannot be presented as successful music alignment', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    ...row(index * 0.25, { beat: false, accepted: false, confidence: 0 }),
    measured: { beat: false, bpm: 0, confidence: 0, silent: true },
  }));
  const report = analyzeLivePhase(rows);
  assert.equal(report.signalSummary.hasAudioEvidence, false);
  assert.equal(report.signalSummary.voicedCoverage, 0);
  assert.equal(report.detectedOnsets.phaseConcentration, null);
  assert.equal(report.acceptedPeriodicOnsets.windows.comparisonSupported, false);
  assert.equal(report.renderedAccentTiming.matchedRenderedAccents, 0);
});
