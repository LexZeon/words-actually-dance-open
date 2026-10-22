import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MUSIC_SECTION_CASES } from './helpers/music-section-pcm-fixtures.mjs';
import { getLiveAudioState, installMusicSectionQA } from '../src/dev/music-section-qa.js';

const require = createRequire(import.meta.url);
const {
  createSectionQAFixtures,
  scoreNativeSectionResponse,
  runLiveSectionTest,
} = require('../electron/music-section-qa.cjs');
const references = () =>
  MUSIC_SECTION_CASES.map((name) => ({
    name,
    seconds: 25,
    changes:
      name === 'fall-and-rise'
        ? [
            { time: 7, until: 16 },
            { time: 25, until: 35 },
          ]
        : ['light-to-strong', 'compressed-layer-rise'].includes(name)
          ? [{ time: 7, until: 25 }]
          : [],
  }));
const actual = (refs) => ({
  files: refs.map((reference) => ({
    name: reference.name,
    episodes: reference.changes.map((change, index) => ({ time: change.time + 1.9, episode: index + 1 })),
    phrases: reference.changes.map((change, index) => ({
      time: change.time + 2,
      episodeId: index + 1,
      sourceGeneration: 1,
      sectionGeneration: 1,
      startBeat: 20 + index * 30,
      durationBeats: 8,
      visibleFrames: 150,
      maximumEnvelope: 0.9,
    })),
  })),
});

test('native fixture payload contains only playable audio; reference change times stay in the host', async () => {
  const fixtures = await createSectionQAFixtures(process.cwd());
  assert.equal(fixtures.payload.length, MUSIC_SECTION_CASES.length);
  assert.equal(fixtures.references.length, MUSIC_SECTION_CASES.length);
  for (const payload of fixtures.payload) {
    assert.deepEqual(Object.keys(payload).sort(), ['base64', 'name', 'seconds']);
    const wav = Buffer.from(payload.base64, 'base64');
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt32LE(24), 48000);
    assert.equal(wav.readUInt32LE(40), payload.seconds * 48000 * 2);
  }
});

test('independent native scoring requires each sustained change and one visible motion per episode', () => {
  const refs = references(),
    result = actual(refs);
  assert.equal(scoreNativeSectionResponse(result, refs).pass, true);
  for (const mutate of [
    (row) => row.episodes.pop(),
    (row) => row.episodes.push({ time: 18, episode: 3 }),
    (row) => row.phrases.push({ ...row.phrases[0], startBeat: 80 }),
    (row) => {
      row.phrases[0].visibleFrames = 0;
    },
    (row) => {
      row.phrases[0].episodeId = null;
    },
    (row) => {
      row.phrases[0].episodeId = 99;
    },
    (row) => {
      row.episodes[0].time = 11;
    },
  ]) {
    const changed = structuredClone(result);
    mutate(changed.files.find((row) => row.name === 'light-to-strong'));
    assert.equal(scoreNativeSectionResponse(changed, refs).pass, false);
  }
});

test('steady DJ, periodic heavy drums and short fills cannot pass as extra section evidence', () => {
  const refs = references();
  for (const name of ['steady-dj', 'periodic-heavy', 'short-fill', 'gain-only']) {
    const result = actual(refs);
    const row = result.files.find((row) => row.name === name);
    row.episodes.push({ time: 9, episode: 1 });
    const score = scoreNativeSectionResponse(result, refs);
    assert.equal(score.pass, false);
    assert.equal(score.files.find((row) => row.name === name).extraEpisodes, 1);
  }
});

test('missing or duplicate fixture files cannot produce a successful aggregate', () => {
  const refs = references();
  assert.equal(scoreNativeSectionResponse({ files: [] }, refs).pass, false);
  const repeated = refs.map((row) => ({ ...row, name: 'same' }));
  assert.equal(scoreNativeSectionResponse(actual(repeated), repeated).pass, false);
  const extra = actual(refs);
  extra.files.push(structuredClone(extra.files[0]));
  assert.equal(scoreNativeSectionResponse(extra, refs).pass, false);
});

test('live observation success requires actual voiced system audio and a live audio track', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'wad-section-host-'));
  try {
    const valid = {
      actualWebAudio: true,
      captureUsable: true,
      sourceMode: 'system',
      frameCount: 100,
      voicedFrames: 90,
      audioTracks: [{ readyState: 'live' }],
      finiteCanvas: true,
      canvasWithinBounds: true,
      episodes: [],
      phrases: [],
    };
    for (const [changes, expected] of [
      [{}, true],
      [{ voicedFrames: 0 }, false],
      [{ audioTracks: [] }, false],
      [{ sourceMode: 'file' }, false],
      [{ captureUsable: false }, false],
    ]) {
      let exitCode = null;
      const result = await runLiveSectionTest(
        {
          getBounds: () => ({ x: 2600, y: 0, width: 1280, height: 920 }),
          webContents: {
            executeJavaScript: async (code, gesture) => {
              if (code.startsWith('new Promise')) return true;
              assert.equal(gesture, true);
              return { ...valid, ...changes };
            },
          },
        },
        [],
        {
          workspace,
          duration: 1000,
          selectedDisplay: { id: 50117728, label: 'ASUS PA279' },
          app: {
            exit(code) {
              exitCode = code;
            },
          },
        },
      );
      assert.equal(result.success, expected);
      assert.equal(exitCode, expected ? 0 : 1);
      assert.equal(result.sectionAccuracy, null);
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('live diagnostics distinguish app playback, audio pause and a running context without resuming anything', () => {
  const app = {
    state: { playing: true },
    playback: { playing: true },
    audio: {
      suspended: false,
      mode: 'system',
      context: { state: 'running', currentTime: 12 },
      node: {},
      analyser: {},
      drumAnalyser: {},
    },
  };
  assert.deepEqual(getLiveAudioState(app), {
    appPlaying: true,
    playbackPlaying: true,
    audioSuspended: false,
    contextState: 'running',
    contextTime: 12,
    sourceMode: 'system',
    sourceNodePresent: true,
    analyserPresent: true,
    rawDrumAnalyserPresent: true,
  });
  app.audio.suspended = true;
  app.audio.context.state = 'suspended';
  assert.equal(getLiveAudioState(app).audioSuspended, true);
  assert.equal(getLiveAudioState(app).contextState, 'suspended');
  assert.equal(app.audio.suspended, true, 'diagnostics never silently alter pause state');
});

test('accepted capture cannot hide a paused audio graph in the live QA entry', async () => {
  const target = { desktop: { testMode: true }, addEventListener() {}, removeEventListener() {} };
  const app = {
    window: target,
    state: { playing: true },
    playback: { playing: true },
    audio: {
      mode: 'system',
      suspended: true,
      context: { state: 'running', currentTime: 0 },
      node: {},
      analyser: {},
    },
    captureSystem: async () => true,
  };
  const dispose = installMusicSectionQA(app);
  try {
    await assert.rejects(target.__wadLiveSectionCapture({ duration: 1000 }), /audio graph is not running/);
  } finally {
    dispose();
  }
  assert.equal(app.audio.suspended, true);
  assert.equal(target.__wadLiveSectionCapture, undefined);
});
