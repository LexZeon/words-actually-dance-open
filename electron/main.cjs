'use strict';

const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeTheme,
  screen,
  session,
} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { runSmokeTest } = require('./native-qa.cjs');
const { readBoundedFile } = require('./desktop-files.cjs');
const { createDesktopWrites } = require('./desktop-writes.cjs');
const { chooseDisplay } = require('./display-policy.cjs');
const distribution = require('../package.json').wadDistribution;
const { pathToFileURL } = require('node:url');

const APP_NAME = 'Words Actually Dance';
const entryFile = path.join(__dirname, '..', 'src', 'index.html');
const entryURL = pathToFileURL(entryFile).href;
const interactiveQAMode = process.argv.includes('--interactive-qa');
const recordShowcaseMode = process.argv.includes('--record-showcase');
const externalCaptureSmokeMode = process.argv.includes('--external-capture-smoke-test');
const fileSmokeMode = process.argv.includes('--file-smoke-test');
const captureSmokeMode = process.argv.includes('--capture-smoke-test') || externalCaptureSmokeMode;
const liveMusicMode = process.argv.includes('--live-music-test');
const annotatedMusicMode = process.argv.includes('--annotated-music-test');
const sectionSmokeMode = process.argv.includes('--section-smoke-test');
const ghostSmokeMode = process.argv.includes('--ghost-smoke-test');
const liveSectionMode = process.argv.includes('--live-section-test');
const liveSectionDuration =
  Number(
    process.argv
      .find((argument) => argument.startsWith('--live-section-duration='))
      ?.slice('--live-section-duration='.length),
  ) || 90000;
const liveMusicLabel =
  process.argv
    .find((argument) => argument.startsWith('--live-music-label='))
    ?.slice('--live-music-label='.length) || 'bili';
const liveMusicDuration =
  Number(
    process.argv
      .find((argument) => argument.startsWith('--live-music-duration='))
      ?.slice('--live-music-duration='.length),
  ) || 30000;
const smokeMode =
  recordShowcaseMode ||
  process.argv.includes('--smoke-test') ||
  captureSmokeMode ||
  fileSmokeMode ||
  liveMusicMode ||
  annotatedMusicMode ||
  sectionSmokeMode ||
  ghostSmokeMode ||
  liveSectionMode;
const testMode = smokeMode || interactiveQAMode;
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const MAX_SCRIPT_BYTES = 512 * 1024;
const MAX_PROMPT_CHARS = 50000;
const MAX_EXPORT_CHARS = 2 * 1024 * 1024;
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ');

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('studio.lexzeon.words-actually-dance');
if (testMode)
  app.setPath('userData', path.join(os.tmpdir(), `words-actually-dance-qa-${process.pid}-${randomUUID()}`));
const primaryInstance = testMode || app.requestSingleInstanceLock();

let mainWindow = null;
let selectedDisplay = null;
const writes = createDesktopWrites({ filesystem: fs });
let quitDrainInProgress = false;

function isEntryURL(url) {
  try {
    const candidate = new URL(url);
    candidate.search = '';
    candidate.hash = '';
    return candidate.href === entryURL;
  } catch {
    return false;
  }
}

function trustedContents(contents) {
  return (
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    contents === mainWindow.webContents &&
    !contents.isDestroyed() &&
    isEntryURL(contents.getURL())
  );
}

function trustedFrame(frame) {
  return (
    !!frame &&
    trustedContents(mainWindow?.webContents) &&
    frame === mainWindow.webContents.mainFrame &&
    isEntryURL(frame.url)
  );
}

function handle(channel, listener) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedContents(event.sender) || !trustedFrame(event.senderFrame)) {
      throw new Error('Untrusted desktop request.');
    }
    return listener(...args);
  });
}

function stateFile() {
  return path.join(app.getPath('userData'), 'experiment-state.json');
}

function safeFileTitle(value) {
  const title = String(value || '字真的在跳动')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 100)
    .replace(/[. ]+$/g, '');
  return !title || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(title) ? '字真的在跳动' : title;
}

