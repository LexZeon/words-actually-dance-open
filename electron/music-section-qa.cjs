'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function createSectionQAFixtures(workspace) {
  const { MUSIC_SECTION_CASES, musicSectionPcmFixture } = await import(
    pathToFileURL(path.join(workspace, 'tests/helpers/music-section-pcm-fixtures.mjs')).href
  );
  const { pcm16Wav } = await import(
    pathToFileURL(path.join(workspace, 'tests/helpers/drum-pcm-fixtures.mjs')).href
  );
  const fixtures = MUSIC_SECTION_CASES.map((profile) => musicSectionPcmFixture({ profile }));
  return {
    payload: fixtures.map((fixture) => ({
      name: fixture.profile,
      seconds: fixture.seconds,
      base64: pcm16Wav(fixture).toString('base64'),
    })),
    references: fixtures.map((fixture) => ({
      name: fixture.profile,
      seconds: fixture.seconds,
      changes: fixture.changes,
    })),
  };
}

function scoreNativeSectionResponse(result, references) {
  const files = references.map((reference) => {
    const actual = result.files?.find((file) => file.name === reference.name);
    const episodes = actual?.episodes || [],
      phrases = actual?.phrases || [];
    const used = new Set();
    const changes = reference.changes.map((change) => {
      const index = episodes.findIndex(
        (event, index) =>
          !used.has(index) &&
          event.time >= change.time &&
          event.time <= Math.min(change.until, change.time + 3),
      );
      if (index < 0) return { ...change, detectedAt: null, delaySeconds: null };
      used.add(index);
      return {
        ...change,
        detectedAt: episodes[index].time,
        delaySeconds: episodes[index].time - change.time,
      };
    });
    const extraEpisodes = episodes.length - used.size;
    const identities = new Set(
      phrases.map((phrase) => `${phrase.sourceGeneration}:${phrase.sectionGeneration}:${phrase.episodeId}`),
    );
    const duplicatedPhrases = phrases.length - identities.size;
    const missingChanges = changes.filter((change) => change.detectedAt === null).length;
    const visiblePhrases = phrases.filter(
      (phrase) => phrase.visibleFrames > 2 && phrase.maximumEnvelope > 0.1,
    ).length;
    const validIdentities = phrases.every(
      (phrase) =>
        Number.isSafeInteger(phrase.episodeId) &&
        phrase.episodeId > 0 &&
        Number.isSafeInteger(phrase.sourceGeneration) &&
        phrase.sourceGeneration >= 0 &&
        Number.isSafeInteger(phrase.sectionGeneration) &&
        phrase.sectionGeneration >= 0 &&
        Number.isSafeInteger(phrase.startBeat) &&
        phrase.startBeat >= 0,
    );
    const matchedIdentities = phrases.every((phrase) =>
      episodes.some((episode) => episode.episode === phrase.episodeId && phrase.time >= episode.time),
    );
    return {
      name: reference.name,
      expectedChanges: reference.changes.length,
      detectedEpisodes: episodes.length,
      phraseStarts: phrases.length,
      duplicatedPhrases,
      missingChanges,
      extraEpisodes,
      extraEpisodesPerMinute: (extraEpisodes / reference.seconds) * 60,
      visiblePhrases,
      changes,
      pass: Boolean(
        actual &&
        missingChanges === 0 &&
        extraEpisodes === 0 &&
        duplicatedPhrases === 0 &&
        validIdentities &&
        matchedIdentities &&
        phrases.length === episodes.length &&
        visiblePhrases === phrases.length,
      ),
    };
  });
  return {
    pass:
      files.length >= 6 &&
      result.files?.length === references.length &&
      new Set(references.map((reference) => reference.name)).size === files.length &&
      files.every((file) => file.pass),
    evaluation:
      'Host-only independent arrangement change timestamps. Each change within 3 seconds; no extra episodes, one visible phrase per episode. Not commercial-song chorus accuracy.',
    referenceLabelsFedToDetector: false,
    files,
  };
}

