'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function createGhostQAFixture(workspace) {
  const { drumPcmFixture, pcm16Wav } = await import(
    pathToFileURL(path.join(workspace, 'tests/helpers/drum-pcm-fixtures.mjs')).href
  );
  const fixture = drumPcmFixture({ profile: 'alternating-weight' });
  return { name: 'ghost-response', seconds: fixture.seconds, base64: pcm16Wav(fixture).toString('base64') };
}

function validateNativeGhostResponse(actual) {
  const expected = ['scale-echo', 'twist-shadow', 'vertical-lift', 'horizontal-stretch', 'glyph-wave'];
  return Boolean(
    actual?.actualWebAudio &&
    actual.actualCanvasPaint &&
    actual.labelsFedToDetector === false &&
    actual.pass &&
    actual.cases?.length === 5 &&
    new Set(actual.cases.map((row) => row.effect)).size === 5 &&
    expected.every((effect) =>
      actual.cases.some(
        (row) =>
          row.effect === effect &&
          row.voicedFrames > 10 &&
          row.actualDrumHits >= 4 &&
          row.visibleFrames > 10 &&
          row.actualLayerPaintFrames > 10 &&
          row.maximumPoseDifference > 0.005 &&
          row.finite &&
          row.withinBounds &&
          row.sameAnchor &&
          row.boundedHistory &&
          row.opacityValid &&
          row.delayValid &&
          row.monotonicSourceTime,
      ),
    ) &&
    [
      'pauseStable',
      'resumeRetainsDelay',
      'wordClearsHistory',
      'resizeClearsHistory',
      'offRemovesLayer',
      'reducedRemovesGhost',
      'sourceClearsHistory',
    ].every((key) => actual.lifecycle?.[key] === true),
  );
}

async function createGhostToneFixtures(workspace) {
  const { toneStylePcm } = await import(
    pathToFileURL(path.join(workspace, 'tests/helpers/tone-style-pcm.mjs')).href
  );
  const { pcm16Wav } = await import(
    pathToFileURL(path.join(workspace, 'tests/helpers/drum-pcm-fixtures.mjs')).href
  );
  const kinds = ['pulse', 'pluck', 'lead', 'pad', 'noise'];
  const effects = ['scale-echo', 'glyph-wave', 'vertical-lift', 'twist-shadow', 'horizontal-stretch'];
  // These quiet original sources isolate automatic tone selection from the
  // separate heavy-drum override. Only source PCM is scaled, never features.
  const fixtures = kinds.map((profile) => {
    const fixture = toneStylePcm({ profile, seconds: 5 });
    return { ...fixture, samples: Float32Array.from(fixture.samples, (value) => value * 0.15) };
  });
  const tailFixture = toneStylePcm({ profile: 'pluck', seconds: 5, background: 0, noteSeconds: 0.12 });
  const tailSamples = {
    ...tailFixture,
    samples: Float32Array.from(tailFixture.samples, (value) => value * 0.15),
  };
  return {
    payload: fixtures.map((fixture, index) => ({
      name: `tone-${index}`,
      seconds: fixture.seconds,
      base64: pcm16Wav(fixture).toString('base64'),
    })),
    references: kinds.map((kind, index) => ({ name: `tone-${index}`, kind, effect: effects[index] })),
    tailPayload: {
      name: 'tone-tail',
      seconds: tailFixture.seconds,
      base64: pcm16Wav(tailSamples).toString('base64'),
    },
  };
}

function scoreGhostQuietTail(row) {
  return {
    pass: Boolean(
      row &&
      row.quietFrames > 20 &&
      row.quietVoicedTailFrames > 3 &&
      row.quietLayerPaintFrames > 3 &&
      row.quietNewToneHits === 0 &&
      row.quietNewDrumHits === 0 &&
      row.monotonicSourceTime &&
      row.finite &&
      row.withinBounds &&
      row.delayValid,
    ),
    quietFrames: row?.quietFrames || 0,
    quietVoicedTailFrames: row?.quietVoicedTailFrames || 0,
    quietLayerPaintFrames: row?.quietLayerPaintFrames || 0,
    quietNewToneHits: row?.quietNewToneHits || 0,
    quietNewDrumHits: row?.quietNewDrumHits || 0,
    meaning:
      'Actual PCM windows are quiet; a visible delayed historical main pose from an earlier voiced window is retained without inventing a fresh sound attack.',
  };
}

