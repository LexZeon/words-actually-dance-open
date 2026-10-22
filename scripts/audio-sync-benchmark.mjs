import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pcmRhythm } from '../tests/helpers/pcm-rhythm.mjs';
import { scoreInternalGrid } from '../tests/helpers/grid-alignment-score.mjs';
import { BeatDetector } from '../src/audio/beat-detector.js';
import { BeatClock } from '../src/audio/beat-clock.js';
import { MotionDirector } from '../src/visuals/dance-motion.js';
import { MotionFeatures } from '../src/audio/motion-features.js';

const clockIndex = process.argv.indexOf('--clock-source');
const Clock =
  clockIndex >= 0 && process.argv[clockIndex + 1]
    ? (await import(pathToFileURL(path.resolve(process.argv[clockIndex + 1])).href)).BeatClock
    : BeatClock;

// Offline original PCM through Blackman FFT. Reference hit times/tempos are
// evaluation only; the detector/clock receive only measured spectral frames.
const cases = [
  { bpm: 120 },
  { bpm: 120, changeAt: 12, nextBpm: 80 },
  { bpm: 80, changeAt: 12, nextBpm: 120 },
  { bpm: 120, changeAt: 12, nextBpm: 150 },
  { bpm: 120, subdivisionGain: 0.15, mainMidGain: 0.3, bassGain: 0.12 },
  { bpm: 80, subdivisionGain: 0.15, mainMidGain: 0.3, bassGain: 0.12 },
  { bpm: 67, subdivisionGain: 0.15, mainMidGain: 0.3, bassGain: 0.12 },
  { bpm: 67, subdivisionGain: 0.06, mainMidGain: 0.5, bassGain: 0 },
  { bpm: 160, mainMidGain: 0.3, bassGain: 0 },
];
const results = [];
for (const options of cases) {
  const signal = pcmRhythm({ ...options, seconds: 30 }),
    detector = new BeatDetector(),
    clock = new Clock(),
    descriptors = new MotionFeatures({ estimatePitch: false }),
    dance = new MotionDirector();
  const rows = [],
    internalEvents = [],
    accentDelays = [],
    settledTempos = [];
  let firstDetected,
    firstRetarget,
    firstAligned,
    aligned = 0,
    internal = 0;
  for (let frame = 0; frame < 30 * 90; frame++) {
    const time = frame / 90,
      input = signal.frame(time),
      measured = detector.process(input),
      features = { ...measured, ...descriptors.process({ ...input, beatFeatures: measured }) };
    const ticks = clock.update(measured, time),
      grid = clock.getState();
    internalEvents.push(...ticks);
    internal += ticks.filter((tick) => tick.kind === 'beat').length;
    const observed =
      (measured.beat && grid.observationAccepted && measured.confidence >= 0.55) ||
      (measured.strength >= 0.18 && features.amplitudeRise >= 0.25 && !measured.silent);
    dance.update(
      {
        ...features,
        beat: ticks.some((tick) => tick.kind === 'beat'),
        bpm: grid.bpm,
        beatPhase: grid.phase,
        silent: 0,
        audioSilent: measured.silent,
        observedBeat: observed,
        observedConfidence: measured.confidence,
        observedAccentSource:
          grid.observationAccepted && measured.confidence >= 0.55 ? 'periodic-onset' : 'transient',
        observedStrength: measured.strength,
      },
      time,
    );
    const origin = options.changeAt ?? 0,
      reference = options.nextBpm ?? options.bpm;
    if (time >= 24 && measured.confidence >= 0.3) settledTempos.push(measured.bpm);
    if (time >= origin) {
      if (
        firstDetected === undefined &&
        Math.abs(measured.bpm - reference) < 3 &&
        measured.confidence >= 0.45
      )
        firstDetected = time - origin;
      if (firstRetarget === undefined && Math.abs(grid.targetBpm - reference) < 3)
        firstRetarget = time - origin;
    }
    if (measured.beat) {
      const hit = nearest(signal.hits, time),
        phase = grid.phase <= 0.5 ? grid.phase : grid.phase - 1;
      const error = Math.abs(time - (phase * 60) / grid.effectiveBpm - hit);
      rows.push({ time, onsetDelay: time - hit, gridError: error });
      if (
        time >= origin &&
        error < 0.04 &&
        Math.abs(grid.bpm - reference) < 3 &&
        grid.phaseLockSource === 'observed-onsets'
      )
        aligned++;
      else aligned = 0;
      if (aligned >= 4 && firstAligned === undefined) firstAligned = time - origin;
    }
    if (observed)
      accentDelays.push(time + 0.024 - nearest([...signal.hits, ...signal.subdivisionHits], time));
  }
  const settled = rows.filter((row) => row.time >= 24);
  const referenceBeats = signal.hits.map((time) => ({
    time,
    bpm: options.changeAt !== undefined && time >= options.changeAt ? options.nextBpm : options.bpm,
  }));
  results.push({
    fixture: options,
    detectorReadySeconds: round(firstDetected),
    gridRetargetSeconds: round(firstRetarget),
    fourHitsPhaseAlignedSeconds: round(firstAligned),
    onsetDelayP95Ms: round(p95(settled.map((row) => row.onsetDelay)) * 1000),
    onsetAbsoluteErrorP95Ms: round(p95(settled.map((row) => Math.abs(row.onsetDelay))) * 1000),
    settledGridErrorP95Ms: round(p95(settled.map((row) => row.gridError)) * 1000),
    observedAccentPeakDelayP95Ms: round(p95(accentDelays) * 1000),
    observedHits: rows.length,
    internalBeats: internal,
    rhythmEpochResets: detector.getDiagnostics().tempoReacquisitions,
    settledDoubleTempoFraction:
      settledTempos.filter((bpm) => Math.abs(bpm / (options.nextBpm ?? options.bpm) - 2) < 0.1).length /
      Math.max(1, settledTempos.length),
    tempoHypotheses: detector.getDiagnostics().tempoHypotheses,
    independentGridScore: {
      whole: scoreInternalGrid(internalEvents, referenceBeats, { from: signal.hits[0], to: 29.5 }),
      early: scoreInternalGrid(internalEvents, referenceBeats, { from: 2, to: 8 }),
      late: scoreInternalGrid(internalEvents, referenceBeats, { from: 24, to: 29.5 }),
      ...(options.changeAt !== undefined
        ? {
            afterChange: scoreInternalGrid(internalEvents, referenceBeats, {
              from: options.changeAt,
              to: 29.5,
            }),
          }
        : {}),
    },
    finalClock: clock.getState(),
  });
}
const report = {
  setup: { sampleRate: 48000, fftSize: 2048, analysisHz: 90, smoothing: 0.45, defaultGridBpm: 108 },
  results,
  limitations: [
    'Original generated PCM, no reference labels fed to detector/clock; not accuracy on commercial recordings.',
    'Offline FFT approximation, not a measurement of hardware speaker/display latency. Native Windows QA is separate.',
    'An observed accent does not create knowledge steps or internal grid beats.',
    'The legacy grid-error fields estimate a nearby grid zero at observed onsets; independentGridScore instead matches actual emitted beat timestamps one-to-one to independently generated references, including missed and extra beats.',
  ],
};
const args = process.argv.slice(2),
  index = args.indexOf('--output');
if (index >= 0 && args[index + 1]) fs.writeFileSync(args[index + 1], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
function p95(input) {
  const sorted = [...input].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * 0.95)];
}
function nearest(hits, time) {
  return hits.reduce((best, hit) => (Math.abs(hit - time) < Math.abs(best - time) ? hit : best), hits[0]);
}
function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}