function installDesktopBridge() {
  handle('wad:choose-script', async () => {
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: '导入文案',
      properties: ['openFile'],
      filters: [{ name: '文字与标准文案', extensions: ['txt', 'json'] }],
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const file = choice.filePaths[0];
    if (!/\.(?:txt|json)$/i.test(file)) throw new Error('请选择 TXT 或 JSON 文案。');
    const bytes = await readBoundedFile(file, MAX_SCRIPT_BYTES, '请选择小于 512 KB 的文案文件。');
    return { name: path.basename(file), bytes: new Uint8Array(bytes) };
  });

  handle('wad:copy-text', (text) => {
    if (typeof text !== 'string' || text.length > MAX_PROMPT_CHARS) throw new Error('复制内容无效或过长。');
    clipboard.writeText(text);
    return { copied: true };
  });

  handle('wad:export-script', async (payload) => {
    if (!payload || typeof payload.text !== 'string' || payload.text.length > 100000)
      throw new Error('标准文案无效或超过导出大小限制。');
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: '保存标准文案',
      defaultPath: path.join(app.getPath('downloads'), `${safeFileTitle(payload.title)}.wad.json`),
      filters: [{ name: '标准文案 JSON', extensions: ['json'] }],
    });
    if (choice.canceled || !choice.filePath) return { saved: false };
    await writes.write(choice.filePath, payload.text);
    return { saved: true, name: path.basename(choice.filePath) };
  });

  handle('wad:choose-audio', async () => {
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: '选择音乐',
      properties: ['openFile'],
      filters: [{ name: '音乐文件', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm'] }],
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const file = choice.filePaths[0];
    const bytes = await readBoundedFile(file, MAX_AUDIO_BYTES, '请选择小于 200 MB 的音乐文件。');
    return { name: path.basename(file), bytes: new Uint8Array(bytes) };
  });

  handle('wad:export-text', async (payload) => {
    if (!payload || typeof payload.text !== 'string' || payload.text.length > MAX_EXPORT_CHARS) {
      throw new Error('文案无效或超过导出大小限制。');
    }
    const title = safeFileTitle(payload.title);
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: '保存文案',
      defaultPath: path.join(app.getPath('downloads'), `${title || '字真的在跳动'}.txt`),
      filters: [{ name: '文本文档', extensions: ['txt'] }],
    });
    if (choice.canceled || !choice.filePath) return { saved: false };
    await writes.write(choice.filePath, '\uFEFF' + payload.text.replace(/\r?\n/g, '\r\n'));
    return { saved: true, name: path.basename(choice.filePath) };
  });

  handle('wad:load-state', async () => {
    await writes.settled(stateFile());
    try {
      const file = stateFile();
      const bytes = await readBoundedFile(file, MAX_STATE_BYTES, '本地设置超过 2 MB。');
      const state = JSON.parse(bytes.toString('utf8'));
      return state && typeof state === 'object' && !Array.isArray(state) ? state : null;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      // Native I/O and JSON errors can contain the user's original notes/path.
      // Preserve the file and report a generic failure through the renderer.
      throw new Error('本地文案或设置未能读取。');
    }
  });

  handle('wad:save-state', async (state) => {
    if (!state || typeof state !== 'object' || Array.isArray(state))
      throw new Error('Invalid local preferences.');
    const json = JSON.stringify(state);
    if (Buffer.byteLength(json, 'utf8') > MAX_STATE_BYTES) throw new Error('Local preferences exceed 2 MB.');
    await writes.write(stateFile(), json, { createDirectory: true });
    return { saved: true };
  });

  handle('wad:window-control', async (action) => {
    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'maximize')
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    else if (action === 'close') mainWindow.close();
    else throw new Error('Invalid window action.');
  });
}

