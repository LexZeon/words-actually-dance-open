import test from 'node:test';
import assert from 'node:assert/strict';
import { DrumDetector, ageDrumObservation } from '../src/audio/drum-detector.js';
import { BeatDetector } from '../src/audio/beat-detector.js';
import { BeatClock } from '../src/audio/beat-clock.js';
import { MotionFeatures } from '../src/audio/motion-features.js';
import { MotionDirector } from '../src/visuals/dance-motion.js';
import { KnowledgeDrumResponse } from '../src/visuals/knowledge-drum-response.js';
import { drumPcmFixture } from './helpers/drum-pcm-fixtures.mjs';

// Actual PCM and production detectors, never fixture labels/BPM as input. The
// display/analysis cadence matches the real controller's <=90Hz snapshot gate.
for (const fps of [30, 60, 144]) {
  test(`real PCM drum confirmations already change both visual poses at ${fps} display FPS`, () => {
    const fixture = drumPcmFixture({ profile: 'alternating-weight' });
    const drumDetector = new DrumDetector(fixture);
    const beatDetector = new BeatDetector(fixture);
    const features = new MotionFeatures({ ...fixture, estimatePitch: false });
    const clock = new BeatClock();
    const dance = new MotionDirector();
    const knowledge = new KnowledgeDrumResponse();
    const confirmations = [];
    let lastAnalysis = -Infinity,
      measured,
      lastSequence = -1;
    for (let frame = 0; frame / fps < fixture.seconds; frame++) {
      const time = frame / fps;
      if (time - lastAnalysis >= 1 / 90) {
        lastAnalysis = time;
        const pcm = fixture.frame(time);
        const beat = beatDetector.process(pcm);
        measured = {
          ...beat,
          ...features.process({ ...pcm, beatFeatures: beat }),
          drum: drumDetector.process(pcm),
        };
      } else measured = { ...measured, drum: ageDrumObservation(measured.drum, time) };
      const events = clock.update(measured, time),
        grid = clock.getState();
      const fresh = measured.drum.hit && measured.drum.sequence > lastSequence;
      if (fresh) lastSequence = measured.drum.sequence;
      const rendering = {
        ...measured,
        time,
        sourceGeneration: 1,
        bpm: grid.bpm,
        beatIndex: grid.beatIndex,
        beatPhase: grid.phase,
        beat: events.some((event) => event.kind === 'beat'),
        silent: 0,
        audioSilent: measured.silent,
        drum: { ...measured.drum, hit: fresh },
      };
      dance.update(rendering, time, { glyphCount: 4 });
      knowledge.update(rendering);
      if (!fresh) continue;
      const main = dance.sample(time, { glyphCount: 4, beatPhase: grid.phase });
      const reading = knowledge.sample(time);
      assert.equal(main.accent.sequence, measured.drum.sequence);
      assert.ok(main.accent.envelope > 0.5, 'No extra visual rise after a causal confirmation');
      assert.ok(reading.envelope > 0.8, 'The reading emphasis is already present in the same frame');
      assert.ok(main.drumPriority.gridGain <= 0.15);
      assert.ok(
        Math.abs(main.accent.ageSeconds - measured.drum.ageSeconds) < 1e-9,
        'Audio age is mapped causally to renderer elapsed',
      );
      // Evaluation-only labels establish physical latency; they never reached
      // any detector, clock, motion feature, or renderer above.
      const physical = fixture.hits.find((hit) => time >= hit.time && time - hit.time < 0.12);
      assert.ok(physical, `A visual response at ${time} must follow a real PCM attack`);
      confirmations.push({
        delay: time - physical.time,
        weight: measured.drum.weight,
        width: main.accent.pose.group.scaleX - 1,
        focus: reading.focusScale - 1,
      });
    }
    assert.equal(
      confirmations.length,
      fixture.hits.length,
      'Every original alternating pulse reaches both renderers',
    );
    assert.ok(
      Math.max(...confirmations.map((entry) => entry.delay)) < 0.1,
      'Physical onset-to-first-response includes real causal analysis, not a claimed zero latency',
    );
    const light = confirmations.filter((_, index) => index % 2 === 0);
    const heavy = confirmations.filter((_, index) => index % 2 === 1);
    const mean = (values, key) => values.reduce((sum, value) => sum + value[key], 0) / values.length;
    assert.ok(mean(heavy, 'width') > mean(light, 'width') * 1.1);
    assert.ok(mean(heavy, 'focus') > mean(light, 'focus') * 1.1);
  });
}
