import test from 'node:test';
import assert from 'node:assert/strict';
import { ToneStyleAnalyzer } from '../src/audio/tone-style.js';
import { MotionFeatures } from '../src/audio/motion-features.js';
import { DrumDetector } from '../src/audio/drum-detector.js';
import { AudioController } from '../src/audio/audio-controller.js';
import { BeatDetector } from '../src/audio/beat-detector.js';
import { toneStylePcm } from './helpers/tone-style-pcm.mjs';

function measure(profile, fps = 60, phase = 0, fixtureOptions = {}) {
  const fixture = toneStylePcm({ profile, ...fixtureOptions });
  const features = new MotionFeatures({ sampleRate: fixture.sampleRate, fftSize: fixture.fftSize });
  const drums = new DrumDetector({ sampleRate: fixture.sampleRate, fftSize: fixture.fftSize });
  const rows = [],
    events = [],
    drumEvents = [];
  for (let frame = 0; frame < fixture.seconds * fps; frame++) {
    const input = fixture.frame((frame + phase) / fps);
    const result = features.process({ ...input, beatFeatures: { silent: input.rms < 0.00003 ? 1 : 0 } });
    const drum = drums.process({ ...input, spectrum: input.rawSpectrum });
    rows.push({ time: input.time, ...result.toneStyle });
    if (result.toneStyle.hit) events.push({ time: input.time, ...result.toneStyle });
    if (drum.hit) drumEvents.push({ time: input.time, weight: drum.weight });
  }
  return { fixture, features, rows, events, drumEvents };
}

test('actual PCM envelope/spectrum paths select all five styles without profile/BPM labels', () => {
  for (const profile of ['pulse', 'pluck', 'lead', 'pad', 'noise']) {
    const result = measure(profile);
    const settled = result.rows.filter((row) => row.time >= 2);
    const correct = settled.filter((row) => row.kind === profile && row.confidence >= 0.55);
    assert.ok(
      correct.length / settled.length >= 0.65,
      `${profile}: ${JSON.stringify(Object.fromEntries([...new Set(settled.map((r) => r.kind))].map((kind) => [kind, settled.filter((r) => r.kind === kind).length])))}`,
    );
    assert.ok(settled.every((row) => row.valid && row.intensity > 0));
    assert.ok(result.features.toneStyle.events.length <= 24);
    for (const row of result.rows) {
      for (const key of ['confidence', 'intensity', 'strength'])
        assert.ok(Number.isFinite(row[key]) && row[key] >= 0 && row[key] <= 1);
      assert.ok(Number.isSafeInteger(row.sequence) && row.sequence >= 0);
      assert.ok(Number.isFinite(row.trend) && Math.abs(row.trend) <= 1);
    }
  }
});

test('physical tone identities, weights and five styles remain consistent across cadence and sampling phase', () => {
  const means = { pulse: [], pluck: [], 'drum-weights': [] };
  for (const fps of [30, 50, 59.94, 60, 90, 120]) {
    for (const phase of [0, 0.37]) {
      for (const profile of ['pulse', 'pluck', 'lead', 'pad', 'noise', 'drum-weights']) {
        const { fixture, rows, events } = measure(profile, fps, phase);
        const context = `${profile} ${fps}Hz phase ${phase}`;
        if (profile !== 'drum-weights') {
          const settled = rows.filter((row) => row.time >= 2);
          assert.ok(
            settled.filter((row) => row.kind === profile && row.confidence >= 0.55).length / settled.length >=
              0.8,
            context,
          );
        }
        assert.equal(events.length, fixture.attacks.length, `${context}: no missing or extra attacks`);
        assert.equal(new Set(events.map((event) => event.sequence)).size, events.length, context);
        for (const attack of fixture.attacks) {
          const event = events.find((row) => row.time >= attack.time && row.time <= attack.time + 0.08);
          assert.ok(event, `${context}: physical attack at ${attack.time}`);
        }
        if (events.length) {
          means[profile].push(events.reduce((sum, event) => sum + event.strength, 0) / events.length);
          if (profile === 'drum-weights') {
            const groups = { heavy: [], light: [] };
            for (const attack of fixture.attacks) {
              const event = events.find((row) => row.time >= attack.time && row.time <= attack.time + 0.08);
              groups[attack.weight > 0.2 ? 'heavy' : 'light'].push(event.strength);
            }
            const mean = (items) => items.reduce((sum, value) => sum + value, 0) / items.length;
            assert.ok(mean(groups.heavy) > mean(groups.light) * 1.25, `${context}: physical weight order`);
          }
        }
      }
    }
  }
  for (const [profile, values] of Object.entries(means)) {
    assert.ok(
      Math.max(...values) - Math.min(...values) <= 0.08,
      `${profile}: attack strength depends on sound, not render cadence`,
    );
  }
});

