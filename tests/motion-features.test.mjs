import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionFeatures } from '../src/audio/motion-features.js';
import { AudioController } from '../src/audio/audio-controller.js';
import { BeatDetector } from '../src/audio/beat-detector.js';

const sampleRate = 48000,
  fftSize = 2048;
function tone({ time = 0, frequency = 440, amplitude = 0.2, phase = 0.25 } = {}) {
  const spectrum = new Float32Array(fftSize / 2);
  const location = (frequency * fftSize) / sampleRate;
  const left = Math.floor(location),
    fraction = location - left;
  // Distribute power between neighboring bins, yielding the specified centroid.
  spectrum[left] = amplitude * Math.sqrt(1 - fraction);
  spectrum[left + 1] = amplitude * Math.sqrt(fraction);
  const wave = Float32Array.from(
    { length: fftSize },
    (_, i) => amplitude * Math.SQRT2 * Math.sin(2 * Math.PI * frequency * (time + i / sampleRate)),
  );
  return { spectrum, wave, time, rms: amplitude, beatFeatures: { silent: 0, phase, strength: 0, onset: 0 } };
}

test('steady pure tone yields finite amplitude, centroid and conservative pitch', () => {
  const analyser = new MotionFeatures();
  let result;
  for (let i = 0; i < 60; i++) result = analyser.process(tone({ time: i / 60, frequency: 440 }));
  assert.ok(Math.abs(result.centroidHz - 440) < 0.01);
  assert.equal(result.frequencyHz, result.centroidHz);
  assert.equal(result.amplitude, 0.2);
  assert.equal(result.rms, 0.2);
  assert.ok(Math.abs(result.pitchHz - 440) < 2, `pitch ${result.pitchHz}`);
  assert.ok(result.pitchConfidence > 0.95);
  assert.ok(Math.abs(result.frequencyTrend) < 0.001);
  assert.ok(Math.abs(result.amplitudeTrend) < 0.001);
  assert.ok(result.noisiness < 0.01);
  assert.equal(result.beatPhase, 0.25);
});

test('rising and falling frequency sweeps expose signed centroid trends', () => {
  for (const sign of [1, -1]) {
    const analyser = new MotionFeatures({ estimatePitch: false });
    let result;
    for (let i = 0; i < 180; i++) {
      const frequency = sign > 0 ? 200 * Math.exp(i / 180) : 800 * Math.exp(-i / 180);
      result = analyser.process(tone({ time: i / 60, frequency }));
    }
    assert.ok(result.frequencyTrend * sign > 0.15, `trend ${result.frequencyTrend}`);
    assert.ok(Math.abs(result.amplitudeTrend) < 0.001);
    assert.equal(result.pitchHz, 0);
  }
});

test('crescendo and diminuendo expose amplitude direction independently of frequency', () => {
  for (const sign of [1, -1]) {
    const analyser = new MotionFeatures({ estimatePitch: false });
    let result;
    for (let i = 0; i < 180; i++) {
      const amplitude = sign > 0 ? 0.04 * Math.exp(i / 120) : 0.4 * Math.exp(-i / 120);
      result = analyser.process(tone({ time: i / 60, amplitude }));
    }
    assert.ok(result.amplitudeTrend * sign > 0.12, `trend ${result.amplitudeTrend}`);
    assert.ok(Math.abs(result.frequencyTrend) < 0.001);
  }
});

test('silence and source reset do not create false upward motion', () => {
  const analyser = new MotionFeatures();
  analyser.process(tone({ time: 0, frequency: 200, amplitude: 0.02 }));
  const silence = analyser.process({
    spectrum: new Float32Array(1024),
    wave: new Float32Array(2048),
    time: 0.02,
    rms: 0,
    beatFeatures: { silent: 1 },
  });
  assert.ok(
    Object.entries(silence)
      .filter(([key]) => key !== 'toneStyle')
      .every(([, value]) => value === 0),
  );
  assert.equal(silence.toneStyle.valid, false);
  assert.equal(silence.toneStyle.hit, false);
  let resumed = analyser.process(tone({ time: 0.04, frequency: 900, amplitude: 0.4 }));
  assert.equal(resumed.amplitudeTrend, 0);
  assert.equal(resumed.frequencyTrend, 0);
  assert.equal(resumed.attack, 0);
  analyser.reset();
  resumed = analyser.process(tone({ time: 0.06, frequency: 1000, amplitude: 0.5 }));
  assert.equal(resumed.amplitudeTrend, 0);
  assert.equal(resumed.frequencyTrend, 0);
});

