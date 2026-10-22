'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function createDrumQAFixtures(workspace) {
  const helper = path.join(workspace, 'tests', 'helpers', 'drum-pcm-fixtures.mjs');
  const { drumPcmFixture, pcm16Wav } = await import(pathToFileURL(helper).href);
  const weighted = drumPcmFixture({ profile: 'alternating-weight' });
  const delivery = drumPcmFixture({ profile: 'alternating-weight' });
  // This test isolates articulation density; strength contrast is evaluated
  // independently by the first fixture. Keep all primary attacks at one gain.
  for (const hit of delivery.hits) {
    const first = Math.ceil(hit.time * delivery.sampleRate);
    const last = Math.min(delivery.samples.length, Math.ceil((hit.time + 0.28) * delivery.sampleRate));
    for (let index = first; index < last; index++) delivery.samples[index] *= 0.2 / hit.gain;
    hit.gain = 0.2;
    hit.role = 'primary';
  }
  // Keep the same primary pulse; increase only the high-band articulation in
  // the later section. Reference times stay in this host, never in the player.
  for (let primary = 4.35; primary < 9.5; primary += 0.65) {
    for (const part of [0.25, 0.5, 0.75]) {
      const time = primary + part * 0.65;
      if (time >= 9.7) continue;
      delivery.hits.push({ time, kind: 'tick', gain: 0.045, role: 'dense-articulation' });
      const first = Math.ceil(time * delivery.sampleRate);
      const last = Math.min(delivery.samples.length, Math.ceil((time + 0.07) * delivery.sampleRate));
      for (let index = first; index < last; index++) {
        const age = index / delivery.sampleRate - time;
        delivery.samples[index] += 0.045 * Math.sin(2 * Math.PI * 7800 * age) * Math.exp(-age * 95);
      }
    }
  }
  delivery.hits.sort((left, right) => left.time - right.time);
  const complex = drumPcmFixture({ profile: 'polyphonic-syncopation' });
  const quiet = drumPcmFixture({ profile: 'sustained-tones' });
  const rows = [
    ['alternating-weight', weighted],
    ['same-bpm-delivery', delivery],
    ['polyphonic-syncopation', complex],
    ['quiet-source', quiet],
  ];
  return {
    payload: rows.map(([name, fixture]) => ({
      name,
      seconds: fixture.seconds,
      base64: pcm16Wav(fixture).toString('base64'),
    })),
    references: rows.slice(0, 3).map(([name, fixture]) => ({ name, hits: fixture.hits })),
  };
}

function scoreNativeDrumResponse(result, references) {
  const scores = references.map(({ name, hits }) => {
    const file = result.files?.find((row) => row.name === name);
    const events = file?.events || [];
    const used = new Set(),
      matches = [];
    for (const hit of hits) {
      const index = events.findIndex(
        (event, index) => !used.has(index) && event.time >= hit.time - 0.005 && event.time <= hit.time + 0.15,
      );
      if (index < 0) continue;
      used.add(index);
      matches.push({ ...hit, ...events[index], delayMs: (events[index].time - hit.time) * 1000 });
    }
    const average = (rows, key) =>
      rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : 0;
    const heavy = matches.filter((row) => row.role === 'heavy'),
      light = matches.filter((row) => row.role === 'light');
    const weightContrast =
      !heavy.length ||
      (heavy.length >= 5 &&
        light.length >= 5 &&
        average(heavy, 'weight') > average(light, 'weight') + 0.15 &&
        average(heavy, 'peakCanvasAccent') > average(light, 'peakCanvasAccent') * 1.35 &&
        average(heavy, 'peakKnowledgeMotion') > average(light, 'peakKnowledgeMotion') * 1.2);
    const matched = matches.length;
    const both = matches.filter((row) => row.canvasFrames > 0 && row.knowledgeFrames > 0).length;
    const pass =
      hits.length >= 4 &&
      matched >= hits.length * 0.8 &&
      both >= matched * 0.9 &&
      events.length - matched <= Math.max(3, hits.length * 0.15) &&
      weightContrast;
    const ordered = matches.map((row) => row.delayMs).sort((left, right) => left - right);
    return {
      name,
      pass,
      expectedHits: hits.length,
      detectedHits: events.length,
      matchedHits: matched,
      bothStages: both,
      extraEvents: events.length - matched,
      delayP95Ms: ordered.length
        ? ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)]
        : null,
      weightContrast,
      heavy: {
        count: heavy.length,
        weight: average(heavy, 'weight'),
        canvasAccent: average(heavy, 'peakCanvasAccent'),
        knowledgeMotion: average(heavy, 'peakKnowledgeMotion'),
      },
      light: {
        count: light.length,
        weight: average(light, 'weight'),
        canvasAccent: average(light, 'peakCanvasAccent'),
        knowledgeMotion: average(light, 'peakKnowledgeMotion'),
      },
    };
  });
  return {
    pass: scores.length === 3 && scores.every((row) => row.pass),
    referenceLabelsFedToDetector: false,
    evaluation:
      'Independent host-only one-to-one PCM attack labels; actual native post-draw renderer responses.',
    scores,
  };
}

