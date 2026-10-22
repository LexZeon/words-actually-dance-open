import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { BeatDetector } from '../src/audio/beat-detector.js';
import { BeatClock } from '../src/audio/beat-clock.js';

// Replays ignored local QA FFT frames, without loading/downloading the audio.
// Song labels or a reference BPM are never passed to either analysis module.
const args = process.argv.slice(2);
const file = args[0];
if (!file || file === '--help') {
  console.log('node scripts/replay-audio-trace.mjs <ignored-trace.json> [--output artifacts/result.json]');
  if (!file) process.exitCode = 1;
} else {
  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    const frames = Array.isArray(payload) ? payload : payload.frames || payload.trace || payload.samples;
    if (!Array.isArray(frames) || frames.length < 3)
      throw new Error('Expected at least three QA FFT frames.');
    const metadata = payload.metadata || payload.meta || {};
    const sampleRate = metadata.sampleRate || frames[0].sampleRate || 48000;
    const fftSize = metadata.fftSize || frames[0].fftSize || frames[0].spectrum.length * 2;
    const detector = new BeatDetector({ sampleRate, fftSize }),
      clock = new BeatClock();
    const start = frames[0].time;
    const results = [],
      frameCosts = [];
    let previousStep = -1,
      continuityErrors = 0,
      internalBeats = 0;
    for (const frame of frames) {
      const began = performance.now();
      const features = detector.process({ ...frame, spectrum: Float32Array.from(frame.spectrum) });
      const diagnostics = detector.getDiagnostics();
      for (const event of clock.update(features, frame.time)) {
        const step = event.beatIndex * 4 + event.subdivisionIndex;
        if (step !== previousStep + 1) continuityErrors++;
        previousStep = step;
        if (event.kind === 'beat') internalBeats++;
      }
      frameCosts.push(performance.now() - began);
      results.push({
        time: frame.time - start,
        rms: frame.rms,
        ...features,
        source: diagnostics.source,
        candidates: diagnostics.candidates,
      });
    }
    const duration = frames.at(-1).time - start;
    const segments = [];
    for (let second = 0; second < duration; second += 5) {
      const segment = results.filter((row) => row.time >= second && row.time < second + 5);
      if (segment.length)
        segments.push({
          fromSeconds: second,
          toSeconds: rounded(Math.min(second + 5, duration)),
          ...summarize(segment),
        });
    }
    const sortedCosts = [...frameCosts].sort((a, b) => a - b);
    const final = results.at(-1);
    const summary = {
      file: path.resolve(file),
      metadata: { sampleRate, fftSize },
      frames: frames.length,
      seconds: rounded(duration),
      meanAnalysisHz: rounded((frames.length - 1) / duration),
      observedAnalysis: summarize(results),
      segments,
      final: {
        bpm: rounded(final.bpm),
        confidence: rounded(final.confidence),
        source: final.source,
        candidates: final.candidates,
      },
      internalClock: { ...clock.getState(), beats: internalBeats, continuityErrors },
      replayPerformance: {
        meanMs: rounded(frameCosts.reduce((s, v) => s + v, 0) / frameCosts.length),
        p95Ms: rounded(sortedCosts[Math.floor(sortedCosts.length * 0.95)]),
        maximumMs: rounded(sortedCosts.at(-1)),
      },
      limitations: [
        'No manual beat annotations or verified source tempo: these are detection statistics, not an accuracy percentage.',
        'Internal-grid continuity is a separate product behavior, not evidence of correct music detection.',
        'FFT frames can retain private mixed system content; keep input/output artifacts local and ignored.',
      ],
    };
    const outputIndex = args.indexOf('--output');
    if (outputIndex >= 0 && args[outputIndex + 1]) {
      const output = path.resolve(args[outputIndex + 1]);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
    }
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error('Trace replay failed: ' + error.message);
    process.exitCode = 1;
  }
}

function summarize(rows) {
  const supported = rows.filter((row) => row.bpm > 0 && row.confidence >= 0.3);
  const tempos = supported.map((row) => row.bpm).sort((a, b) => a - b);
  const sourceCounts = {};
  for (const row of rows) sourceCounts[row.source] = (sourceCounts[row.source] || 0) + 1;
  const beats = rows.filter((row) => row.beat);
  const intervals = beats.slice(1).map((row, index) => row.time - beats[index].time);
  const average = intervals.length ? intervals.reduce((sum, v) => sum + v, 0) / intervals.length : 0;
  return {
    observedBeats: beats.length,
    supportedBeats: beats.filter((row) => row.confidence >= 0.3).length,
    medianSupportedBpm: tempos.length ? rounded(tempos[Math.floor(tempos.length / 2)]) : 0,
    supportedBpmRange: tempos.length ? [rounded(tempos[0]), rounded(tempos.at(-1))] : [0, 0],
    meanConfidence: rounded(rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length),
    supportedFraction: rounded(supported.length / rows.length),
    silentFraction: rounded(rows.filter((row) => row.silent).length / rows.length),
    rmsMean: rounded(rows.reduce((sum, row) => sum + row.rms, 0) / rows.length),
    observedIntervalMean: rounded(average),
    observedIntervalVariation: average
      ? rounded(
          Math.sqrt(intervals.reduce((sum, v) => sum + (v - average) ** 2, 0) / intervals.length) / average,
        )
      : 0,
    sourceCounts,
  };
}
function rounded(value) {
  return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : 0;
}
