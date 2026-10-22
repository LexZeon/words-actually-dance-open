'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readBoundedFile } = require('./desktop-files.cjs');

/** Real WebAudio playback; independent labels are scored only in the host. */
async function runAnnotatedMusicTest(window, errors, { app, workspace, selectedDisplay, manifestPath }) {
  const output = path.join(workspace, 'artifacts');
  const result = {
    source: 'real-annotated-recordings',
    success: false,
    display: { id: selectedDisplay.id, label: selectedDisplay.label },
    bounds: window.getBounds(),
    rendererErrors: errors,
    fixtures: [],
  };
  try {
    const fixtures = JSON.parse(
      (await readBoundedFile(manifestPath, 65536, 'QA manifest too large.')).toString('utf8'),
    );
    if (!Array.isArray(fixtures) || !fixtures.length || fixtures.length > 8)
      throw new Error('Expected 1–8 music fixtures.');
    const { scoreInternalGrid } = await import(
      pathToFileURL(path.join(workspace, 'tests/helpers/grid-alignment-score.mjs')).href
    );
    await window.webContents.executeJavaScript(
      'new Promise((resolve, reject) => { const deadline = performance.now() + 10000; const check = () => window.__wadReady ? resolve(true) : performance.now() >= deadline ? reject(new Error("Player failed to become ready.")) : setTimeout(check, 20); check(); })',
    );
    for (const fixture of fixtures) {
      if (!/^[a-z0-9-]{1,80}$/i.test(fixture.name)) throw new Error('Invalid music fixture label.');
      const audio = await readBoundedFile(fixture.audio, 200 * 1024 * 1024, 'Audio too large.');
      const beats = JSON.parse(
        (await readBoundedFile(fixture.beats, 1024 * 1024, 'Beat annotations too large.')).toString('utf8'),
      );
      if (
        !Array.isArray(beats) ||
        beats.length < 4 ||
        beats.length > 100000 ||
        !beats.every((v, i) => Number.isFinite(v) && v >= 0 && (!i || v > beats[i - 1]))
      )
        throw new Error('Expected strictly ordered independent beat timestamps.');
      const duration = Math.min(60000, Math.max(1000, Number(fixture.duration) || 30000));
      const summary = await window.webContents.executeJavaScript(
        'window.__wadAnnotatedFileTest(' +
          JSON.stringify({ name: fixture.name, base64: audio.toString('base64'), duration }) +
          ')',
        true,
      );
      const trace = await window.webContents.executeJavaScript('window.__wadAnnotatedTrace');
      const events = trace.beats.map((e) => ({ ...e, kind: 'beat' }));
      const playedThrough = trace.frames.reduce(
        (maximum, row) => (Number.isFinite(row.musicTime) ? Math.max(maximum, row.musicTime) : maximum),
        0,
      );
      const end = Math.min(duration / 1000, summary.fileDuration, beats.at(-1), playedThrough);
      const windows = {
        early: { from: 2, to: Math.min(10, end) },
        late: { from: Math.max(2, end - 12), to: end },
      };
      const scores = Object.fromEntries(
        Object.entries(windows).map(([name, bounds]) => [
          name,
          {
            tight40: scoreInternalGrid(events, beats, { ...bounds, tolerance: 0.04 }),
            readable70: scoreInternalGrid(events, beats, { ...bounds, tolerance: 0.07 }),
          },
        ]),
      );
      await fs.writeFile(
        path.join(output, 'annotated-' + fixture.name + '-trace.json'),
        JSON.stringify(trace),
        'utf8',
      );
      const entry = {
        ...summary,
        dataset: fixture.dataset,
        annotationSource: fixture.annotationSource,
        scores,
        scoredSeconds: end,
      };
      result.fixtures.push(entry);
      await fs.writeFile(
        path.join(output, 'annotated-music-result.json'),
        JSON.stringify(result, null, 2),
        'utf8',
      );
      console.log(JSON.stringify({ fixture: fixture.name, voiced: summary.voicedCoverage, scores }));
    }
    result.success = !errors.length && result.fixtures.every((f) => f.voicedCoverage > 0.2 && f.frames > 10);
  } catch (error) {
    result.error = error.message;
  }
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(
    path.join(output, 'annotated-music-result.json'),
    JSON.stringify(result, null, 2),
    'utf8',
  );
  console.log(
    JSON.stringify({ success: result.success, error: result.error, fixtures: result.fixtures.length }),
  );
  app.exit(result.success ? 0 : 1);
  return result;
}
module.exports = { runAnnotatedMusicTest };