async function runSmokeTest(window, rendererErrors, options = {}) {
  let progress;
  try {
    return await runSmokeChecks(window, rendererErrors, {
      ...options,
      onProgress: (value) => {
        progress = value;
      },
    });
  } catch (error) {
    const result = progress || { rendererErrors };
    result.fatalQAError = error.message;
    result.success = false;
    result.targetDisplay ||= options.selectedDisplay;
    try {
      result.windowBounds = window.getBounds();
    } catch {
      result.windowBounds = null;
    }
    const destination = path.join(options.workspace, 'artifacts');
    try {
      await fs.mkdir(destination, { recursive: true });
      try {
        await fs.writeFile(
          path.join(destination, 'windows-smoke.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
      } catch (imageError) {
        result.screenshotError = imageError.message;
      }
      await fs.writeFile(
        path.join(destination, 'windows-smoke.json'),
        JSON.stringify(result, null, 2),
        'utf8',
      );
    } catch (saveError) {
      result.diagnosticSaveError = saveError.message;
    }
    console.log(JSON.stringify(result));
    options.app.exit(1);
    return result;
  }
}

function confirmedReference(result) {
  return result.referencePlayer?.started && result.referencePlayer.exitCode === 0 && !result.referenceError;
}

function confirmedLiveCapture(result) {
  return Boolean(
    !result.liveMusicError &&
    !result.traceError &&
    !result.rendererErrors?.length &&
    result.liveMusic?.mode === 'system' &&
    result.liveMusic.voicedFrames > 10 &&
    result.liveMusic.voicedCoverage >= 0.2 &&
    result.alignmentSamples > 10,
  );
}

function evaluateSmokeResult(
  result,
  { fileSmokeMode = false, captureSmokeMode = false, externalCaptureSmokeMode = false } = {},
) {
  return Boolean(
    result.desktopBridge &&
    result.readyState === 'complete' &&
    result.experiment &&
    !result.rendererErrors?.length &&
    !result.experimentError &&
    !result.fatalQAError &&
    result.scriptAuthoring?.pass &&
    result.localLikes?.pass &&
    result.visualScenesWithinStage &&
    result.overlapPass &&
    result.quarterTurnPass &&
    result.textFlowPass &&
    result.automaticEffects?.pass &&
    result.twoBeatDance?.pass &&
    result.drumMotion?.pass &&
    result.drumMotion?.actualWebAudio &&
    result.drumMotion?.referenceLabelsFedToDetector === false &&
    result.drumReference?.pass &&
    result.drumReadability?.normal?.pass &&
    result.drumReadability?.small?.pass &&
    (!fileSmokeMode || (!result.localFileError && result.localFile?.mode === 'file')) &&
    (!captureSmokeMode || (!result.loopbackError && result.loopback?.mode === 'system')) &&
    (!externalCaptureSmokeMode || confirmedReference(result)),
  );
}

async function runSmokeChecks(
  window,
  rendererErrors,
  {
    app,
    selectedDisplay,
    workspace,
    fileSmokeMode = false,
    captureSmokeMode = false,
    externalCaptureSmokeMode = false,
    liveMusicMode = false,
    liveMusicLabel = 'bili',
    duration = 30000,
    onProgress = () => {},
    drumFixtureLoader = createDrumQAFixtures,
  } = {},
) {
  if (liveMusicMode)
    return runLiveMusicTest(window, rendererErrors, {
      app,
      selectedDisplay,
      workspace,
      label: liveMusicLabel,
      duration,
    });
  const destination = path.join(workspace, 'artifacts');
  await new Promise((resolve) => setTimeout(resolve, 1600));
  const result = await window.webContents.executeJavaScript(
    `(async () => {
    const basic = {
      title: document.title, readyState: document.readyState,
      desktopBridge: !!window.desktop,
      platform: window.desktop?.platform,
      canvasCount: document.querySelectorAll('canvas').length,
      bodyText: document.body.innerText.slice(0, 1200),
    };
    if (typeof window.__wadSmokeTest === 'function') {
      try { basic.experiment = await window.__wadSmokeTest(); }
      catch (error) { basic.experimentError = error.message; }
    } else basic.experimentError = 'Smoke renderer QA hook is unavailable.';
    return basic;
  })()`,
    true,
  );
  onProgress(result);
  result.rendererErrors = rendererErrors;
  result.targetDisplay = {
    id: selectedDisplay.id,
    label: selectedDisplay.label,
    bounds: selectedDisplay.bounds,
    workArea: selectedDisplay.workArea,
    scaleFactor: selectedDisplay.scaleFactor,
  };
  result.windowBounds = window.getBounds();
  if (!result.experimentError) {
    try {
      result.scriptAuthoring = await window.webContents.executeJavaScript(
        'window.__wadScriptSmokeTest()',
        true,
      );
    } catch (error) {
      result.scriptAuthoring = { pass: false, error: error.message };
    }
  }
  if (!result.experimentError) {
    try {
      result.localLikes = await window.webContents.executeJavaScript('window.__wadLocalLikesTest()', true);
    } catch (error) {
      result.localLikes = { pass: false, error: error.message };
    }
  }
  if (fileSmokeMode && !result.experimentError) {
    const reference = await fs.readFile(path.join(workspace, 'artifacts', 'loopback-reference.wav'));
    try {
      result.localFile = await window.webContents.executeJavaScript(
        `window.__wadLocalFileSmokeTest(${JSON.stringify(reference.toString('base64'))})`,
        true,
      );
    } catch (error) {
      result.localFileError = error.message;
    }
  }
  let referenceDone;
  if (captureSmokeMode && !result.experimentError) {
    if (externalCaptureSmokeMode) {
      const helper = path.join(workspace, 'artifacts', 'play-reference.ps1');
      await fs.access(helper);
      const referenceProcess = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      result.referencePlayer = { pid: referenceProcess.pid, started: Boolean(referenceProcess.pid) };
      referenceProcess.stderr.on('data', (data) => {
        result.referenceError = ((result.referenceError || '') + data.toString()).slice(0, 2000);
      });
      referenceDone = new Promise((resolve) => {
        const timeout = setTimeout(() => {
          result.referenceError =
            result.referenceError || 'Reference audio player did not finish within 20 seconds.';
          result.referencePlayer.timedOut = true;
          referenceProcess.kill();
          resolve();
        }, 20000);
        referenceProcess.once('exit', (code) => {
          clearTimeout(timeout);
          result.referencePlayer.exitCode = code;
          resolve();
        });
        referenceProcess.once('error', (error) => {
          clearTimeout(timeout);
          result.referenceError = error.message;
          resolve();
        });
      });
    }
    try {
      result.loopback = await window.webContents.executeJavaScript(
        `window.__wadCaptureSmokeTest(${externalCaptureSmokeMode})`,
        true,
      );
    } catch (error) {
      result.loopbackError = error.message;
    }
  }
  if (referenceDone) await referenceDone;
  await fs.mkdir(destination, { recursive: true });
  result.contentPanel = await window.webContents.executeJavaScript('window.__wadPrepareContentPanel()');
  await new Promise((resolve) => setTimeout(resolve, 150));
  await fs.writeFile(
    path.join(destination, 'content-authoring.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await window.webContents.executeJavaScript('document.getElementById("content-dialog").close()');
  const trace = await window.webContents.executeJavaScript('window.__wadAudioTrace || []');
  if (trace.length)
    await fs.writeFile(path.join(destination, 'audio-trace.json'), JSON.stringify(trace), 'utf8');
  const loopbackTrace = await window.webContents.executeJavaScript('window.__wadLoopbackTrace || []');
  if (loopbackTrace.length) {
    await fs.writeFile(
      path.join(destination, 'loopback-capture-trace.json'),
      JSON.stringify(loopbackTrace),
      'utf8',
    );
    // The optional DSP regression needs a verified reference recording. A
    // failed/muted run remains diagnostic data and cannot overwrite that fixture.
    if (result.loopback?.externalReference && !result.loopbackError && confirmedReference(result))
      await fs.writeFile(
        path.join(destination, 'loopback-trace.json'),
        JSON.stringify(loopbackTrace),
        'utf8',
      );
  }
  result.visual = await window.webContents.executeJavaScript('window.__wadPrepareScreenshot("stack")');
  const image = await window.webContents.capturePage();
  await fs.writeFile(path.join(destination, 'windows-smoke.png'), image.toPNG());
  for (const effect of ['karaoke', 'marker', 'pop', 'flip', 'barrage', 'settings']) {
    if (effect === 'settings')
      await window.webContents.executeJavaScript('document.getElementById("settings-dialog").showModal()');
    else
      await window.webContents.executeJavaScript(`window.__wadPrepareScreenshot(${JSON.stringify(effect)})`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await fs.writeFile(
      path.join(destination, `visual-${effect}.png`),
      (await window.webContents.capturePage()).toPNG(),
    );
  }
  await window.webContents.executeJavaScript('document.getElementById("settings-dialog").close()');
  result.visualScenes = [];
  for (const layout of [
    'opening',
    'definition',
    'contrast',
    'steps',
    'spotlight',
    'diagonal',
    'flip',
    'ink',
  ]) {
    try {
      result.visualScenes.push(
        await window.webContents.executeJavaScript(`window.__wadPrepareScene(${JSON.stringify(layout)})`),
      );
    } catch (error) {
      result.visualScenes.push({ layout, error: error.message });
    }
    await fs.writeFile(
      path.join(destination, `scene-${layout}.png`),
      (await window.webContents.capturePage()).toPNG(),
    );
  }
  const originalBounds = window.getBounds();
  result.overlap = {};
  result.quarterTurn = {};
  result.textFlow = {};
  result.drumReadability = {};
  try {
    const fixtures = await drumFixtureLoader(workspace);
    result.drumMotion = await window.webContents.executeJavaScript(
      `window.__wadDrumSmokeTest(${JSON.stringify(fixtures.payload)})`,
      true,
    );
    result.drumReference = scoreNativeDrumResponse(result.drumMotion, fixtures.references);
  } catch (error) {
    let evidence = {};
    try {
      evidence = await window.webContents.executeJavaScript('window.__wadDrumNativeEvidence || {}', true);
    } catch {}
    result.drumMotion = { ...evidence, pass: false, error: error.message };
  }
  try {
    result.drumReadability.normal = await window.webContents.executeJavaScript(
      'window.__wadDrumReadabilityTest()',
      true,
    );
  } catch (error) {
    result.drumReadability.normal = { pass: false, error: error.message };
  }
  try {
    result.overlap.normal = await window.webContents.executeJavaScript('window.__wadOverlapTest()', true);
    await fs.writeFile(
      path.join(destination, 'overlap-normal.json'),
      JSON.stringify(result.overlap.normal, null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(destination, 'overlap-normal.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
  } catch (error) {
    result.overlap.normal = { pass: false, error: error.message };
  }
  try {
    result.quarterTurn.normal = await window.webContents.executeJavaScript(
      'window.__wadQuarterTurnTest()',
      true,
    );
    await fs.writeFile(
      path.join(destination, 'quarter-turn-normal.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
  } catch (error) {
    result.quarterTurn.normal = { pass: false, error: error.message };
  }
  try {
    result.quarterTurn.long = await window.webContents.executeJavaScript(
      'window.__wadQuarterTurnTest({long:true})',
      true,
    );
    await fs.writeFile(
      path.join(destination, 'quarter-turn-long.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
  } catch (error) {
    result.quarterTurn.long = { pass: false, error: error.message };
  }
  for (const variant of ['normal', 'long']) {
    try {
      result.textFlow[variant] = await window.webContents.executeJavaScript(
        `window.__wadTextFlowTest({long:${variant === 'long'}})`,
        true,
      );
      await fs.writeFile(
        path.join(destination, `text-flow-${variant}.png`),
        (await window.webContents.capturePage()).toPNG(),
      );
    } catch (error) {
      result.textFlow[variant] = { pass: false, error: error.message };
    }
  }
  try {
    result.automaticEffects = await window.webContents.executeJavaScript(
      'window.__wadAutomaticEffectsTest()',
      true,
    );
  } catch (error) {
    result.automaticEffects = { pass: false, error: error.message };
  }
  try {
    result.twoBeatDance = await window.webContents.executeJavaScript('window.__wadTwoBeatDanceTest()', true);
    for (const [side, beatIndex] of [
      ['left', 0],
      ['right', 1],
    ]) {
      await window.webContents.executeJavaScript(
        `window.__wadPrepareTwoBeatPose({beatIndex:${beatIndex},phase:0.5})`,
        true,
      );
      // Renderer RAF resolves before the compositor presents its Canvas frame.
      // Keep the frozen pose long enough for capturePage to show this side.
      await new Promise((resolve) => setTimeout(resolve, 150));
      await fs.writeFile(
        path.join(destination, `two-beat-${side}.png`),
        (await window.webContents.capturePage()).toPNG(),
      );
    }
  } catch (error) {
    result.twoBeatDance = { pass: false, error: error.message };
  }
  result.smallWindowScenes = [];
  try {
    window.setBounds({ x: originalBounds.x, y: originalBounds.y, width: 960, height: 700 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      result.drumReadability.small = await window.webContents.executeJavaScript(
        'window.__wadDrumReadabilityTest()',
        true,
      );
    } catch (error) {
      result.drumReadability.small = { pass: false, error: error.message };
    }
    for (const layout of ['ink', 'contrast']) {
      try {
        result.smallWindowScenes.push(
          await window.webContents.executeJavaScript(`window.__wadPrepareScene(${JSON.stringify(layout)})`),
        );
      } catch (error) {
        result.smallWindowScenes.push({ layout, error: error.message });
      }
      await fs.writeFile(
        path.join(destination, `scene-small-${layout}.png`),
        (await window.webContents.capturePage()).toPNG(),
      );
    }
    try {
      result.overlap.small = await window.webContents.executeJavaScript('window.__wadOverlapTest()', true);
      await fs.writeFile(
        path.join(destination, 'overlap-small.json'),
        JSON.stringify(result.overlap.small, null, 2),
        'utf8',
      );
      await fs.writeFile(
        path.join(destination, 'overlap-small.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
    } catch (error) {
      result.overlap.small = { pass: false, error: error.message };
    }
    try {
      result.quarterTurn.small = await window.webContents.executeJavaScript(
        'window.__wadQuarterTurnTest({long:true})',
        true,
      );
      await fs.writeFile(
        path.join(destination, 'quarter-turn-small.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
    } catch (error) {
      result.quarterTurn.small = { pass: false, error: error.message };
    }
    try {
      result.textFlow.small = await window.webContents.executeJavaScript(
        'window.__wadTextFlowTest({long:true})',
        true,
      );
      await fs.writeFile(
        path.join(destination, 'text-flow-small.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
    } catch (error) {
      result.textFlow.small = { pass: false, error: error.message };
    }
  } finally {
    window.setBounds(originalBounds);
  }
  const sceneBoundsPass = [...result.visualScenes, ...result.smallWindowScenes].every(
    (scene) => scene.bounds?.readingWithinStage,
  );
  result.visualScenesWithinStage = sceneBoundsPass;
  result.overlapPass = result.overlap.normal?.pass && result.overlap.small?.pass;
  result.quarterTurnPass =
    result.quarterTurn.normal?.pass && result.quarterTurn.long?.pass && result.quarterTurn.small?.pass;
  result.textFlowPass =
    result.textFlow.normal?.pass && result.textFlow.long?.pass && result.textFlow.small?.pass;
  result.success = evaluateSmokeResult(result, { fileSmokeMode, captureSmokeMode, externalCaptureSmokeMode });
  await fs.writeFile(path.join(destination, 'windows-smoke.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result));
  app.exit(result.success ? 0 : 1);
  return result;
}

function safeLabel(value) {
  return (
    String(value || 'bili')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'bili'
  );
}

async function runLiveMusicTest(
  window,
  rendererErrors,
  { app, selectedDisplay, workspace, label = 'bili', duration = 30000 } = {},
) {
  label = safeLabel(label);
  duration = Math.min(60000, Math.max(1000, Number(duration) || 30000));
  const destination = path.join(workspace, 'artifacts');
  await fs.mkdir(destination, { recursive: true });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  const result = {
    mode: 'live-music',
    label,
    requestedDurationMs: duration,
    syntheticAudio: false,
    inputSource: 'system-audio',
    rendererErrors,
    targetDisplay: {
      id: selectedDisplay.id,
      label: selectedDisplay.label,
      bounds: selectedDisplay.bounds,
      workArea: selectedDisplay.workArea,
      scaleFactor: selectedDisplay.scaleFactor,
    },
    windowBounds: window.getBounds(),
  };
  try {
    await window.webContents.executeJavaScript('window.__wadLiveMusicTrace = []', true);
    const argument = JSON.stringify({ duration, label });
    result.liveMusic = await window.webContents.executeJavaScript(
      '(async () => { if (!window.desktop?.testMode) throw new Error("Native live QA requires test mode."); if (typeof window.__wadLiveMusicTest !== "function") throw new Error("Live music renderer QA hook is unavailable."); return window.__wadLiveMusicTest(' +
        argument +
        '); })()',
      true,
    );
    if (result.liveMusic?.mode !== 'system')
      throw new Error('Live music QA did not confirm system-audio input.');
  } catch (error) {
    result.liveMusicError = error.message;
  }
  let trace = [];
  try {
    trace = await window.webContents.executeJavaScript('window.__wadLiveMusicTrace || []');
  } catch (error) {
    result.traceError = error.message;
  }
  if (!Array.isArray(trace)) {
    result.traceError = 'Live trace must be an array.';
    trace = [];
  }
  result.traceSamples = trace.length;
  result.traceFile = 'live-music-' + label + '-trace.json';
  try {
    const alignment = await window.webContents.executeJavaScript('window.__wadLiveAlignmentTrace || []');
    if (!Array.isArray(alignment)) throw new Error('Live alignment trace must be an array.');
    result.alignmentSamples = alignment.length;
    result.alignmentFile = 'live-music-' + label + '-alignment.json';
    await fs.writeFile(path.join(destination, result.alignmentFile), JSON.stringify(alignment), 'utf8');
  } catch (error) {
    result.traceError = error.message;
  }
  result.success = confirmedLiveCapture(result);
  if (!result.success && !result.liveMusicError && !result.traceError && !rendererErrors.length)
    result.captureIssue =
      'No usable audible system signal; internal pulses are not evidence of music alignment.';
  await fs.writeFile(path.join(destination, result.traceFile), JSON.stringify(trace), 'utf8');
  await fs.writeFile(
    path.join(destination, 'live-music-' + label + '.json'),
    JSON.stringify(result, null, 2),
    'utf8',
  );
  console.log(JSON.stringify(result));
  app.exit(result.success ? 0 : 1);
  return result;
}

module.exports = {
  runSmokeTest,
  runLiveMusicTest,
  safeLabel,
  evaluateSmokeResult,
  confirmedReference,
  confirmedLiveCapture,
  createDrumQAFixtures,
  scoreNativeDrumResponse,
};