test('noise has greater flatness than a tone and is not reported as a trusted pitch', () => {
  const analyser = new MotionFeatures();
  let seed = 86421;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  let result;
  for (let frame = 0; frame < 30; frame++) {
    const wave = Float32Array.from({ length: fftSize }, () => random() * 0.2);
    const spectrum = Float32Array.from({ length: fftSize / 2 }, () => 0.0015 + Math.abs(random()) * 0.001);
    result = analyser.process({
      spectrum,
      wave,
      time: frame / 60,
      rms: 0.1,
      beatFeatures: { silent: 0, phase: 0 },
    });
  }
  assert.ok(result.noisiness > 0.8, `flatness ${result.noisiness}`);
  assert.equal(result.pitchHz, 0);
  assert.ok(result.pitchConfidence < 0.85);
  assert.equal(result.pitchTrend, 0);
});

test('attack responds to an actual amplitude increase and phase is only beat phase', () => {
  const analyser = new MotionFeatures({ estimatePitch: false });
  analyser.process(tone({ time: 0, amplitude: 0.05, phase: 0.3 }));
  const hit = analyser.process(tone({ time: 0.02, amplitude: 0.3, phase: 0.4 }));
  assert.ok(hit.attack > 0.8);
  assert.equal(hit.beatPhase, 0.4);
});

test('all output values are finite with documented units and signed trend bounds', () => {
  const analyser = new MotionFeatures();
  for (let i = 0; i < 120; i++) {
    const result = analyser.process(
      tone({ time: i / 60, frequency: 200 + i * 3, amplitude: 0.1 + i * 0.002 }),
    );
    for (const [key, value] of Object.entries(result)) {
      if (key === 'toneStyle') {
        assert.ok(value.valid && Number.isSafeInteger(value.sequence));
        assert.ok(Number.isFinite(value.intensity) && value.intensity >= 0 && value.intensity <= 1);
        continue;
      }
      assert.ok(Number.isFinite(value), `${key} must be finite`);
      if (key.endsWith('Trend')) assert.ok(value >= -1 && value <= 1, key);
      else if (key.endsWith('Hz')) assert.ok(value >= 0 && value <= 16000, key);
      else assert.ok(value >= 0 && value <= 1, key);
    }
  }
});

test('optional pitch is throttled and exposes a direction only for trusted periodic signals', () => {
  const analyser = new MotionFeatures();
  const first = analyser.process(tone({ time: 0, frequency: 220 }));
  const held = analyser.process(tone({ time: 0.03, frequency: 330 }));
  assert.ok(Math.abs(first.pitchHz - 220) < 2);
  assert.equal(held.pitchHz, first.pitchHz);
  const updated = analyser.process(tone({ time: 0.15, frequency: 330 }));
  assert.ok(Math.abs(updated.pitchHz - 330) < 2);
  assert.ok(updated.pitchConfidence > 0.95);
  assert.ok(updated.pitchTrend > 0.1);
});

test('out-of-range 11.3 kHz and 1.8 kHz tones cannot become trusted low pitches', () => {
  for (const frequency of [11300, 1800]) {
    const analyser = new MotionFeatures();
    let result;
    for (let i = 0; i < 20; i++) result = analyser.process(tone({ time: i / 60, frequency }));
    assert.ok(Math.abs(result.centroidHz - frequency) < 0.01);
    assert.equal(result.pitchHz, 0);
    assert.equal(result.pitchTrend, 0);
    assert.equal(result.pitchConfidence, 0);
  }
});

test('current incompatible spectrum clears a held trusted pitch before the next expensive scan', () => {
  const analyser = new MotionFeatures();
  const low = analyser.process(tone({ time: 0, frequency: 220 }));
  assert.ok(low.pitchConfidence > 0.95 && low.pitchHz > 0);
  const high = analyser.process(tone({ time: 0.01, frequency: 11300 }));
  assert.equal(analyser.lastPitchTime, 0, 'no additional scan is required to invalidate it');
  assert.equal(high.pitchHz, 0);
  assert.equal(high.pitchConfidence, 0);
  assert.equal(high.pitchTrend, 0);
});