test('a physical gradual eight-per-second logarithmic attack is measured once at every cadence', () => {
  const strengths = [];
  for (const fps of [30, 50, 59.94, 60, 90, 120]) {
    for (const phase of [0, 0.37]) {
      const { fixture, events } = measure('gradual-attack', fps, phase);
      assert.equal(events.length, 2, `${fps}Hz phase ${phase}: one identity per actual rise`);
      assert.deepEqual(
        events.map((event) => event.sequence),
        [1, 2],
      );
      for (const attack of fixture.attacks) {
        assert.ok(
          events.some((event) => event.time >= attack.time && event.time <= attack.time + 0.16),
          `${fps}Hz phase ${phase}: late or missing gradual attack`,
        );
      }
      strengths.push(events.reduce((sum, event) => sum + event.strength, 0) / events.length);
    }
  }
  assert.ok(Math.max(...strengths) - Math.min(...strengths) <= 0.08);
});

test('exact zero-background short plucks retain decay identity across gaps without quiet hits', () => {
  for (const fps of [30, 50, 59.94, 60, 90, 120]) {
    for (const phase of [0, 0.37]) {
      const { fixture, rows, events, features } = measure('pluck', fps, phase, {
        background: 0,
        noteSeconds: 0.12,
      });
      const context = `${fps}Hz phase ${phase}`;
      // These are literal zero samples, not a noise floor that hides reset bugs.
      assert.ok(
        fixture.samples.subarray(0, Math.floor(0.3 * fixture.sampleRate)).every((value) => value === 0),
      );
      assert.ok(
        fixture.samples
          .subarray(Math.ceil(0.44 * fixture.sampleRate), Math.floor(0.84 * fixture.sampleRate))
          .every((value) => value === 0),
      );
      assert.equal(events.length, fixture.attacks.length, `${context}: all actual notes identified`);
      assert.equal(new Set(events.map((event) => event.sequence)).size, fixture.attacks.length);
      for (const attack of fixture.attacks)
        assert.ok(
          events.some((event) => event.time >= attack.time && event.time <= attack.time + 0.08),
          context,
        );
      const quiet = rows.filter((row) => !row.valid);
      assert.ok(quiet.length > rows.length / 2);
      assert.ok(quiet.every((row) => !row.hit && row.strength === 0));
      const settled = rows.filter((row) => row.valid && row.time >= 2);
      assert.ok(
        settled.every((row) => row.kind === 'pluck' && row.confidence > 0.55),
        `${context}: pluck style survives its silent gaps`,
      );
      const sequence = features.toneStyle.sequence;
      let silence;
      for (let frame = 0; frame <= fps * 1.1; frame++) {
        silence = features.process({
          spectrum: new Float32Array(512),
          wave: new Float32Array(1024),
          rms: 0,
          time: 5 + frame / fps,
          beatFeatures: { silent: 1 },
        });
        assert.ok(
          Object.entries(silence)
            .filter(([key]) => key !== 'toneStyle')
            .every(([, value]) => value === 0),
          'old continuous features remain quiet',
        );
        assert.equal(silence.toneStyle.hit, false);
      }
      assert.equal(silence.toneStyle.kind, null, 'long observed quiet clears history');
      assert.equal(silence.toneStyle.confidence, 0);
      assert.equal(silence.toneStyle.sequence, sequence);
      assert.equal(features.toneStyle.events.length, 0);
      features.reset();
      assert.equal(
        features.toneStyle.kind,
        null,
        'explicit source reset immediately clears even a short quiet history',
      );
    }
  }
});

test('smooth sustained tones select a kind without requiring a drum or a tone hit', () => {
  for (const profile of ['lead', 'pad']) {
    const result = measure(profile);
    assert.ok(result.rows.some((row) => row.kind === profile && row.confidence > 0.6));
    assert.equal(result.events.length, 0, `${profile}: slow envelope cannot invent impulses`);
  }
});

