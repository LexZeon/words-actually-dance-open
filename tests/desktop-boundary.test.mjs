import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const mainFile = fileURLToPath(new URL('../electron/main.cjs', import.meta.url));
const mainSource = await fs.readFile(mainFile, 'utf8');
const entry = pathToFileURL(path.resolve(path.dirname(mainFile), '../src/index.html')).href;
const flush = () => new Promise(setImmediate);

async function desktop({
  lock = true,
  args = [],
  filesystem = fs,
  boundedRead,
  openChoice,
  saveChoice,
  displays,
  env = {},
  distribution = 'private',
  displayChoice = { response: 0 },
  userData = path.join(os.tmpdir(), 'wad-desktop-boundary'),
} = {}) {
  const windows = [],
    handlers = new Map(),
    calls = [];
  const app = new EventEmitter();
  const locations = { userData, downloads: os.tmpdir() };
  app.setName = () => {};
  app.setAppUserModelId = () => {};
  app.setPath = (key, value) => {
    locations[key] = value;
  };
  app.getPath = (key) => locations[key];
  app.getVersion = () => '0.2.0';
  app.requestSingleInstanceLock = () => {
    calls.push('lock');
    return lock;
  };
  app.whenReady = () => {
    calls.push('ready');
    return Promise.resolve();
  };
  app.quit = () => calls.push('quit');
  app.exit = (code) => calls.push(['exit', code]);
  const ses = {
    setPermissionCheckHandler(handler) {
      this.checkPermission = handler;
    },
    setPermissionRequestHandler(handler) {
      this.requestPermission = handler;
    },
    setDisplayMediaRequestHandler(handler) {
      this.capture = handler;
    },
    webRequest: {
      onHeadersReceived(handler) {
        ses.headers = handler;
      },
    },
  };
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.minimized = false;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: entry };
      this.webContents.getURL = () => entry;
      this.webContents.isDestroyed = () => false;
      this.webContents.setWindowOpenHandler = (handler) => {
        this.openWindow = handler;
      };
      windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    async loadFile() {}
    setMenu() {}
    showInactive() {
      calls.push('show-inactive');
    }
    show() {
      calls.push('show');
    }
    focus() {
      calls.push('focus');
    }
    restore() {
      this.minimized = false;
      calls.push('restore');
    }
    isMinimized() {
      return this.minimized;
    }
    static getAllWindows() {
      return windows.filter((window) => !window.destroyed);
    }
  }
  const sources = [
    { id: 'screen:alienware', display_id: '2174041335' },
    { id: 'screen:asus', display_id: '954728797' },
  ];
  const electron = {
    app,
    BrowserWindow: Window,
    clipboard: {
      writeText(value) {
        calls.push(['clipboard', value]);
      },
    },
    desktopCapturer: {
      async getSources() {
        calls.push('sources');
        return sources;
      },
    },
    dialog: {
      async showMessageBox(options) {
        calls.push(['display-dialog', options]);
        return displayChoice;
      },
      async showOpenDialog() {
        return openChoice || { canceled: true, filePaths: [] };
      },
      async showSaveDialog(_window, options) {
        calls.push(['save-dialog', options]);
        return saveChoice || { canceled: true };
      },
    },
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
    },
    nativeTheme: {},
    screen: {
      getAllDisplays: () =>
        displays || [
          { id: 954728797, label: 'ASUS PA279', workArea: { x: 2560, y: 0, width: 1441, height: 2512 } },
        ],
    },
    session: { fromPartition: () => ses },
  };
  vm.runInNewContext(
    mainSource,
    {
      require(id) {
        if (id === 'electron') return electron;
        if (id === 'node:fs/promises') return filesystem;
        if (id === './native-qa.cjs')
          return {
            async runSmokeTest() {
              calls.push('smoke');
            },
          };
        if (id === './desktop-files.cjs') {
          const files = require('../electron/desktop-files.cjs');
          return boundedRead ? { ...files, readBoundedFile: boundedRead } : files;
        }
        if (id === './desktop-writes.cjs') return require('../electron/desktop-writes.cjs');
        if (id === './display-policy.cjs') return require('../electron/display-policy.cjs');
        if (id === '../package.json') return { ...require('../package.json'), wadDistribution: distribution };
        return require(id);
      },
      process: { platform: 'win32', argv: ['electron', ...args], env, pid: 98765 },
      console: {
        warn(...detail) {
          calls.push(['warn', ...detail]);
        },
        error(...detail) {
          calls.push(['error', ...detail]);
        },
      },
      __dirname: path.dirname(mainFile),
      URL,
      Buffer,
    },
    { filename: mainFile },
  );
  await flush();
  return {
    app,
    windows,
    handlers,
    calls,
    ses,
    locations,
    invoke(channel, ...values) {
      const contents = windows[0].webContents;
      return handlers.get(channel)({ sender: contents, senderFrame: contents.mainFrame }, ...values);
    },
  };
}

