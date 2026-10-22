import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DrumDetector } from '../src/audio/drum-detector.js';
import { BeatDetector } from '../src/audio/beat-detector.js';
import { MotionFeatures } from '../src/audio/motion-features.js';
import { MusicDelivery } from '../src/audio/music-delivery.js';
import { MotionDirector } from '../src/visuals/dance-motion.js';
import { DRUM_FIXTURE_CASES, drumPcmFixture, pcm16Wav } from '../tests/helpers/drum-pcm-fixtures.mjs';

export function measureDrumFixture(
  profile,
  { analysisHz = 90, frameOffsetSeconds = 0, Detector = DrumDetector } = {},
) {
  const fixture = drumPcmFixture({ profile });
  const detector = new Detector({ sampleRate: fixture.sampleRate, fftSize: fixture.fftSize });
  const events = [];
  for (let frame = 0; frame < fixture.seconds * analysisHz; frame++) {
    const input = fixture.frame(frame / analysisHz + frameOffsetSeconds);
    const drum = detector.process(input);
    if (drum.hit)
      events.push({
        time: input.time,
        onsetTime: drum.time,
        sequence: drum.sequence,
        kind: drum.kind,
        weight: drum.weight,
        strength: drum.strength,
        confidence: drum.confidence,
      });
  }
  return { fixture, events, score: scoreDrumEvents(events, fixture.hits) };
}

export function scoreDrumEvents(events, labels, { maximumDelaySeconds = 0.1 } = {}) {
  const used = new Set(),
    matches = [];
  for (const label of labels) {
    const candidates = events
      .map((event, index) => ({ event, index, delay: event.time - label.time }))
      .filter((row) => !used.has(row.index) && row.delay >= -0.005 && row.delay <= maximumDelaySeconds)
      .sort((a, b) => a.delay - b.delay);
    if (!candidates.length) continue;
    const row = candidates[0];
    used.add(row.index);
    matches.push({
      ...label,
      measuredKind: row.event.kind,
      weight: row.event.weight,
      sequence: row.event.sequence,
      delayMs: row.delay * 1000,
      confidence: row.event.confidence,
    });
  }
  const delay = matches.map((row) => row.delayMs).sort((a, b) => a - b);
  const weightsByRole = {};
  for (const match of matches) (weightsByRole[match.role] ||= []).push(match.weight);
  return {
    expectedHits: labels.length,
    detectedHits: events.length,
    matchedHits: matches.length,
    missedHits: labels.length - matches.length,
    unmatchedEvents: events.length - used.size,
    precision: events.length ? matches.length / events.length : labels.length ? 0 : 1,
    recall: labels.length ? matches.length / labels.length : null,
    delayP50Ms: percentile(delay, 0.5),
    delayP95Ms: percentile(delay, 0.95),
    classifiedFraction: matches.length
      ? matches.filter((row) => row.kind === row.measuredKind).length / matches.length
      : null,
    weightsByRole: Object.fromEntries(
      Object.entries(weightsByRole).map(([role, values]) => [
        role,
        { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length },
      ]),
    ),
    matches,
  };
}

/** Actual production accent sampler, isolated from the continuing body cycle.
 * This measures the causal algorithm/frame path; native Canvas is tested separately. */
export function measureDrumMotionFixture(profile = 'alternating-weight', { analysisHz = 60 } = {}) {
  const fixture = drumPcmFixture({ profile });
  const detector = new DrumDetector({ sampleRate: fixture.sampleRate, fftSize: fixture.fftSize });
  const motion = new MotionDirector();
  const events = [],
    responses = new Map();
  for (let frame = 0; frame < fixture.seconds * analysisHz; frame++) {
    const time = frame / analysisHz,
      input = fixture.frame(time),
      drum = detector.process(input);
    if (drum.hit) {
      events.push({
        time,
        kind: drum.kind,
        weight: drum.weight,
        confidence: drum.confidence,
        sequence: drum.sequence,
      });
      responses.set(drum.sequence, { firstPoseTime: null, peakPoseTime: null, maximumPoseDistance: 0 });
    }
    motion.update(
      {
        drum,
        beat: 0,
        beatIndex: Math.floor(time * 1.8),
        beatPhase: (time * 1.8) % 1,
        bpm: 108,
        silent: 0,
        audioSilent: input.rms < 0.00003,
        amplitude: input.rms,
        energy: Math.min(1, input.rms * 10),
        bass: drum.evidence.low,
        mid: drum.evidence.mid,
        treble: drum.evidence.high,
        brightness: drum.evidence.high,
        frequencyHz: 1200,
        attack: drum.strength,
        strength: drum.strength,
      },
      time,
      { glyphCount: 4 },
    );
    const pose = motion.sampleAccentMotion(time, { glyphCount: 4 });
    const response = responses.get(pose.accent.sequence);
    if (!response) continue;
    const distance = poseDistance(pose);
    if (distance > 0.00001 && response.firstPoseTime === null) response.firstPoseTime = time;
    if (distance > response.maximumPoseDistance) {
      response.maximumPoseDistance = distance;
      response.peakPoseTime = time;
    }
  }
  const score = scoreDrumEvents(events, fixture.hits);
  const matched = score.matches.map((match) => ({ ...match, ...responses.get(match.sequence) }));
  const first = matched
    .filter((row) => row.firstPoseTime !== null)
    .map((row) => (row.firstPoseTime - row.time) * 1000)
    .sort((a, b) => a - b);
  const peak = matched
    .filter((row) => row.peakPoseTime !== null)
    .map((row) => (row.peakPoseTime - row.time) * 1000)
    .sort((a, b) => a - b);
  return {
    profile,
    analysisHz,
    source: 'actual-production-accent-sampler-with-measured-PCM',
    matchedHits: matched.length,
    unrespondedHits: matched.filter((row) => row.firstPoseTime === null).length,
    audibleAttackToFirstPoseP95Ms: percentile(first, 0.95),
    audibleAttackToPeakPoseP95Ms: percentile(peak, 0.95),
    internalBeatsCreatedByDrumHits: motion.beatCount,
    responses: matched,
  };
}

