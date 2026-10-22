import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatDetector } from '../src/audio/beat-detector.js';
import { BeatClock } from '../src/audio/beat-clock.js';
import { MotionFeatures } from '../src/audio/motion-features.js';
import { MotionDirector } from '../src/visuals/dance-motion.js';
import { pcmRhythm } from './helpers/pcm-rhythm.mjs';
import { complexPcmRhythm } from './helpers/complex-pcm-rhythm.mjs';
import { scoreInternalGrid } from './helpers/grid-alignment-score.mjs';

function stream({ changeAt } = {}) {
  const signal = pcmRhythm({ changeAt, seconds: 30 });
  const detector = new BeatDetector(),
    clock = new BeatClock(),
    descriptors = new MotionFeatures({ estimatePitch: false }),
    dance = new MotionDirector();
  const observations = [],
    events = [],
    accents = [];
  let firstNew, firstTarget;
  for (let frame = 0; frame < 30 * 90; frame++) {
    const time = frame / 90,
      input = signal.frame(time),
      measured = detector.process(input);
    const features = { ...measured, ...descriptors.process({ ...input, beatFeatures: measured }) };
    const ticks = clock.update(measured, time),
      grid = clock.getState();
    events.push(...ticks);
    const observed =
      (measured.beat && grid.observationAccepted && measured.confidence >= 0.55) ||
      (measured.strength >= 0.18 && features.amplitudeRise >= 0.25 && !measured.silent);
    dance.update(
      {
        ...features,
        beat: ticks.some((tick) => tick.kind === 'beat'),
        beatPhase: grid.phase,
        bpm: grid.bpm,
        silent: 0,
        audioSilent: measured.silent,
        observedBeat: observed,
        observedConfidence: measured.confidence,
        observedAccentSource:
          grid.observationAccepted && measured.confidence >= 0.55 ? 'periodic-onset' : 'transient',
        observedStrength: measured.strength,
      },
      time,
      { glyphCount: 4 },
    );
    if (measured.beat) {
      const hit = signal.hits.findLast((value) => value <= time);
      const signedPhase = grid.phase <= 0.5 ? grid.phase : grid.phase - 1;
      observations.push({
        time,
        onsetDelay: time - hit,
        gridError: Math.abs(time - (signedPhase * 60) / grid.effectiveBpm - hit),
        bpm: measured.bpm,
        confidence: measured.confidence,
        lock: grid.phaseLockSource,
      });
    }
    if (observed) {
      const hit = signal.hits.findLast((value) => value <= time);
      const accent = dance.sampleAccent(time + 0.024);
      const withAccent = dance.sample(time + 0.024, { glyphCount: 4, beatPhase: grid.phase });
      const saved = dance.accent;
      dance.accent = null;
      const withoutAccent = dance.sample(time + 0.024, { glyphCount: 4, beatPhase: grid.phase });
      dance.accent = saved;
      accents.push({
        time,
        hit,
        delay: time + 0.024 - hit,
        displacement: withAccent.group.scaleX - withoutAccent.group.scaleX,
        ...accent,
      });
    }
    if (changeAt && time >= changeAt) {
      if (firstNew === undefined && Math.abs(measured.bpm - 80) < 3 && measured.confidence >= 0.45)
        firstNew = time - changeAt;
      if (firstTarget === undefined && Math.abs(grid.targetBpm - 80) < 3) firstTarget = time - changeAt;
    }
  }
  return { detector, clock, dance, observations, events, accents, firstNew, firstTarget };
}

test('analysed PCM drum hits align grid and a finite physical accent to actual signal timing', () => {
  const result = stream();
  const settled = result.observations.filter((row) => row.time >= 10);
  assert.ok(settled.length >= 30);
  assert.ok(
    settled.every((row) => row.onsetDelay < 0.035),
    'FFT/onset latency, independent of reference labels',
  );
  assert.ok(
    settled.every((row) => row.gridError < 0.035),
    'grid must align to actual PCM hits, not just report a BPM',
  );
  assert.ok(result.accents.length >= 25);
  assert.ok(result.accents[0].time < 0.3, 'a measured first strong onset reacts before tempo learning');
  assert.ok(
    result.accents.every((row) => row.delay >= 0 && row.delay < 0.06),
    'physical accent peak stays near the actual hit',
  );
  assert.ok(result.accents.every((row) => row.displacement > 0.03 && row.source === 'observed'));
  assert.equal(
    result.dance.beatCount,
    result.events.filter((event) => event.kind === 'beat').length,
    'onset accents never create separate knowledge/grid beats',
  );
  result.events.forEach((event, index) => assert.equal(event.beatIndex * 4 + event.subdivisionIndex, index));
  assert.equal(result.detector.getDiagnostics().tempoReacquisitions, 0);
});

test('same-stream 120 to 80 PCM rhythm releases the old epoch and reacquires actual new timing', () => {
  const result = stream({ changeAt: 12 });
  assert.ok(result.firstNew <= 2.7, `detector ${result.firstNew}s`);
  assert.ok(result.firstTarget <= 4.7, `clock evidence ${result.firstTarget}s`);
  assert.equal(result.detector.getDiagnostics().tempoReacquisitions, 1);
  assert.ok(result.observations.filter((row) => row.time >= 23).every((row) => row.gridError < 0.04));
  assert.ok(result.accents.filter((row) => row.time >= 15).every((row) => row.delay < 0.06));
  assert.ok(Math.abs(result.clock.getState().bpm - 80) < 1);
  result.events.forEach((event, index) => assert.equal(event.beatIndex * 4 + event.subdivisionIndex, index));
});

test('gradually faster polyphonic PCM reacquires actual timestamp alignment after the ramp without a tempo dead band', () => {
  const signal = complexPcmRhythm({ seconds: 60, bpm: 84, rampAt: 12, rampSeconds: 20, finalBpm: 132 });
  const detector = new BeatDetector(),
    clock = new BeatClock(),
    events = [];
  for (let frame = 0; frame < signal.seconds * 90; frame++) {
    const time = frame / 90,
      input = signal.frame(time);
    // Only measured PCM-derived spectrum/RMS/time enter production algorithms.
    events.push(...clock.update(detector.process(input), time));
  }
  const settled = scoreInternalGrid(events, signal.beats, { from: 48, to: 59.5 });
  assert.ok(settled.absoluteErrorP95Ms < 40, `Actual emitted-grid P95 ${settled.absoluteErrorP95Ms} ms`);
  assert.ok(settled.matching40.f1 >= 0.96, `Independent one-to-one 40 ms F1 ${settled.matching40.f1}`);
  assert.ok(Math.abs(clock.getState().targetBpm - 132) < 1);
  assert.equal(settled.doubleTempoFraction, 0);
  assert.equal(settled.halfTempoFraction, 0);
  events.forEach((event, index) => assert.equal(event.beatIndex * 4 + event.subdivisionIndex, index));
  // In-ramp performance is deliberately reported by the full benchmark. This
  // test verifies post-ramp recovery, not successful tracking through the ramp.
});