function scoreGhostToneCases(rows, references) {
  const cases = references.map((reference) => {
    const row = rows?.find((value) => value.name === reference.name);
    const known = row?.toneValidFrames || 0;
    const expectedKindFrames = row?.toneKinds?.[reference.kind] || 0;
    const selectedEffectFrames = row?.chosenEffects?.[reference.effect] || 0;
    return {
      ...reference,
      expectedKindFrames,
      selectedEffectFrames,
      knownFrames: known,
      pass: Boolean(
        row &&
        row.voicedFrames > 10 &&
        known > 20 &&
        expectedKindFrames / known > 0.6 &&
        selectedEffectFrames > 20 &&
        row.actualLayerPaintFrames > 10 &&
        row.withinBounds &&
        row.finite &&
        row.sameAnchor &&
        row.boundedHistory &&
        row.delayValid &&
        row.opacityValid &&
        row.monotonicSourceTime,
      ),
    };
  });
  return {
    pass:
      cases.length === 5 &&
      rows?.length === 5 &&
      new Set(rows.map((row) => row.name)).size === 5 &&
      cases.every((row) => row.pass),
    cases,
    meaning:
      'Independent quiet original PCM source categories are host-only references; observed audio proxies and automatic ghost selection are not real instrument recognition.',
  };
}

async function runGhostTest(window, errors, { app, workspace, selectedDisplay }) {
  const destination = path.join(workspace, 'artifacts');
  const result = {
    success: false,
    source: 'actual-native-WebAudio-Canvas-ghost',
    display: { id: selectedDisplay.id, label: selectedDisplay.label, bounds: selectedDisplay.bounds },
    windowBounds: window.getBounds(),
    rendererErrors: errors,
  };
  try {
    await fs.mkdir(destination, { recursive: true });
    await window.webContents.executeJavaScript(
      'new Promise((resolve,reject)=>{const deadline=performance.now()+10000;const check=()=>window.__wadReady&&window.__wadGhostSmokeTest?resolve(true):performance.now()>deadline?reject(new Error("Ghost QA hook unavailable")):setTimeout(check,20);check();})',
    );
    const payload = await createGhostQAFixture(workspace);
    const tones = await createGhostToneFixtures(workspace);
    const normalBounds = window.getBounds();
    for (const layout of ['normal', 'small']) {
      if (layout === 'small') {
        window.setBounds({ ...normalBounds, width: 960, height: 700 });
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const actual = await window.webContents.executeJavaScript(
        `window.__wadGhostSmokeTest(${JSON.stringify(payload)},${JSON.stringify(layout === 'normal' ? [...tones.payload, tones.tailPayload] : [])})`,
        true,
      );
      if (layout === 'normal') result.actual = actual;
      else result.small = actual;
      for (const row of [...actual.cases, ...(actual.toneCases || [])]) {
        if (row.image) {
          const file = `ghost-${layout}-${row.name || row.effect}.png`;
          await fs.writeFile(path.join(destination, file), Buffer.from(row.image, 'base64'));
          row.imageFile = file;
          delete row.image;
        }
        if (row.quietImage) {
          const file = `ghost-${layout}-${row.name || row.effect}-quiet-tail.png`;
          await fs.writeFile(path.join(destination, file), Buffer.from(row.quietImage, 'base64'));
          row.quietImageFile = file;
          delete row.quietImage;
        }
      }
    }
    window.setBounds(normalBounds);
    result.success =
      validateNativeGhostResponse(result.actual) &&
      validateNativeGhostResponse(result.small) &&
      !errors.length;
    result.toneScore = scoreGhostToneCases(
      result.actual.toneCases.filter((row) => tones.references.some((ref) => ref.name === row.name)),
      tones.references,
    );
    result.success &&= result.toneScore.pass;
    result.quietTailScore = scoreGhostQuietTail(
      result.actual.toneCases.find((row) => row.name === tones.tailPayload.name),
    );
    result.success &&= result.actual.toneCases.length === 6 && result.quietTailScore.pass;
  } catch (error) {
    result.error = error.message;
    try {
      result.partial = await window.webContents.executeJavaScript('window.__wadGhostNativeEvidence || null');
    } catch {}
  }
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(
    path.join(destination, 'native-ghost-result.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      ghostQA: true,
      success: result.success,
      error: result.error,
      lifecycle: result.actual?.lifecycle,
      cases: result.actual?.cases.map(
        ({ effect, visibleFrames, actualLayerPaintFrames, maximumPoseDifference, withinBounds }) => ({
          effect,
          visibleFrames,
          actualLayerPaintFrames,
          maximumPoseDifference,
          withinBounds,
        }),
      ),
    }),
  );
  app.exit(result.success ? 0 : 1);
  return result;
}
module.exports = {
  createGhostQAFixture,
  createGhostToneFixtures,
  scoreGhostToneCases,
  scoreGhostQuietTail,
  validateNativeGhostResponse,
  runGhostTest,
};
