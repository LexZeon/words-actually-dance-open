import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { complexPcmRhythm } from '../tests/helpers/complex-pcm-rhythm.mjs';
import { scoreInternalGrid, nearestReference, quantile } from '../tests/helpers/grid-alignment-score.mjs';
import { BeatDetector } from '../src/audio/beat-detector.js';
import { BeatClock } from '../src/audio/beat-clock.js';

const clockIndex = process.argv.indexOf('--clock-source');
const Clock =
  clockIndex >= 0 && process.argv[clockIndex + 1]
    ? (await import(pathToFileURL(path.resolve(process.argv[clockIndex + 1])).href)).BeatClock
    : BeatClock;

const cases = [
  { id: 'syncopated-polyphonic', profile: 'syncopated', bpm: 128, seconds: 48 },
  { id: 'strong-offbeat', profile: 'strong-offbeat', bpm: 96, seconds: 48 },
  { id: 'weak-drums-melody', profile: 'weak-drums', bpm: 82, seconds: 48 },
  { id: 'swing-polyphonic', profile: 'swing', bpm: 110, seconds: 48 },
  { id: 'same-stream-128-to-86', profile: 'syncopated', bpm: 128, changeAt: 24, nextBpm: 86, seconds: 60 },
  {
    id: 'gradual-84-to-132',
    profile: 'syncopated',
    bpm: 84,
    rampAt: 12,
    rampSeconds: 20,
    finalBpm: 132,
    seconds: 60,
  },
  { id: 'long-verse-chorus-break', bpm: 110, longSections: true, seconds: 84 },
];
const results = [];
for (const options of cases) {
  const signal = complexPcmRhythm(options),
    detector = new BeatDetector(),
    clock = new Clock();
  const events = [],
    rows = [],
    observations = [],
    detectorSources = {};
  for (let frame = 0; frame < signal.seconds * 90; frame++) {
    const time = frame / 90,
      input = signal.frame(time);
    // Labels are not passed to either production module.
    const measured = detector.process(input);
    events.push(...clock.update(measured, time));
    const grid = clock.getState(),
      reference = nearestReference(signal.beats, time);
    const source = detector.getDiagnostics().source;
    detectorSources[source] = (detectorSources[source] || 0) + 1;
    rows.push({
      time,
      bpm: measured.bpm,
      confidence: measured.confidence,
      ratio: measured.bpm / reference.bpm,
      gridRatio: grid.bpm / reference.bpm,
      claimedLock: grid.phaseLockSource === 'observed-onsets',
    });
    if (measured.beat) observations.push({ time, error: nearestReference(signal.beats, time).error });
  }
  const early = scoreInternalGrid(events, signal.beats, { from: 2, to: 8 });
  const late = scoreInternalGrid(events, signal.beats, {
    from: signal.seconds - 12,
    to: signal.seconds - 0.5,
  });
  const whole = scoreInternalGrid(events, signal.beats, {
    from: signal.beats[0].time,
    to: signal.seconds - 0.5,
  });
  const lateRows = rows.filter((row) => row.time >= signal.seconds - 12);
  const lateObservations = observations.filter((row) => row.time >= signal.seconds - 12);
  const confidenceRows = lateRows.filter((row) => row.confidence >= 0.3 && row.bpm > 0);
  const windows = [
    { label: 'early', ...early },
    { label: 'late', ...late },
  ];
  if (options.changeAt !== undefined)
    windows.push({
      label: 'after-tempo-change',
      ...scoreInternalGrid(events, signal.beats, { from: options.changeAt, to: signal.seconds - 0.5 }),
    });
  if (options.rampAt !== undefined)
    windows.push({
      label: 'tempo-ramp',
      ...scoreInternalGrid(events, signal.beats, {
        from: options.rampAt,
        to: options.rampAt + options.rampSeconds,
      }),
    });
  if (options.longSections)
    for (const [from, to, label] of [
      [0, 24, 'weak-verse'],
      [24, 48, 'dense-chorus'],
      [48, 56, 'pad-break'],
      [56, 83.5, 'dense-return'],
    ])
      windows.push({ label, ...scoreInternalGrid(events, signal.beats, { from, to }) });
  results.push({
    fixture: options,
    measured: {
      observedBeats: observations.length,
      internalBeats: events.filter((event) => event.kind === 'beat').length,
      confidentLateFramesFraction: confidenceRows.length / Math.max(1, lateRows.length),
      detectorDoubleTempoLateFraction:
        confidenceRows.filter((row) => Math.abs(row.ratio - 2) < 0.1).length /
        Math.max(1, confidenceRows.length),
      detectorHalfTempoLateFraction:
        confidenceRows.filter((row) => Math.abs(row.ratio - 0.5) < 0.05).length /
        Math.max(1, confidenceRows.length),
      detectorOtherTempoLateFraction:
        confidenceRows.filter(
          (row) =>
            Math.abs(row.ratio - 1) > 0.05 &&
            Math.abs(row.ratio - 2) >= 0.1 &&
            Math.abs(row.ratio - 0.5) >= 0.05,
        ).length / Math.max(1, confidenceRows.length),
      claimedPhaseLockLateFraction:
        lateRows.filter((row) => row.claimedLock).length / Math.max(1, lateRows.length),
      observedOnsetToPrimaryAbsoluteErrorLateP95Ms: finite(
        quantile(
          lateObservations.map((row) => Math.abs(row.error)),
          0.95,
        ) * 1000,
      ),
      detectorSources,
    },
    independentWholeScore: whole,
    windows,
    finalClock: clock.getState(),
    detectorDiagnostics: detector.getDiagnostics(),
  });
}
const report = {
  setup: {
    sampleRate: 48000,
    fftSize: 2048,
    analysisHz: 90,
    fftSmoothing: 0.45,
    defaultGridBpm: 108,
    voices: [
      'kick',
      'bass with partials',
      'noise/tone snare',
      'syncopated hats',
      'melody with vibrato/partials',
      'overlapping chord pads',
    ],
    scoring:
      'Emitted INTERNAL beat event.time vs separately generated primary timestamps; <=40 ms and <=4% tempo for four consecutive reference beats. Two failures lose lock. Precision plus coverage expose double/half-tempo grids.',
  },
  results,
  limitations: [
    'Original deterministic synthetic arrangements, not annotated commercial-song accuracy or human-perceived groove.',
    'No reference BPM/timestamps/section labels passed into the detector or Clock. Their claimed phase lock is reported separately and does not establish ground-truth alignment.',
    'Strong upbeat and swung voices can have an ambiguous perceptual phase; the score deliberately evaluates the predeclared primary quarter-note pulse.',
    'No hardware playback/display path; FFT smoothing approximates the Web Audio analysis cadence. These are algorithm measurements, not hardware latency.',
    'Pad-break reference beats are extrapolated nominal musical time without audible pulse; that window evaluates held-clock continuity.',
  ],
};
const index = process.argv.indexOf('--output');
if (index >= 0 && process.argv[index + 1])
  fs.writeFileSync(process.argv[index + 1], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
function finite(value) {
  return Number.isFinite(value) ? value : null;
}