test('invalid spectrum with nonzero RMS is not interpreted as an observed silence baseline', () => {
  const { features, fixture } = measure('pulse');
  const sequence = features.toneStyle.sequence;
  let invalid;
  for (const time of [5.01, 5.04, 5.07, 5.1])
    invalid = features.process({ spectrum: new Float32Array(512), rms: 0.12, time });
  assert.equal(invalid.toneStyle.kind, null);
  assert.equal(invalid.toneStyle.hit, false);
  assert.equal(features.toneStyle.attackArmed, false);
  const resumed = features.process({ ...fixture.frame(0.4), time: 5.13, beatFeatures: { silent: 0 } });
  assert.equal(resumed.toneStyle.sequence, sequence);
  assert.equal(resumed.toneStyle.hit, false);
});

test('tone attacks have unique IDs, bounded rate and differ from perpetual high attack flags', () => {
  const result = measure('pulse');
  assert.ok(result.events.length >= 6 && result.events.length <= result.fixture.attacks.length);
  assert.equal(new Set(result.events.map((row) => row.sequence)).size, result.events.length);
  for (let i = 1; i < result.events.length; i++)
    assert.ok(result.events[i].time - result.events[i - 1].time >= 0.09);
  const style = new ToneStyleAnalyzer();
  const constant = {
    amplitude: 0.15,
    attack: 1,
    amplitudeRise: 1,
    pitchConfidence: 1,
    brightness: 0.55,
    signalValid: 1,
  };
  for (let frame = 0; frame < 240; frame++)
    style.update(constant, frame / 60, { spectralConcentration: 0.6 });
  assert.equal(style.sequence, 0, 'cached attack cannot substitute for a physical amplitude rise');
});

test('actual heavy and light drum envelopes preserve weighted accent evidence', () => {
  const result = measure('drum-weights', 90);
  const match = (events, attack) =>
    events.find((event) => event.time >= attack.time && event.time <= attack.time + 0.12);
  const groups = { heavy: [], light: [] },
    drumGroups = { heavy: [], light: [] };
  for (const attack of result.fixture.attacks) {
    const event = match(result.events, attack),
      drum = match(result.drumEvents, attack);
    assert.ok(event && drum, `actual attack ${attack.time}`);
    const group = attack.weight > 0.2 ? 'heavy' : 'light';
    groups[group].push(
      Math.max(
        ...result.rows
          .filter((r) => r.time >= attack.time && r.time < attack.time + 0.25)
          .map((r) => r.intensity),
      ),
    );
    drumGroups[group].push(drum.weight);
  }
  const mean = (items) => items.reduce((a, b) => a + b, 0) / items.length;
  assert.ok(
    mean(groups.heavy) > mean(groups.light) * 1.2,
    'continuous tone intensity distinguishes physical envelope weights',
  );
  assert.ok(
    mean(drumGroups.heavy) > mean(drumGroups.light) * 1.2,
    'actual drum weights remain a separate overlay input',
  );
});

test('silence, source reset, pause and gaps retire evidence but preserve monotonic event identities', () => {
  const result = measure('pulse');
  const model = result.features;
  const sequence = model.toneStyle.sequence;
  assert.ok(sequence > 0);
  const silence = model.process({
    spectrum: new Float32Array(512),
    wave: new Float32Array(1024),
    rms: 0,
    time: 6,
    beatFeatures: { silent: 1 },
  });
  assert.equal(silence.toneStyle.kind, null);
  assert.equal(silence.toneStyle.hit, false);
  assert.equal(silence.toneStyle.sequence, sequence);
  model.reset();
  assert.equal(model.toneStyle.sequence, sequence);
  const style = new ToneStyleAnalyzer();
  style.update({ amplitude: 0.02, pitchConfidence: 1, signalValid: 1 }, 0, { spectralConcentration: 0.6 });
  style.update({ amplitude: 0.02, pitchConfidence: 1, signalValid: 1 }, 0.05, { spectralConcentration: 0.6 });
  style.update({ amplitude: 0.03, pitchConfidence: 1, signalValid: 1 }, 0.1, { spectralConcentration: 0.6 });
  style.update({ amplitude: 0.03, pitchConfidence: 1, signalValid: 1 }, 0.13, { spectralConcentration: 0.6 });
  const before = style.getState();
  assert.equal(before.hit, true);
  assert.equal(style.update({ amplitude: 0.3, attack: 1, signalValid: 1 }, 10, { paused: true }).hit, false);
  const resumed = style.update({ amplitude: 0.03, pitchConfidence: 1, signalValid: 1 }, 10.02, {
    spectralConcentration: 0.6,
  });
  assert.equal(resumed.sequence, before.sequence);
  assert.equal(resumed.hit, false);
  const gap = style.update({ amplitude: 0.6, attack: 1, signalValid: 1 }, 20, { spectralConcentration: 0.6 });
  assert.equal(gap.hit, false);
  assert.equal(gap.sequence, before.sequence);
});

