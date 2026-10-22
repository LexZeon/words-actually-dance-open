import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  evaluateSmokeResult,
  confirmedLiveCapture,
  scoreNativeDrumResponse,
  createDrumQAFixtures,
} = require('../electron/native-qa.cjs');
const source = await fs.readFile(new URL('../electron/native-qa.cjs', import.meta.url), 'utf8');
const valid = () => ({
  desktopBridge: true,
  readyState: 'complete',
  experiment: { actualChecks: true },
  rendererErrors: [],
  scriptAuthoring: { pass: true },
  localLikes: { pass: true },
  visualScenesWithinStage: true,
  overlapPass: true,
  quarterTurnPass: true,
  textFlowPass: true,
  automaticEffects: { pass: true },
  twoBeatDance: { pass: true },
  drumMotion: { pass: true, actualWebAudio: true, referenceLabelsFedToDetector: false },
  drumReference: { pass: true },
  drumReadability: { normal: { pass: true }, small: { pass: true } },
});

test('silent live capture cannot pass using internally generated beats', () => {
  const result = {
    rendererErrors: [],
    alignmentSamples: 12000,
    liveMusic: { mode: 'system', voicedFrames: 0, voicedCoverage: 0, internalBeats: 108 },
  };
  assert.equal(confirmedLiveCapture(result), false);
  result.liveMusic.voicedFrames = 100;
  result.liveMusic.voicedCoverage = 0.8;
  assert.equal(confirmedLiveCapture(result), true);
  result.traceError = 'post-render trace lost';
  assert.equal(confirmedLiveCapture(result), false);
});

test('native success requires each requested audio path and a confirmed reference producer', () => {
  assert.equal(evaluateSmokeResult(valid()), true);
  for (const changes of [
    { experiment: null },
    { scriptAuthoring: { pass: false } },
    { localLikes: { pass: false } },
    { rendererErrors: ['crashed'] },
    { fatalQAError: 'missing-hook' },
    { quarterTurnPass: false },
    { textFlowPass: false },
    { automaticEffects: { pass: false } },
    { twoBeatDance: { pass: false } },
    { drumMotion: { pass: false, actualWebAudio: true, referenceLabelsFedToDetector: false } },
    { drumMotion: { pass: true, actualWebAudio: false, referenceLabelsFedToDetector: false } },
    { drumMotion: { pass: true, actualWebAudio: true, referenceLabelsFedToDetector: true } },
    { drumReference: { pass: false } },
    { drumReadability: { normal: { pass: true }, small: { pass: false } } },
  ])
    assert.equal(evaluateSmokeResult({ ...valid(), ...changes }), false);
  assert.equal(evaluateSmokeResult(valid(), { fileSmokeMode: true }), false);
  assert.equal(
    evaluateSmokeResult({ ...valid(), localFile: { mode: 'file' } }, { fileSmokeMode: true }),
    true,
  );
  assert.equal(evaluateSmokeResult(valid(), { captureSmokeMode: true }), false);
  const captured = { ...valid(), loopback: { mode: 'system', externalReference: true } };
  const mode = { captureSmokeMode: true, externalCaptureSmokeMode: true };
  for (const reference of [undefined, { started: true }, { started: true, exitCode: 1 }])
    assert.equal(evaluateSmokeResult({ ...captured, referencePlayer: reference }, mode), false);
  assert.equal(
    evaluateSmokeResult(
      { ...captured, referencePlayer: { started: true, exitCode: 0 }, referenceError: 'player-error' },
      mode,
    ),
    false,
  );
  assert.equal(
    evaluateSmokeResult({ ...captured, referencePlayer: { started: true, exitCode: 0 } }, mode),
    true,
  );
});