test('unsuccessful mixed-signal pitch estimation backs off instead of scanning every interval', () => {
  const analyser = new MotionFeatures();
  const spectrum = new Float32Array(1024);
  spectrum[4] = 0.12;
  spectrum[6] = 0.08;
  spectrum[9] = 0.04;
  let seed = 1842,
    estimates = 0,
    previousTime = -Infinity;
  for (let frame = 0; frame < 180; frame++) {
    const time = frame / 60;
    const wave = Float32Array.from({ length: fftSize }, (_, i) => {
      const t = time + i / sampleRate;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (
        0.07 * Math.sin(2 * Math.PI * 110 * t) +
        0.06 * Math.sin(2 * Math.PI * 137.2 * t) +
        0.03 * Math.sin(2 * Math.PI * 211.7 * t) +
        (seed / 4294967296 - 0.5) * 0.06
      );
    });
    analyser.process({ spectrum, wave, time, rms: 0.15, beatFeatures: { silent: 0 } });
    if (analyser.lastPitchTime !== previousTime) estimates++;
    previousTime = analyser.lastPitchTime;
  }
  assert.ok(estimates >= 5 && estimates <= 12, 'estimates: ' + estimates);
  assert.equal(analyser.pitchHz, 0);
  analyser.reset();
  assert.equal(analyser.nextPitchTime, -Infinity);
  assert.equal(analyser.pitchFailures, 0);
});

test('AudioController emits the extended contract and resets trends on source changes and pause', () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const audio = new AudioController();
    let current = tone({ time: 0, frequency: 220 });
    audio.context = { sampleRate, currentTime: 0 };
    audio.node = {};
    audio.suspended = false;
    audio.spectrum = new Float32Array(1024);
    audio.decibels = new Float32Array(1024);
    audio.wave = new Float32Array(2048);
    audio.detector = new BeatDetector();
    audio.analyser = {
      fftSize,
      getFloatFrequencyData: (array) =>
        array.set(
          Float32Array.from(current.spectrum, (value) => (value ? 20 * Math.log10(value) : -Infinity)),
        ),
      getFloatTimeDomainData: (array) => array.set(current.wave),
    };
    const first = audio.sample();
    assert.ok(first.amplitude > 0 && first.frequencyHz > 0);
    assert.equal(first.amplitudeTrend, 0);
    assert.equal(first.beatPhase, first.phase);
    audio.context.currentTime = 0.02;
    current = tone({ time: 0.02, frequency: 880, amplitude: 0.5 });
    audio.node = {};
    const switched = audio.sample();
    assert.equal(switched.amplitudeTrend, 0);
    assert.equal(switched.frequencyTrend, 0);
    audio.suspended = true;
    const paused = audio.sample();
    assert.equal(paused.amplitude, 0);
    assert.equal(paused.signalValid, 0);
    assert.equal(paused.pitchHz, 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('AudioController bounds DSP cadence and QA capture uses audio time rather than render frames', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { desktop: { testMode: true }, __wadCollectTrace: true };
  try {
    const audio = new AudioController();
    const current = tone({ frequency: 440 });
    let reads = 0;
    audio.context = { sampleRate, currentTime: 0 };
    audio.node = {};
    audio.suspended = false;
    audio.spectrum = new Float32Array(1024);
    audio.decibels = new Float32Array(1024);
    audio.wave = new Float32Array(2048);
    audio.detector = new BeatDetector();
    audio.analyser = {
      fftSize,
      getFloatFrequencyData: (array) => {
        reads++;
        array.set(
          Float32Array.from(current.spectrum, (value) => (value ? 20 * Math.log10(value) : -Infinity)),
        );
      },
      getFloatTimeDomainData: (array) => array.set(current.wave),
    };
    const initial = audio.sample();
    for (let frame = 1; frame <= 1000; frame++) {
      audio.context.currentTime = frame / 1000;
      const snapshot = audio.sample();
      if (frame < 11) assert.equal(snapshot, initial);
    }
    assert.ok(reads <= 91, 'DSP reads ' + reads);
    const trace = globalThis.window.__wadAudioTrace;
    assert.ok(trace.length >= 16 && trace.length <= 21, 'QA trace frames ' + trace.length);
    for (let i = 1; i < trace.length; i++) assert.ok(trace[i].time - trace[i - 1].time >= 0.05 - 1e-8);
    assert.equal(globalThis.window.__wadAudioTraceMeta.maxAnalysisHz, 90);
    assert.equal(globalThis.window.__wadAudioTraceMeta.sampleRate, sampleRate);

    // A renderer flag in a production bridge cannot turn on spectrum capture.
    globalThis.window = { desktop: { testMode: false }, __wadCollectTrace: true };
    audio.context.currentTime = 2;
    audio.sample();
    assert.equal(globalThis.window.__wadAudioTrace, undefined);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
