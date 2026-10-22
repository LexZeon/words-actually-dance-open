import test from 'node:test';
import assert from 'node:assert/strict';
import { DrumDetector } from '../src/audio/drum-detector.js';
import { AudioController } from '../src/audio/audio-controller.js';
import { BlackmanFft, pcmRhythm } from './helpers/pcm-rhythm.mjs';

function rhythmFrames(seconds = 2) {
  const fixture = pcmRhythm({ seconds, offset: 0.2, bpm: 120 });
  const fft = new BlackmanFft(fixture.fftSize);
  const raw = new Float32Array(fixture.fftSize / 2);
  return {
    ...fixture,
    frame(time) {
      const frame = fixture.frame(time);
      fft.process(frame.wave, raw);
      return { ...frame, spectrum: raw };
    },
  };
}

test('drum events require measured PCM attacks before any tempo is available', () => {
  const fixture = rhythmFrames();
  const detector = new DrumDetector(fixture);
  const events = [];
  for (let frame = 0; frame < 180; frame++) {
    const measured = fixture.frame(frame / 90);
    const result = detector.process(measured);
    if (result.hit) events.push(result);
    for (const key of ['weight', 'strength', 'confidence', 'envelope'])
      assert.ok(Number.isFinite(result[key]) && result[key] >= 0 && result[key] <= 1, key);
  }
  assert.equal(events.length, fixture.hits.length);
  assert.ok(events[0].time >= fixture.hits[0] && events[0].time - fixture.hits[0] < 0.07);
  assert.equal(events[0].kind, 'thump');
  assert.ok(events.every((event, index) => event.sequence === index + 1));
});

test('repeated analysis time, silence, reset and discontinuities never replay an old attack', () => {
  const fixture = rhythmFrames();
  const detector = new DrumDetector(fixture);
  let event, frameAtHit;
  for (let frame = 0; frame < 90; frame++) {
    const measured = fixture.frame(frame / 90);
    const result = detector.process(measured);
    if (result.hit) {
      event = result;
      frameAtHit = measured;
      break;
    }
  }
  assert.ok(event);
  const repeated = detector.process(frameAtHit);
  assert.equal(repeated.hit, false);
  assert.equal(repeated.sequence, event.sequence);
  detector.reset();
  const first = detector.process(frameAtHit);
  assert.equal(first.hit, false, 'a new source primes its current spectrum');
  assert.equal(first.sequence, event.sequence);
  assert.equal(first.envelope, 0);
  for (let frame = 30; frame < 90; frame++) detector.process(fixture.frame(frame / 90));
  const beforeGap = detector.sequence;
  const gap = detector.process(fixture.frame(1.5));
  assert.equal(gap.hit, false);
  assert.equal(gap.envelope, 0);
  assert.equal(gap.sequence, beforeGap);
  const reversed = detector.process(fixture.frame(1.4));
  assert.equal(reversed.hit, false);
  assert.equal(reversed.envelope, 0);
  const silence = { spectrum: new Float32Array(1024), wave: new Float32Array(2048), rms: 0 };
  let quiet;
  for (let frame = 0; frame < 100; frame++) quiet = detector.process({ ...silence, time: 2 + frame / 90 });
  assert.equal(quiet.hit, false);
  assert.equal(quiet.kind, null);
  assert.equal(quiet.weight, 0);
  assert.equal(quiet.envelope, 0);
});

test('steady tonal PCM and stationary noise do not become ongoing percussion', () => {
  const fft = new BlackmanFft(2048);
  const raw = new Float32Array(1024);
  for (const mode of ['tone', 'noise']) {
    const detector = new DrumDetector();
    let seed = 7621,
      afterSettling = 0;
    for (let frame = 0; frame < 360; frame++) {
      const time = frame / 90;
      const wave = Float32Array.from({ length: 2048 }, (_, index) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return mode === 'tone'
          ? 0.18 * Math.sin(2 * Math.PI * 220 * (time + index / 48000))
          : (seed / 4294967296 - 0.5) * 0.16;
      });
      fft.process(wave, raw);
      const rms = Math.sqrt(wave.reduce((sum, value) => sum + value ** 2, 0) / wave.length);
      const result = detector.process({ spectrum: raw, wave, time, rms });
      if (time > 0.75 && result.hit) afterSettling++;
    }
    assert.equal(afterSettling, 0, mode);
  }
});

test('audio controller uses an unsmoothed attack analyser and owns its complete lifecycle', async () => {
  const savedWindow = globalThis.window,
    savedAudioContext = globalThis.AudioContext;
  const fixture = rhythmFrames();
  let measured = fixture.frame(0);
  const analysers = [];
  globalThis.window = {};
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.destination = {};
    }
    createAnalyser() {
      const index = analysers.length;
      const node = {
        frequencyBinCount: 1024,
        disconnected: 0,
        connections: [],
        connect(target) {
          this.connections.push(target);
        },
        disconnect() {
          this.disconnected++;
        },
        getFloatFrequencyData(array) {
          // The tempo input has no attack evidence: only the separate current
          // spectrum can produce this test's percussion hit.
          array.set(
            Float32Array.from(measured.spectrum, (value) =>
              index && value ? 20 * Math.log10(value) : -Infinity,
            ),
          );
        },
        getFloatTimeDomainData(array) {
          array.set(measured.wave);
        },
      };
      analysers.push(node);
      return node;
    }
    createGain() {
      return { gain: { value: 0 }, connect() {}, disconnect() {} };
    }
    close() {
      return Promise.resolve();
    }
  };
  const audio = new AudioController();
  try {
    await audio.initialize();
    assert.equal(analysers[0].smoothingTimeConstant, 0.45);
    assert.equal(analysers[1].smoothingTimeConstant, 0);
    assert.equal(analysers[0].connections[0], analysers[1]);
    audio.node = { stop() {}, disconnect() {} };
    audio.mode = 'system';
    audio.suspended = false;
    let event;
    for (let frame = 0; frame < 40; frame++) {
      measured = fixture.frame(frame / 90);
      audio.context.currentTime = measured.time;
      const value = audio.sample();
      assert.equal(value.beat, 0);
      assert.equal(value.bpm, 0);
      if (value.drum.hit) {
        event = value.drum;
        assert.equal(audio.sample().drum.sequence, event.sequence, 'cached frame retains event identity');
        break;
      }
    }
    assert.ok(event, 'a genuine attack does not wait for a tempo estimate');
    await audio.setPaused(true);
    assert.equal(audio.sample().drum.hit, false);
    assert.equal(audio.sample().drum.envelope, 0);
    assert.equal(audio.drumDetector.envelope, 0);
    assert.equal(audio.sampleSnapshot, null);
    await audio.destroy();
    assert.ok(analysers.every((analyser) => analyser.disconnected === 1));
    assert.equal(audio.drumDetector, null);
    assert.equal(audio.drumSpectrum, null);
  } finally {
    await audio.destroy();
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
    if (savedAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = savedAudioContext;
  }
});