function secureSession(ses) {
  ses.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (!trustedContents(contents) || details?.isMainFrame !== true) return false;
    if (!isEntryURL(details?.requestingUrl)) return false;
    return permission === 'display-capture';
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    // Electron 44.7 labels getDisplayMedia as "media" before invoking the
    // display handler, but only DEVICE_AUDIO/VIDEO_CAPTURE populate mediaTypes.
    // An explicit empty list therefore allows the display/loopback handshake;
    // the gesture, exact frame and ASUS source are still checked below. Device
    // audio/video and requests without this detail remain denied.
    const displayMediaHandshake =
      permission === 'media' && Array.isArray(details?.mediaTypes) && details.mediaTypes.length === 0;
    const allowed =
      trustedContents(contents) &&
      details?.isMainFrame === true &&
      isEntryURL(details?.requestingUrl) &&
      (permission === 'display-capture' || displayMediaHandshake);
    callback(allowed);
  });

  // Capturing starts only after a deliberate renderer getDisplayMedia call.
  // Electron currently provides system-audio loopback on Windows only.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    let completed = false;
    const respond = (streams) => {
      if (completed) return;
      completed = true;
      try {
        callback(streams);
      } catch (error) {
        console.warn('The system audio request ended before its response:', error.message);
      }
    };
    if (
      process.platform !== 'win32' ||
      !trustedFrame(request.frame) ||
      !request.userGesture ||
      !request.audioRequested ||
      !request.videoRequested
    ) {
      respond(null);
      return;
    }
    if (recordShowcaseMode) {
      // Isolated recording mode captures this app's frame and its own audio only.
      respond({
        video: mainWindow.webContents.mainFrame,
        audio: mainWindow.webContents.mainFrame,
        enableLocalEcho: true,
      });
      return;
    }
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      });
      const source = sources.find((entry) => String(entry.display_id) === String(selectedDisplay?.id));
      if (!source || !trustedFrame(request.frame)) {
        respond(null);
        return;
      }
      respond({ video: source, audio: 'loopback' });
    } catch (error) {
      console.warn('System audio capture was unavailable:', error.message);
      respond(null);
    }
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
}