function poseDistance(pose) {
  const value = (part) =>
    Math.abs(part.x) +
    Math.abs(part.y) +
    Math.abs(part.rotation) +
    Math.abs(part.scaleX - 1) +
    Math.abs(part.scaleY - 1);
  return (
    value(pose.group) +
    pose.glyphs.reduce((sum, glyph) => sum + value(glyph), 0) / Math.max(1, pose.glyphs.length)
  );
}

/** Identical audible primary spacing, different measured transient density.
 * Source labels only select scoring windows; no labelled BPM enters delivery. */
export function measureMusicDeliveryFixture({ analysisHz = 90 } = {}) {
  const fixture = drumPcmFixture({ profile: 'same-pulse-sparse-to-dense' });
  const options = { sampleRate: fixture.sampleRate, fftSize: fixture.fftSize };
  const drumDetector = new DrumDetector(options),
    beatDetector = new BeatDetector(options);
  const motionFeatures = new MotionFeatures({ ...options, estimatePitch: false });
  const delivery = new MusicDelivery();
  const rows = [];
  for (let frame = 0; frame < fixture.seconds * analysisHz; frame++) {
    const time = frame / analysisHz,
      input = fixture.frame(time);
    const measured = beatDetector.process(input);
    const features = motionFeatures.process({ ...input, beatFeatures: measured });
    const drum = drumDetector.process(input);
    // Only the outputs of production signal analysers are supplied. The
    // delivery module cannot see fixture labels, tempo or section names.
    rows.push({ time, ...delivery.update({ ...measured, ...features, drum }, time) });
  }
  const window = (from, to) => {
    const selected = rows.filter((row) => row.time >= from && row.time < to);
    const mean = (key) => selected.reduce((sum, row) => sum + row[key], 0) / selected.length;
    return {
      from,
      to,
      meanDrive: mean('drive'),
      meanDensity: mean('density'),
      meanReadingMultiplier: mean('readingMultiplier'),
      intenseFrames: selected.filter((row) => row.mode === 'intense').length,
    };
  };
  return {
    source: 'real-PCM-production-analysis-delivery',
    analysisHz,
    sparse: window(3, 5.8),
    dense: window(9, 11.8),
    primarySpacingOnlyForEvaluation: 0.5,
    labelledBpmFedToDelivery: false,
    actualSpeechRateRecognition: false,
    multiplierWithinReadingLimit: rows.every(
      (row) => row.readingMultiplier >= 1 && row.readingMultiplier <= 1.75,
    ),
  };
}

export function runDrumResponseBenchmark({ analysisHz = 90 } = {}) {
  return {
    setup: {
      sampleRate: 48000,
      fftSize: 2048,
      analysisHz,
      fftSmoothing: 0,
      detectorInput:
        'Only PCM waveform, raw linear FFT, RMS and frame time; independent hit labels are never supplied.',
      evaluation:
        'One-to-one audible attack matches within 100 ms. Tempo stability and primary-beat F1 are outside this response benchmark.',
    },
    results: DRUM_FIXTURE_CASES.map((profile) => {
      const measured = measureDrumFixture(profile, { analysisHz });
      return { profile, seconds: measured.fixture.seconds, ...measured.score };
    }),
    motionResponse: measureDrumMotionFixture(),
    deliveryResponse: measureMusicDeliveryFixture(),
    limitations: [
      'Original synthesized percussion/polyphony evaluates causal signal response and relative weights; it does not establish commercial-song accuracy or perceived enjoyment.',
      'Offline FFT has the production window size/cadence but excludes OS capture, WebAudio buffering, DOM/Canvas rendering and hardware latency.',
      'Synthetic hit kinds are independent source labels. Mixed real music may contain concurrent instruments and uncertain perceptual drum categories.',
    ],
  };
}

function percentile(sorted, fraction) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const hzIndex = process.argv.indexOf('--analysis-hz');
  const analysisHz = hzIndex >= 0 ? Number(process.argv[hzIndex + 1]) : 90;
  if (!Number.isFinite(analysisHz) || analysisHz < 20 || analysisHz > 240)
    throw new TypeError('analysis Hz must be 20..240.');
  const report = runDrumResponseBenchmark({ analysisHz });
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0 && process.argv[outputIndex + 1])
    fs.writeFileSync(process.argv[outputIndex + 1], JSON.stringify(report, null, 2) + '\n');
  const wavIndex = process.argv.indexOf('--write-wav');
  if (wavIndex >= 0 && process.argv[wavIndex + 1]) {
    const fixture = drumPcmFixture({ profile: 'alternating-weight' });
    fs.writeFileSync(process.argv[wavIndex + 1], pcm16Wav(fixture));
  }
  console.log(
    JSON.stringify(
      {
        setup: report.setup,
        results: report.results.map(({ matches, ...score }) => score),
        motionResponse: (({ responses, ...response }) => response)(report.motionResponse),
        deliveryResponse: report.deliveryResponse,
        limitations: report.limitations,
      },
      null,
      2,
    ),
  );
}
