import test from 'node:test';
import assert from 'node:assert/strict';
import { MUSIC_SECTION_CASES, musicSectionPcmFixture } from './helpers/music-section-pcm-fixtures.mjs';
import { measureMusicSectionFixture } from '../scripts/music-section-benchmark.mjs';

test('original PCM arrangements reject fills and steady music but retain sustained relative changes', () => {
  const results = MUSIC_SECTION_CASES.map((profile) =>
    measureMusicSectionFixture(musicSectionPcmFixture({ profile })),
  );
  for (const result of results) {
    assert.equal(
      result.pass,
      true,
      JSON.stringify({
        profile: result.profile,
        episodes: result.episodes,
        phrases: result.phrases,
        matched: result.matched,
      }),
    );
    assert.equal(result.labelsFedToDetector, false);
    assert.ok(result.voicedFrames > 100);
    assert.equal(result.phraseStarts, result.expectedChanges);
  }
});

test('compressed fixture changes source layers and articulation without increasing average RMS', () => {
  const fixture = musicSectionPcmFixture({ profile: 'compressed-layer-rise' });
  const rms = (from, to) => {
    const start = from * fixture.sampleRate,
      end = to * fixture.sampleRate;
    let square = 0;
    for (let index = start; index < end; index++) square += fixture.samples[index] ** 2;
    return Math.sqrt(square / (end - start));
  };
  assert.ok(Math.abs(rms(3, 6) - rms(12, 15)) < 0.00001);
  assert.equal(fixture.changes.length, 1);
  assert.deepEqual(Object.keys(fixture.frame(1)).sort(), ['rawSpectrum', 'rms', 'spectrum', 'time', 'wave']);
});

test('compressed section changes survive a 60 Hz renderer and fractional sampling phase', () => {
  for (const analysisHz of [59.94, 60]) {
    for (const fraction of [0, 0.37]) {
      const result = measureMusicSectionFixture(
        musicSectionPcmFixture({ profile: 'compressed-layer-rise' }),
        {
          analysisHz,
          phaseOffset: fraction / analysisHz,
        },
      );
      assert.equal(
        result.pass,
        true,
        JSON.stringify({ analysisHz, fraction, episodes: result.episodes, phrases: result.phrases }),
      );
      assert.equal(result.detectedEpisodes, 1);
      assert.equal(result.phraseStarts, 1);
    }
  }
});
