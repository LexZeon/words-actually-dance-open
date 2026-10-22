import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BeatDetector } from '../src/audio/beat-detector.js';
import { BeatClock } from '../src/audio/beat-clock.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value) => (finite(value) ? Math.round(value * 10000) / 10000 : null);
const average = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
};
const signedPhase = (value) => ((((value + 0.5) % 1) + 1) % 1) - 0.5;
const difference = (last, first) => (finite(last) && finite(first) ? round(last - first) : null);

/** Aggregate post-render observations only; no musical ground truth is inferred. */
export function analyzeLivePhase(rows, { windowSeconds = 10, replayOnly = false } = {}) {
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 50000)
    throw new Error('Expected 2–50,000 lightweight post-render rows.');
  if (!rows.every((row) => finite(row?.time) && row?.grid && row?.measured))
    throw new Error('Phase analysis needs each row to contain time, measured and grid.');
  if (rows.some((row, index) => index && row.time < rows[index - 1].time))
    throw new Error('Rows must preserve monotonic frame order.');
  const start = rows[0].time;
  const duration = rows.at(-1).time - start;
  const window = finite(windowSeconds) && windowSeconds > 0 ? windowSeconds : 10;
  const observations = [],
    periodic = [],
    accentTriggers = [];
  let lastMeasuredFlag = false,
    lastAccentFlag = false;
  for (const row of rows) {
    const flag = Boolean(row.measured.beat);
    const rising = flag && !lastMeasuredFlag;
    lastMeasuredFlag = flag;
    if (
      rising &&
      !row.measured.silent &&
      !row.grid.paused &&
      finite(row.measured.confidence) &&
      row.measured.confidence >= 0.45 &&
      finite(row.grid.phase) &&
      finite(row.grid.effectiveBpm ?? row.grid.bpm) &&
      (row.grid.effectiveBpm ?? row.grid.bpm) > 0
    ) {
      const phase = signedPhase(row.grid.phase);
      const observation = {
        time: row.time,
        relativeTime: row.time - start,
        phase,
        // Estimate the closest internal grid boundary from this frame's phase.
        // Negative means that boundary preceded the detected observation.
        gridMinusObservationMs: (-phase * 60000) / (row.grid.effectiveBpm ?? row.grid.bpm),
      };
      observations.push(observation);
      if (row.grid.observationAccepted) periodic.push(observation);
    }
    const accentFlag = Boolean(row.rendering?.observedBeat);
    if (accentFlag && !lastAccentFlag && row.rendering?.observedAccentSource === 'periodic-onset')
      accentTriggers.push({ time: row.time, evidence: 'periodic-onset' });
    lastAccentFlag = accentFlag;
  }
  const statistics = (input) => {
    const cos = average(input.map(({ phase }) => Math.cos(phase * Math.PI * 2)));
    const sin = average(input.map(({ phase }) => Math.sin(phase * Math.PI * 2)));
    return {
      observations: input.length,
      enoughObservations: input.length >= 6,
      phaseConcentration: input.length ? round(Math.hypot(cos, sin)) : null,
      circularMeanPhaseBeats: input.length ? round(Math.atan2(sin, cos) / (Math.PI * 2)) : null,
      medianAbsolutePhaseErrorBeats: round(
        percentile(
          input.map(({ phase }) => Math.abs(phase)),
          0.5,
        ),
      ),
      p95AbsolutePhaseErrorBeats: round(
        percentile(
          input.map(({ phase }) => Math.abs(phase)),
          0.95,
        ),
      ),
      medianGridMinusObservationMs: round(
        percentile(
          input.map((row) => row.gridMinusObservationMs),
          0.5,
        ),
      ),
      p95AbsoluteGridDifferenceMs: round(
        percentile(
          input.map((row) => Math.abs(row.gridMinusObservationMs)),
          0.95,
        ),
      ),
    };
  };
  const windows = (input) => {
    const first = statistics(input.filter((row) => row.relativeTime < window));
    const last = statistics(input.filter((row) => row.relativeTime >= Math.max(0, duration - window)));
    return {
      first: { fromSeconds: 0, toSeconds: round(Math.min(window, duration)), ...first },
      last: { fromSeconds: round(Math.max(0, duration - window)), toSeconds: round(duration), ...last },
      comparisonSupported: duration >= window * 2 && first.enoughObservations && last.enoughObservations,
      concentrationDelta: difference(last.phaseConcentration, first.phaseConcentration),
      medianAbsolutePhaseErrorDeltaBeats: difference(
        last.medianAbsolutePhaseErrorBeats,
        first.medianAbsolutePhaseErrorBeats,
      ),
    };
  };
  const intervals = rows.slice(1).map((row, index) => (row.time - rows[index].time) * 1000);
  const lockCounts = {};
  for (const row of rows) {
    const source = row.grid.phaseLockSource || 'none';
    lockCounts[source] = (lockCounts[source] || 0) + 1;
  }
  const groups = rows.filter((row) => row.group);
  const voiced = rows.filter((row) => !row.measured.silent);
  const finiteGroups = groups.filter((row) =>
    ['x', 'y', 'rotation', 'scaleX', 'scaleY'].every((key) => finite(row.group[key])),
  );
  return {
    schemaVersion: 1,
    evidence: replayOnly ? 'offline-replay-of-subsampled-fft' : 'actual-post-render-state',
    seconds: round(duration),
    frames: rows.length,
    signalSummary: {
      voicedFrames: voiced.length,
      voicedCoverage: round(voiced.length / rows.length),
      confidentVoicedFrames: voiced.filter((row) => row.measured.confidence >= 0.45).length,
      meanVoicedConfidence: round(average(voiced.map((row) => row.measured.confidence).filter(finite))),
      hasAudioEvidence: voiced.length > 0,
    },
    frameIntervalsMs: {
      median: round(percentile(intervals, 0.5)),
      p95: round(percentile(intervals, 0.95)),
      maximum: round(Math.max(...intervals)),
    },
    phaseLockFrameCounts: lockCounts,
    detectedOnsets: { ...statistics(observations), windows: windows(observations) },
    acceptedPeriodicOnsets: { ...statistics(periodic), windows: windows(periodic) },
    renderedAccentTiming: replayOnly ? null : summarizeAccentTiming(rows, accentTriggers),
    renderedGroups: replayOnly
      ? null
      : {
          samples: groups.length,
          finiteSamples: finiteGroups.length,
          allFinite: groups.length > 0 && groups.length === finiteGroups.length,
        },
    limitations: [
      'No annotated musical beat/onset ground truth: this measures internal-grid alignment to detector observations, never music accuracy.',
      'Concentration near one can still describe consistently wrong phase; read absolute phase offset and sample counts together.',
      'Grid time differences are nearest-boundary estimates from local phase/effective BPM, not speaker-to-screen latency.',
      'Accent timing uses rendered command envelopes; it cannot isolate visible pixel displacement from baseline dance, capture buffering or hardware display latency.',
      ...(replayOnly
        ? [
            'Stored FFT frames are subsampled around 50 ms and are replayed at their stored cadence; replay cannot recover actual runtime frame phase or motion latency.',
          ]
        : []),
    ],
  };
}