async function runSectionTest(
  window,
  rendererErrors,
  { app, workspace, selectedDisplay, fixtureLoader = createSectionQAFixtures },
) {
  const destination = path.join(workspace, 'artifacts');
  const result = {
    success: false,
    source: 'actual-native-WebAudio-section-response',
    display: { id: selectedDisplay.id, label: selectedDisplay.label, bounds: selectedDisplay.bounds },
    windowBounds: window.getBounds(),
    rendererErrors,
  };
  try {
    await fs.mkdir(destination, { recursive: true });
    await window.webContents.executeJavaScript(
      'new Promise((resolve, reject) => { const deadline = performance.now() + 10000; const check = () => window.__wadReady && window.__wadSectionSmokeTest ? resolve(true) : performance.now() >= deadline ? reject(new Error("Section QA hook unavailable.")) : setTimeout(check, 20); check(); })',
    );
    const fixtures = await fixtureLoader(workspace);
    result.actual = await window.webContents.executeJavaScript(
      `window.__wadSectionSmokeTest(${JSON.stringify(fixtures.payload)})`,
      true,
    );
    result.score = scoreNativeSectionResponse(result.actual, fixtures.references);
    result.success = Boolean(
      result.actual.pass &&
      result.actual.actualWebAudio &&
      result.actual.referenceLabelsFedToDetector === false &&
      result.score.pass &&
      !rendererErrors.length,
    );
  } catch (error) {
    result.error = error.message;
    try {
      result.partial = await window.webContents.executeJavaScript(
        'window.__wadSectionNativeEvidence || null',
      );
    } catch {}
  }
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(
    path.join(destination, 'native-section-result.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      sectionQA: true,
      success: result.success,
      error: result.error,
      score: result.score?.files,
    }),
  );
  app.exit(result.success ? 0 : 1);
  return result;
}

async function runLiveSectionTest(
  window,
  rendererErrors,
  { app, workspace, selectedDisplay, duration = 90000 },
) {
  duration = Math.min(120000, Math.max(1000, Number(duration) || 90000));
  const result = {
    success: false,
    source: 'actual-native-system-audio-section-observation',
    duration,
    display: { id: selectedDisplay.id, label: selectedDisplay.label, bounds: selectedDisplay.bounds },
    windowBounds: window.getBounds(),
    rendererErrors,
    independentSectionLabels: false,
    sectionAccuracy: null,
  };
  try {
    await window.webContents.executeJavaScript(
      'new Promise((resolve, reject) => { const deadline = performance.now() + 10000; const check = () => window.__wadReady && window.__wadLiveSectionCapture ? resolve(true) : performance.now() >= deadline ? reject(new Error("Live section QA hook unavailable.")) : setTimeout(check, 20); check(); })',
    );
    result.actual = await window.webContents.executeJavaScript(
      `window.__wadLiveSectionCapture(${JSON.stringify({ duration })})`,
      true,
    );
    const actual = result.actual;
    const voiceCoverage = actual.frameCount ? actual.voicedFrames / actual.frameCount : 0;
    result.voicedCoverage = voiceCoverage;
    result.success = Boolean(
      actual.actualWebAudio &&
      actual.captureUsable &&
      actual.sourceMode === 'system' &&
      actual.audioTracks.some((track) => track.readyState === 'live') &&
      voiceCoverage >= 0.2 &&
      actual.frameCount > 10 &&
      actual.finiteCanvas &&
      actual.canvasWithinBounds &&
      !rendererErrors.length,
    );
    result.observation = {
      episodes: actual.episodes.length,
      phraseStarts: actual.phrases.length,
      episodesPerMinute: (actual.episodes.length * 60000) / duration,
      evaluation:
        'Actual system audio and bounded post-draw events only. No independent chorus labels; frequency is an observation, not accuracy.',
    };
  } catch (error) {
    result.error = error.message;
  }
  const destination = path.join(workspace, 'artifacts');
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(
    path.join(destination, 'live-section-result.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      liveSectionQA: true,
      success: result.success,
      error: result.error,
      voicedCoverage: result.voicedCoverage,
      observation: result.observation,
    }),
  );
  app.exit(result.success ? 0 : 1);
  return result;
}

module.exports = { createSectionQAFixtures, scoreNativeSectionResponse, runSectionTest, runLiveSectionTest };