test('production takes one instance lock, and another launch reuses the existing ASUS window', async () => {
  const primary = await desktop();
  assert.equal(primary.calls.filter((call) => call === 'lock').length, 1);
  assert.equal(primary.windows.length, 1);
  const window = primary.windows[0];
  window.minimized = true;
  primary.app.emit('second-instance');
  assert.equal(primary.windows.length, 1);
  assert.ok(primary.calls.includes('restore') && primary.calls.includes('focus'));
  assert.ok(window.options.x >= 2560);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  const secondary = await desktop({ lock: false });
  assert.equal(secondary.windows.length, 0);
  assert.equal(secondary.handlers.size, 0);
  assert.deepEqual(secondary.calls, ['lock', 'quit']);
});

test('public production asks for a connected display, persists that actual choice, and cancel never falls back', async (t) => {
  const temporary = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temporary, 'wad-display-boundary-'));
  t.after(async () => {
    const actual = await fs.realpath(directory);
    assert.equal(path.dirname(actual), temporary);
    assert.ok(path.basename(actual).startsWith('wad-display-boundary-'));
    await fs.rm(actual, { recursive: true, force: true });
  });
  const displays = [
    {
      id: 1,
      label: 'Connected display',
      size: { width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    },
    {
      id: 2,
      label: 'ASUS PA279',
      size: { width: 1440, height: 2560 },
      workArea: { x: 2560, y: 0, width: 1440, height: 2560 },
    },
  ];
  const settled = async (harness) => {
    const end = Date.now() + 2000;
    while (
      !harness.windows.length &&
      !harness.calls.some((call) => Array.isArray(call) && call[0] === 'exit') &&
      Date.now() < end
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    return harness;
  };
  const selected = await settled(
    await desktop({ distribution: 'open-source', displays, userData: directory }),
  );
  assert.equal(selected.windows.length, 1);
  assert.ok(selected.windows[0].options.x < 1920, 'the chosen screen, not the private ASUS policy');
  assert.equal(
    selected.calls.filter((call) => Array.isArray(call) && call[0] === 'display-dialog').length,
    1,
  );
  const saved = JSON.parse(await fs.readFile(path.join(directory, 'display-selection.json'), 'utf8'));
  assert.equal(saved.displayId, 1);
  assert.equal(selected.windows[0].options.webPreferences.contextIsolation, true);
  assert.equal(selected.windows[0].options.webPreferences.sandbox, true);
  const restored = await settled(
    await desktop({ distribution: 'open-source', displays, userData: directory }),
  );
  assert.equal(restored.windows.length, 1);
  assert.ok(!restored.calls.some((call) => Array.isArray(call) && call[0] === 'display-dialog'));
  const canceled = await settled(
    await desktop({
      distribution: 'open-source',
      displays,
      userData: path.join(directory, 'cancel'),
      displayChoice: { response: 2 },
    }),
  );
  assert.equal(canceled.windows.length, 0);
  assert.ok(canceled.calls.some((call) => Array.isArray(call) && call[0] === 'exit' && call[1] === 1));
  assert.ok(!canceled.calls.includes('sources'));
  const qa = await settled(
    await desktop({
      distribution: 'open-source',
      args: ['--interactive-qa'],
      displays: displays.slice(0, 1),
      userData: directory,
    }),
  );
  assert.equal(qa.windows.length, 0, 'public QA retains the explicitly required local display policy');
  assert.ok(!qa.calls.some((call) => Array.isArray(call) && call[0] === 'display-dialog'));
});

test('interactive QA isolates state and exposes only existing QA hooks without running or exiting smoke', async () => {
  const interactive = await desktop({ args: ['--interactive-qa'] });
  assert.match(interactive.locations.userData, /words-actually-dance-qa-98765/);
  assert.ok(interactive.windows[0].options.webPreferences.additionalArguments.includes('--wad-test-mode'));
  assert.ok(!interactive.calls.includes('lock') && !interactive.calls.includes('smoke'));
  assert.ok(!interactive.calls.some((call) => Array.isArray(call) && call[0] === 'exit'));
  const smoke = await desktop({ args: ['--smoke-test'] });
  assert.ok(smoke.calls.includes('smoke') && !smoke.calls.includes('lock'));
  assert.notEqual(smoke.locations.userData, interactive.locations.userData);
});