test('pausing an unfinished measured attack consumes it rather than deferring it until resume', () => {
  const style = new ToneStyleAnalyzer();
  const update = (amplitude, time, options) =>
    style.update({ amplitude, pitchConfidence: 1, signalValid: 1 }, time, {
      spectralConcentration: 0.6,
      ...options,
    });
  update(0.02, 0);
  update(0.02, 0.06);
  assert.equal(update(0.08, 0.08).hit, false, 'actual attack is pending causal peak confirmation');
  assert.ok(style.pendingAttack);
  update(0.08, 10, { paused: true });
  assert.equal(style.pendingAttack, null);
  assert.equal(update(0.08, 10.04).hit, false);
  assert.equal(update(0.08, 10.09).hit, false);
  assert.equal(style.sequence, 0);
  update(0.02, 10.11);
  update(0.02, 10.18);
  update(0.08, 10.2);
  const newAttack = update(0.08, 10.23);
  assert.equal(newAttack.hit, true, 'a new post-resume physical rise still works');
  assert.equal(newAttack.sequence, 1);
  assert.deepEqual(update(0.08, 10.23), newAttack, 'duplicate snapshots keep one identity');
});

test('production AudioController carries real PCM tone state and retires pause/source evidence', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const fixture = toneStylePcm({ profile: 'pulse', sampleRate: 48000, fftSize: 2048 });
    let input = fixture.frame(0);
    const audio = new AudioController();
    audio.context = { sampleRate: 48000, currentTime: 0, resume: async () => {} };
    audio.mode = 'system';
    audio.node = {};
    audio.suspended = false;
    audio.spectrum = new Float32Array(1024);
    audio.decibels = new Float32Array(1024);
    audio.wave = new Float32Array(2048);
    audio.detector = new BeatDetector();
    audio.analyser = {
      fftSize: 2048,
      getFloatFrequencyData: (array) =>
        array.set(Float32Array.from(input.spectrum, (value) => (value ? 20 * Math.log10(value) : -Infinity))),
      getFloatTimeDomainData: (array) => array.set(input.wave),
    };
    const sample = (time, sourceTime = time) => {
      input = fixture.frame(sourceTime);
      audio.context.currentTime = time;
      return audio.sample();
    };
    const observed = [];
    for (let frame = 0; frame <= 72; frame++) {
      const output = sample(frame / 60);
      if (output.toneStyle.hit) observed.push(output.toneStyle.sequence);
      assert.equal(output.phase, output.beatPhase);
      assert.ok(Number.isFinite(output.frequencyHz) && Number.isFinite(output.amplitude));
    }
    assert.deepEqual([...new Set(observed)], [1, 2]);
    const sequence = audio.motionFeatures.toneStyle.sequence;
    await audio.setPaused(true);
    const paused = audio.sample();
    assert.equal(paused.toneStyle.valid, false);
    assert.equal(paused.toneStyle.hit, false);
    await audio.setPaused(false);
    const resumed = sample(1.4);
    assert.equal(resumed.toneStyle.sequence, sequence);
    assert.equal(resumed.toneStyle.hit, false, 'a held pulse at resume is not a new rise');
    audio.node = {};
    const switched = sample(2, 0.45);
    assert.equal(switched.toneStyle.sequence, sequence);
    assert.equal(switched.toneStyle.hit, false);
    assert.equal(switched.toneStyle.kind, null);
    assert.equal(switched.frequencyTrend, 0);
    assert.equal(switched.amplitudeTrend, 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