function runner({ referenceExit = 0, referenceError = '', missingHooks = false } = {}) {
  const module = { exports: {} },
    exits = [],
    output = [],
    positions = [];
  const originalBounds = { x: 2640, y: 120, width: 1280, height: 920 };
  const loopbackTrace = [{ time: 1, energy: 0.3, source: 'controlled-test-reply' }];
  const window = {
    getBounds: () => ({ ...originalBounds }),
    setBounds(value) {
      positions.push({ ...value });
    },
    webContents: {
      async capturePage() {
        return { toPNG: () => Buffer.from('test screenshot bytes') };
      },
      async executeJavaScript(script) {
        if (script.includes('const basic ='))
          return missingHooks ? { ...valid(), experimentError: 'original-renderer-hook-missing' } : valid();
        if (missingHooks) throw new Error('followup-hook-missing');
        if (script.includes('__wadScriptSmokeTest')) return { pass: true };
        if (script.includes('__wadLocalLikesTest')) return { pass: true };
        if (script.includes('__wadCaptureSmokeTest')) return { mode: 'system', externalReference: true };
        if (script.includes('__wadLoopbackTrace')) return loopbackTrace;
        if (script.includes('__wadAudioTrace')) return [];
        if (script.includes('__wadPrepareScene')) return { bounds: { readingWithinStage: true } };
        if (script.includes('__wadOverlapTest')) return { pass: true };
        if (script.includes('__wadQuarterTurnTest')) return { pass: true };
        if (script.includes('__wadTextFlowTest')) return { pass: true };
        if (script.includes('__wadAutomaticEffectsTest')) return { pass: true };
        if (script.includes('__wadTwoBeatDanceTest')) return { pass: true };
        if (script.includes('__wadDrumReadabilityTest')) return { pass: true };
        if (script.includes('__wadDrumSmokeTest')) return mockDrumResult();
        return { fixture: true };
      },
    },
  };
  vm.runInNewContext(
    source,
    {
      require(id) {
        if (id === 'node:child_process')
          return {
            spawn() {
              const child = new EventEmitter();
              child.pid = 12345;
              child.stderr = new EventEmitter();
              child.kill = () => output.push('owned-reference-terminated');
              queueMicrotask(() => {
                if (referenceError) child.stderr.emit('data', Buffer.from(referenceError));
                child.emit('exit', referenceExit);
              });
              return child;
            },
          };
        return require(id);
      },
      module,
      Buffer,
      setTimeout(callback, delay) {
        return delay >= 20000 ? setTimeout(callback, delay) : setImmediate(callback);
      },
      clearTimeout,
      console: {
        log(value) {
          output.push(value);
        },
      },
    },
    { filename: fileURLToPath(new URL('../electron/native-qa.cjs', import.meta.url)) },
  );
  return {
    run: module.exports.runSmokeTest,
    window,
    exits,
    output,
    positions,
    originalBounds,
    loopbackTrace,
  };
}

function mockDrumReferences() {
  return ['weighted', 'delivery', 'complex'].map((name) => ({
    name,
    hits: Array.from({ length: 4 }, (_, index) => ({ time: 0.5 + index * 0.5, role: 'primary' })),
  }));
}

function mockDrumResult() {
  return {
    pass: true,
    actualWebAudio: true,
    referenceLabelsFedToDetector: false,
    files: mockDrumReferences().map(({ name, hits }) => ({
      name,
      events: hits.map(({ time }, index) => ({
        time: time + 0.025,
        sequence: index + 1,
        weight: 0.5,
        canvasFrames: 4,
        knowledgeFrames: 4,
        peakCanvasAccent: 0.2,
        peakKnowledgeMotion: 3,
      })),
    })),
  };
}

test('native drum scoring requires independent attack matches and actual responses from both renderers', () => {
  const references = mockDrumReferences();
  assert.equal(scoreNativeDrumResponse(mockDrumResult(), references).pass, true);
  const missed = mockDrumResult();
  missed.files[0].events = [];
  assert.equal(scoreNativeDrumResponse(missed, references).pass, false);
  const noCaption = mockDrumResult();
  noCaption.files[0].events.forEach((row) => {
    row.knowledgeFrames = 0;
  });
  assert.equal(scoreNativeDrumResponse(noCaption, references).pass, false);
  assert.equal(
    scoreNativeDrumResponse(
      mockDrumResult(),
      references.map((row) => ({ ...row, hits: [] })),
    ).pass,
    false,
  );
});

