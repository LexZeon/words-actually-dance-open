'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

async function runShowcaseRecording(window, rendererErrors, { app, workspace, selectedDisplay }) {
  const destination = path.join(workspace, 'artifacts', 'showcase-recordings');
  await fs.mkdir(destination, { recursive: true });
  const report = {
    version: app.getVersion(),
    display: { label: selectedDisplay.label, id: selectedDisplay.id },
    windowBounds: window.getBounds(),
    rendererErrors,
    clips: [],
    success: false,
  };
  try {
    await window.webContents.executeJavaScript(
      'new Promise((resolve,reject)=>{const until=performance.now()+15000;function check(){if(window.__wadReady&&window.__wadRecordShowcase)resolve();else if(performance.now()>until)reject(new Error("Recording hook unavailable"));else setTimeout(check,25)}check()})',
    );
    for (const scenario of ['overview', 'ghosts', 'learning']) {
      const result = await window.webContents.executeJavaScript(
        `window.__wadRecordShowcase(${JSON.stringify(scenario)})`,
        true,
      );
      if (!result.stats.voicedFrames || !result.stats.drumHits || !result.stats.ghostSamples)
        throw new Error('Recording has no effective app audio or ghost response.');
      if (
        scenario === 'learning' &&
        (!result.stats.recall || !result.stats.pausedDuringRecall || !result.stats.answerDidNotAutoplay)
      )
        throw new Error('Recall demonstration did not perform its actual behavior.');
      const video = path.join(destination, `demo-${scenario}.webm`);
      await fs.writeFile(video, Buffer.from(result.base64, 'base64'));
      const poster = path.join(destination, `demo-${scenario}.png`);
      await fs.writeFile(poster, (await window.webContents.capturePage()).toPNG());
      report.clips.push({ ...result.stats, video: path.basename(video), poster: path.basename(poster) });
    }
    report.success = rendererErrors.length === 0 && report.clips.length === 3;
  } catch (error) {
    report.error = error.message;
  }
  await fs.writeFile(path.join(destination, 'recording-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  app.exit(report.success ? 0 : 1);
}
module.exports = { runShowcaseRecording };