test('an unavailable ASUS display fails startup without opening an Alienware fallback window', async () => {
  const harness = await desktop({
    displays: [{ id: 2174041335, label: 'Alienware', workArea: { x: 0, y: 0, width: 2560, height: 1440 } }],
  });
  assert.equal(harness.windows.length, 0);
  assert.ok(harness.calls.some((call) => Array.isArray(call) && call[0] === 'exit' && call[1] === 1));
  assert.ok(!harness.calls.includes('sources'));
});

test('navigation and window creation stay on the entry document, and every resource receives the desktop CSP', async () => {
  const harness = await desktop();
  const window = harness.windows[0];
  assert.equal(window.openWindow({ url: 'https://example.com' }).action, 'deny');
  for (const url of [
    'https://example.com',
    'file:///C:/private.txt',
    entry.replace('index.html', 'other.html'),
  ]) {
    let prevented = 0;
    window.webContents.emit('will-navigate', {
      url,
      preventDefault() {
        prevented++;
      },
    });
    window.webContents.emit('will-frame-navigate', {
      url,
      preventDefault() {
        prevented++;
      },
    });
    assert.equal(prevented, 2);
  }
  let prevented = false;
  window.webContents.emit('will-navigate', {
    url: `${entry}#experience`,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
  window.webContents.emit('will-attach-webview', {
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  let headers;
  harness.ses.headers({ responseHeaders: { 'Content-Type': ['text/javascript'] } }, (value) => {
    headers = value.responseHeaders;
  });
  assert.equal(headers['Content-Type'][0], 'text/javascript');
  assert.match(headers['Content-Security-Policy'][0], /object-src 'none'/);
  assert.match(headers['Content-Security-Policy'][0], /connect-src 'self'/);
});

test('desktop IPC rejects foreign contents and subframes before clipboard or dialog work', async () => {
  const harness = await desktop();
  const clipboard = harness.handlers.get('wad:copy-text');
  const contents = harness.windows[0].webContents;
  await assert.rejects(
    clipboard({ sender: { ...contents }, senderFrame: contents.mainFrame }, 'private'),
    /Untrusted/,
  );
  await assert.rejects(clipboard({ sender: contents, senderFrame: { url: entry } }, 'private'), /Untrusted/);
  assert.ok(!harness.calls.some((call) => Array.isArray(call) && call[0] === 'clipboard'));
  await harness.invoke('wad:copy-text', '我的演出文案');
  assert.ok(
    harness.calls.some(
      (call) => Array.isArray(call) && call[0] === 'clipboard' && call[1] === '我的演出文案',
    ),
  );
  await assert.rejects(harness.invoke('wad:copy-text', 'a'.repeat(50001)), /过长/);
  await assert.rejects(harness.invoke('wad:export-script', { text: 'a'.repeat(100001) }), /大小限制/);
  assert.ok(!harness.calls.some((call) => Array.isArray(call) && call[0] === 'save-dialog'));
});

test('display capture accepts Electron’s empty media handshake but rejects device permissions and unknown details', async () => {
  const harness = await desktop();
  const contents = harness.windows[0].webContents;
  assert.equal(
    harness.ses.checkPermission(contents, 'display-capture', '', { isMainFrame: true, requestingUrl: entry }),
    true,
  );
  const trusted = { isMainFrame: true, requestingUrl: entry };
  for (const permission of ['media', 'speaker-selection', 'clipboard-read', 'geolocation']) {
    assert.equal(harness.ses.checkPermission(contents, permission, '', trusted), false);
    let granted;
    harness.ses.requestPermission(
      contents,
      permission,
      (value) => {
        granted = value;
      },
      trusted,
    );
    assert.equal(granted, false);
  }
  const mediaRequest = (details, source = contents) => {
    let granted;
    harness.ses.requestPermission(
      source,
      'media',
      (value) => {
        granted = value;
      },
      details,
    );
    return granted;
  };
  assert.equal(mediaRequest({ ...trusted, mediaTypes: [] }), true);
  for (const mediaTypes of [['audio'], ['video'], ['audio', 'video'], ['unknown'], undefined, null, '']) {
    assert.equal(mediaRequest({ ...trusted, mediaTypes }), false);
  }
  for (const mediaType of ['audio', 'video', 'unknown']) {
    assert.equal(harness.ses.checkPermission(contents, 'media', '', { ...trusted, mediaType }), false);
  }
  assert.equal(mediaRequest({ ...trusted, mediaTypes: [], isMainFrame: false }), false);
  assert.equal(mediaRequest({ mediaTypes: [], requestingUrl: entry }), false);
  assert.equal(mediaRequest({ mediaTypes: [], isMainFrame: true }), false);
  assert.equal(mediaRequest({ ...trusted, mediaTypes: [], requestingUrl: 'https://example.com' }), false);
  assert.equal(mediaRequest({ ...trusted, mediaTypes: [] }, { ...contents }), false);
  assert.equal(harness.ses.checkPermission(contents, 'display-capture', '', { isMainFrame: false }), false);
  assert.equal(
    harness.ses.checkPermission(contents, 'display-capture', '', { requestingUrl: 'https://example.com' }),
    false,
  );
});

test('system capture requires a gesture and trusted frame, picks ASUS, and completes a callback only once', async () => {
  const harness = await desktop();
  const request = {
    frame: harness.windows[0].webContents.mainFrame,
    userGesture: true,
    audioRequested: true,
    videoRequested: true,
  };
  for (const changes of [{ userGesture: false }, { frame: { url: entry } }, { audioRequested: false }]) {
    let granted = true;
    await harness.ses.capture({ ...request, ...changes }, (value) => {
      granted = value;
    });
    assert.equal(granted, null);
  }
  assert.ok(!harness.calls.includes('sources'));
  let granted;
  await harness.ses.capture(request, (value) => {
    granted = value;
  });
  assert.equal(granted.video.display_id, '954728797');
  assert.equal(granted.audio, 'loopback');
  let count = 0;
  await harness.ses.capture(request, () => {
    count++;
    throw new Error('frame disappeared');
  });
  assert.equal(count, 1);
});

test('normal quit waits for an accepted export while cancel does not create a pending write', async () => {
  let finishWrite;
  const write = new Promise((resolve) => {
    finishWrite = resolve;
  });
  const harness = await desktop({
    filesystem: {
      ...fs,
      async open() {
        return { writeFile: () => write, sync: async () => {}, close: async () => {} };
      },
      rename: async () => {},
      unlink: async () => {},
    },
    saveChoice: { canceled: false, filePath: path.join(os.tmpdir(), 'mock-only-export.wad.json') },
  });
  const exported = harness.invoke('wad:export-script', { title: 'CON', text: '{}' });
  await flush();
  const options = harness.calls.find((call) => Array.isArray(call) && call[0] === 'save-dialog')[1];
  assert.ok(options.defaultPath.endsWith('字真的在跳动.wad.json'));
  let prevented = 0;
  harness.app.emit('before-quit', {
    preventDefault() {
      prevented++;
    },
  });
  await flush();
  assert.equal(prevented, 1);
  assert.ok(!harness.calls.includes('quit'));
  finishWrite();
  assert.equal((await exported).saved, true);
  await flush();
  assert.ok(harness.calls.includes('quit'));
  const canceled = await desktop();
  assert.equal((await canceled.invoke('wad:export-text', { text: '文字' })).saved, false);
  canceled.app.emit('before-quit', {
    preventDefault() {
      throw new Error('cancel must not drain');
    },
  });
});

test('missing native state remains a quiet first run while non-object legacy roots keep their existing fallback', async () => {
  const missing = await desktop({
    boundedRead: async () => {
      throw Object.assign(new Error('missing private path'), { code: 'ENOENT' });
    },
  });
  assert.equal(await missing.invoke('wad:load-state'), null);
  assert.ok(!missing.calls.some((call) => Array.isArray(call) && ['warn', 'error'].includes(call[0])));
  for (const json of ['null', '[]', '"legacy"']) {
    const harness = await desktop({ boundedRead: async () => Buffer.from(json) });
    assert.equal(await harness.invoke('wad:load-state'), null);
  }
  const valid = await desktop({ boundedRead: async () => Buffer.from('{"schemaVersion":2,"topicIndex":1}') });
  const state = await valid.invoke('wad:load-state');
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.topicIndex, 1);
});

test('native read errors and malformed private JSON reach the renderer only as a generic state error', async () => {
  const privateNotes = '私密原始文案 DO_NOT_LEAK 不是JSON';
  const privatePath = 'C:\\Users\\private-notes\\experiment-state.json';
  for (const boundedRead of [
    async () => Buffer.from(privateNotes),
    async () => {
      throw Object.assign(new Error(`EACCES: permission denied, open '${privatePath}'`), { code: 'EACCES' });
    },
    async () => {
      throw new Error(`oversized private state: ${privateNotes}`);
    },
  ]) {
    const harness = await desktop({ boundedRead });
    await assert.rejects(harness.invoke('wad:load-state'), (error) => {
      assert.equal(error.message, '本地文案或设置未能读取。');
      assert.equal(error.cause, undefined);
      assert.ok(!String(error).includes('DO_NOT_LEAK'));
      assert.ok(!String(error).includes(privatePath));
      return true;
    });
    assert.ok(!harness.calls.some((call) => Array.isArray(call) && ['warn', 'error'].includes(call[0])));
    assert.ok(!harness.calls.some((call) => Array.isArray(call) && call[0] === 'save-dialog'));
  }
});