test('host-generated native drum audio keeps timing and strength references outside the player payload', async () => {
  const workspace = fileURLToPath(new URL('..', import.meta.url));
  const fixtures = await createDrumQAFixtures(workspace);
  assert.equal(fixtures.payload.length, 4);
  assert.equal(fixtures.references.length, 3);
  for (const row of fixtures.payload) {
    assert.deepEqual(Object.keys(row).sort(), ['base64', 'name', 'seconds']);
    assert.equal(Buffer.from(row.base64, 'base64').toString('ascii', 0, 4), 'RIFF');
  }
  assert.ok(fixtures.references[1].hits.some((row) => row.role === 'dense-articulation'));
  assert.equal(fixtures.references[2].hits.length, 88);
});

async function temporary(operation) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'wad-native-qa-test-'));
  try {
    await fs.mkdir(path.join(workspace, 'artifacts'));
    return await operation(workspace);
  } finally {
    assert.equal(path.dirname(workspace), os.tmpdir());
    assert.ok(path.basename(workspace).startsWith('wad-native-qa-test-'));
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

function options(harness, workspace, values = {}) {
  return {
    app: { exit: (code) => harness.exits.push(code) },
    workspace,
    selectedDisplay: {
      id: 954728797,
      label: 'ASUS PA279',
      bounds: { x: 2560, y: 0, width: 1441, height: 2560 },
    },
    drumFixtureLoader: async () => ({ payload: [], references: mockDrumReferences() }),
    ...values,
  };
}

test('missing renderer hooks still persist the original error, follow-up failure and screenshot', () =>
  temporary(async (workspace) => {
    const harness = runner({ missingHooks: true });
    await harness.run(harness.window, [], options(harness, workspace));
    const result = JSON.parse(
      await fs.readFile(path.join(workspace, 'artifacts/windows-smoke.json'), 'utf8'),
    );
    assert.equal(result.experimentError, 'original-renderer-hook-missing');
    assert.equal(result.fatalQAError, 'followup-hook-missing');
    assert.equal(result.success, false);
    assert.equal(result.targetDisplay.label, 'ASUS PA279');
    assert.ok((await fs.stat(path.join(workspace, 'artifacts/windows-smoke.png'))).size > 0);
    assert.deepEqual(harness.exits, [1]);
  }));

test('failed reference producer cannot pass or overwrite the verified DSP fixture', () =>
  temporary(async (workspace) => {
    const fixture = path.join(workspace, 'artifacts/loopback-trace.json');
    await fs.writeFile(fixture, 'verified-existing-fixture');
    await fs.writeFile(
      path.join(workspace, 'artifacts/play-reference.ps1'),
      'not executed: process is mocked',
    );
    const harness = runner({ referenceExit: 1, referenceError: 'reference-playback-failed' });
    const result = await harness.run(
      harness.window,
      [],
      options(harness, workspace, { captureSmokeMode: true, externalCaptureSmokeMode: true }),
    );
    assert.equal(result.referencePlayer.exitCode, 1);
    assert.equal(result.success, false);
    assert.equal(await fs.readFile(fixture, 'utf8'), 'verified-existing-fixture');
    assert.deepEqual(harness.exits, [1]);
  }));

test('confirmed reference stores the fixture and restores the exact original window bounds', () =>
  temporary(async (workspace) => {
    await fs.writeFile(
      path.join(workspace, 'artifacts/play-reference.ps1'),
      'not executed: process is mocked',
    );
    const harness = runner();
    const result = await harness.run(
      harness.window,
      [],
      options(harness, workspace, { captureSmokeMode: true, externalCaptureSmokeMode: true }),
    );
    assert.equal(result.success, true);
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(workspace, 'artifacts/loopback-trace.json'), 'utf8')),
      harness.loopbackTrace,
    );
    assert.deepEqual(harness.positions.at(-1), harness.originalBounds);
    assert.deepEqual(harness.exits, [0]);
  }));