function summarizeAccentTiming(rows, triggers) {
  const firstInfluence = [],
    sampledPeak = [];
  for (const trigger of triggers) {
    const samples = rows.filter((row) => {
      const accent = row.accent;
      return (
        row.time >= trigger.time &&
        row.time - trigger.time <= 0.2 &&
        accent?.source === 'observed' &&
        accent.evidence === trigger.evidence &&
        finite(accent.ageSeconds) &&
        Math.abs(row.time - accent.ageSeconds - trigger.time) < 0.02 &&
        finite(accent.envelope) &&
        accent.envelope > 0
      );
    });
    if (!samples.length) continue;
    firstInfluence.push((samples[0].time - trigger.time) * 1000);
    const peak = samples.reduce(
      (best, row) => (row.accent.envelope > best.accent.envelope ? row : best),
      samples[0],
    );
    sampledPeak.push((peak.time - trigger.time) * 1000);
  }
  return {
    periodicTriggers: triggers.length,
    matchedRenderedAccents: firstInfluence.length,
    firstNonzeroEnvelopeDelayMs: {
      median: round(percentile(firstInfluence, 0.5)),
      p95: round(percentile(firstInfluence, 0.95)),
    },
    sampledPeakEnvelopeDelayMs: {
      median: round(percentile(sampledPeak, 0.5)),
      p95: round(percentile(sampledPeak, 0.95)),
    },
  };
}

function replayFft(frames) {
  if (!Array.isArray(frames) || frames.length < 2 || !frames.every((row) => Array.isArray(row.spectrum)))
    throw new Error('Explicit FFT replay needs stored spectral rows.');
  const detector = new BeatDetector({
    sampleRate: frames[0].sampleRate || 48000,
    fftSize: frames[0].fftSize || frames[0].spectrum.length * 2,
  });
  const clock = new BeatClock();
  return frames.map((frame) => {
    const measured = detector.process({ ...frame, spectrum: Float32Array.from(frame.spectrum) });
    clock.update(measured, frame.time);
    return { time: frame.time, measured, grid: clock.getState() };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (!args[0] || args[0] === '--help') {
    console.log(
      'node scripts/live-phase-report.mjs <local-alignment.json> [--window 10] [--output artifacts/phase-report.json] [--replay-fft]',
    );
    if (!args[0]) process.exitCode = 1;
  } else {
    try {
      const payload = JSON.parse(fs.readFileSync(args[0], 'utf8'));
      const input = Array.isArray(payload) ? payload : payload.rows || payload.frames;
      const replayOnly = args.includes('--replay-fft');
      const windowIndex = args.indexOf('--window');
      const report = analyzeLivePhase(replayOnly ? replayFft(input) : input, {
        replayOnly,
        windowSeconds: windowIndex < 0 ? 10 : Number(args[windowIndex + 1]),
      });
      const outputIndex = args.indexOf('--output');
      if (outputIndex >= 0 && args[outputIndex + 1]) {
        const output = path.resolve(args[outputIndex + 1]);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
      }
      console.log(JSON.stringify(report, null, 2));
    } catch {
      console.error(
        'Live phase report failed: check the local trace format and output path. FFT-only input needs --replay-fft.',
      );
      process.exitCode = 1;
    }
  }
}