async function createWindow() {
  nativeTheme.themeSource = 'dark';
  const displays = screen.getAllDisplays();
  const requestedDisplayID = process.env.WAD_DISPLAY_ID;
  const displayFile = path.join(app.getPath('userData'), 'display-selection.json');
  let preferredId;
  if (distribution === 'open-source' && !testMode) {
    try {
      preferredId = JSON.parse(await fs.readFile(displayFile, 'utf8')).displayId;
    } catch {
      /* First run or stale preference asks again. */
    }
  }
  selectedDisplay = await chooseDisplay({
    displays,
    explicitId: requestedDisplayID,
    distribution,
    testMode,
    preferredId,
    choose: async (choices) => {
      const result = await dialog.showMessageBox({
        type: 'question',
        title: '选择播放屏幕',
        message: '你想在哪块屏幕上看文字跳舞？',
        detail: '只保存你的屏幕选择，可在拔插显示器后重新选择。系统声音仍需你主动开启。',
        buttons: [...choices.map((item) => item.label), '取消'],
        cancelId: choices.length,
        noLink: true,
      });
      return choices[result.response]?.id ?? null;
    },
  });
  if (distribution === 'open-source' && !testMode && selectedDisplay.id !== preferredId)
    await writes.write(displayFile, JSON.stringify({ displayId: selectedDisplay.id }));
  const area = selectedDisplay.workArea;
  const width = Math.max(960, Math.min(1280, area.width - 80));
  const height = Math.max(700, Math.min(920, area.height - 80));
  const x = area.x + Math.round((area.width - width) / 2);
  const y = area.y + Math.max(0, Math.min(300, Math.round((area.height - height) / 2)));
  const ses = session.fromPartition('persist:words-experiment');
  secureSession(ses);
  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 960,
    minHeight: 700,
    show: false,
    backgroundColor: '#080808',
    title: APP_NAME,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      partition: 'persist:words-experiment',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
      spellcheck: false,
      additionalArguments: [`--wad-version=${app.getVersion()}`, ...(testMode ? ['--wad-test-mode'] : [])],
    },
  });
  const window = mainWindow;
  const rendererErrors = [];
  if (smokeMode) {
    window.webContents.on('console-message', (details, legacyLevel, legacyMessage) => {
      if (details.level === 'error') rendererErrors.push(details.message);
      else if (legacyLevel === 3) rendererErrors.push(legacyMessage);
    });
    window.webContents.on('preload-error', (_event, _file, error) => rendererErrors.push(error.message));
  }
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, legacyURL) => {
    if (!isEntryURL(event.url || legacyURL)) event.preventDefault();
  });
  window.webContents.on('will-frame-navigate', (event) => {
    if (!isEntryURL(event.url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  await window.loadFile(entryFile);
  // A genuinely visible window avoids Chromium's hidden-window rAF sampling cap.
  if (smokeMode) {
    window.showInactive();
    if (recordShowcaseMode) {
      const { runShowcaseRecording } = require('./showcase-recording.cjs');
      await runShowcaseRecording(window, rendererErrors, {
        app,
        selectedDisplay,
        workspace: path.resolve(process.env.WAD_QA_WORKSPACE || path.join(__dirname, '..')),
      });
      return;
    }
    if (ghostSmokeMode) {
      const { runGhostTest } = require('./ghost-qa.cjs');
      await runGhostTest(window, rendererErrors, {
        app,
        selectedDisplay,
        workspace: path.resolve(process.env.WAD_QA_WORKSPACE || path.join(__dirname, '..')),
      });
      return;
    }
    if (liveSectionMode) {
      const { runLiveSectionTest } = require('./music-section-qa.cjs');
      await runLiveSectionTest(window, rendererErrors, {
        app,
        selectedDisplay,
        workspace: path.resolve(process.env.WAD_QA_WORKSPACE || path.join(__dirname, '..')),
        duration: liveSectionDuration,
      });
      return;
    }
    if (sectionSmokeMode) {
      const { runSectionTest } = require('./music-section-qa.cjs');
      await runSectionTest(window, rendererErrors, {
        app,
        selectedDisplay,
        workspace: path.resolve(process.env.WAD_QA_WORKSPACE || path.join(__dirname, '..')),
      });
      return;
    }
    if (annotatedMusicMode) {
      const { runAnnotatedMusicTest } = require('./annotated-music-qa.cjs');
      await runAnnotatedMusicTest(window, rendererErrors, {
        app,
        selectedDisplay,
        workspace: path.resolve(process.env.WAD_QA_WORKSPACE || path.join(__dirname, '..')),
        manifestPath: process.env.WAD_MUSIC_MANIFEST,
      });
      return;
    }
    await runSmokeTest(window, rendererErrors, {
      app,
      selectedDisplay,
      workspace: path.resolve(process.env.WAD_QA_WORKSPACE || path.join(__dirname, '..')),
      fileSmokeMode,
      captureSmokeMode,
      externalCaptureSmokeMode,
      liveMusicMode,
      liveMusicLabel,
      duration: liveMusicDuration,
    });
  } else window.showInactive();
}

if (!primaryInstance) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app
    .whenReady()
    .then(async () => {
      installDesktopBridge();
      await createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(console.error);
      });
    })
    .catch((error) => {
      console.error('Could not start Words Actually Dance:', error);
      app.exit(1);
    });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Accepted state and export writes must finish before a normal quit.
// Native QA uses app.exit and an isolated userData path, so it does not drain user data.
app.on('before-quit', (event) => {
  if (writes.pendingCount === 0) return;
  event.preventDefault();
  if (quitDrainInProgress) return;
  quitDrainInProgress = true;
  (async () => {
    await writes.drain();
    quitDrainInProgress = false;
    app.quit();
  })().catch((error) => {
    quitDrainInProgress = false;
    console.error('Could not finish accepted local state writes:', error.message);
    app.quit();
  });
});
