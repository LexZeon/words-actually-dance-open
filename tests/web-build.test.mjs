import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { prepareWebSite } from '../scripts/prepare-web-site.mjs';
import { buildSite, webHtml } from '../web/scripts/build-site.mjs';
import { bootWebApp, configureWebSystemAudioButton } from '../web/web-app.js';
import { ImportIntents } from '../src/core/import-intents.js';
import { createProviderRegistry } from '../src/core/contracts.js';
import { createEventBus } from '../src/core/events.js';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function project(t) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'wad-web-test-'));
  t.after(async () => {
    const resolved = await fs.realpath(root);
    assert.ok(resolved.startsWith(path.join(parent, 'wad-web-test-')));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  for (const folder of ['src', 'web'])
    await fs.cp(path.join(sourceRoot, folder), path.join(root, folder), {
      recursive: true,
      filter: (file) =>
        !file
          .split(path.sep)
          .some(
            (name) =>
              ['node_modules', '.openai', '.git', 'dist', '.sites-runtime'].includes(name) ||
              name === '.env' ||
              name.startsWith('.env.'),
          ),
    });
  // This suite tests export behavior without requiring or copying a registered
  // deployment identity. The synthetic ID is never sent to a Sites service.
  await fs.mkdir(path.join(root, 'web/.openai'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'web/.openai/hosting.json'),
    JSON.stringify({ project_id: 'test-project', d1: 'LIBRARY_DB', r2: 'LIBRARY_FILES' }),
  );
  return root;
}

test('Site export copies shared source without desktop artifacts or credentials and preserves helper-owned state', async (t) => {
  const root = await project(t);
  await fs.writeFile(path.join(root, 'web/.env'), 'SECRET=never-export');
  await fs.writeFile(path.join(root, 'src/accidental-user-audio.wav'), 'raw material');
  const result = await prepareWebSite({ projectRoot: root });
  assert.ok(await fs.readFile(path.join(result.directory, 'src/visuals/dance-motion.js'), 'utf8'));
  const first = JSON.parse(await fs.readFile(path.join(result.directory, '.openai/hosting.json'), 'utf8'));
  assert.equal(first.project_id, 'test-project');
  assert.equal(first.d1, 'LIBRARY_DB');
  assert.equal(first.r2, 'LIBRARY_FILES');
  await fs.mkdir(path.join(result.directory, '.git'));
  await fs.writeFile(path.join(result.directory, '.git/keep'), 'git-state');
  await fs.writeFile(path.join(result.directory, 'collaborator-note.txt'), 'untouched');
  await fs.writeFile(path.join(root, 'src/test-export-marker.js'), 'export const revision = 2;');
  await prepareWebSite({ projectRoot: root });
  assert.equal(await fs.readFile(path.join(result.directory, '.git/keep'), 'utf8'), 'git-state');
  assert.equal(await fs.readFile(path.join(result.directory, 'collaborator-note.txt'), 'utf8'), 'untouched');
  await assert.rejects(fs.stat(path.join(result.directory, 'electron/main.cjs')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(result.directory, '.env')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(result.directory, 'web/.env')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(result.directory, 'src/accidental-user-audio.wav')), {
    code: 'ENOENT',
  });
  assert.ok(await fs.readFile(path.join(result.directory, 'src/test-export-marker.js'), 'utf8'));
});

test('prepare rejects an unrelated nonempty destination before touching its files', async (t) => {
  const root = await project(t),
    destination = path.join(root, 'artifacts/site-checkout');
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, 'important.txt'), 'keep');
  await assert.rejects(prepareWebSite({ projectRoot: root }), /unowned/);
  assert.equal(await fs.readFile(path.join(destination, 'important.txt'), 'utf8'), 'keep');
});

test('library can be removed through export/build while player source remains the shared application', async (t) => {
  const root = await project(t);
  const enabled = await prepareWebSite({ projectRoot: root });
  await fs.mkdir(path.join(enabled.directory, 'dist/.openai/drizzle'), { recursive: true });
  await fs.writeFile(path.join(enabled.directory, 'dist/.openai/drizzle/old.sql'), 'obsolete');
  const disabled = await prepareWebSite({ projectRoot: root, collaborationLibrary: false });
  const manifest = JSON.parse(
    await fs.readFile(path.join(disabled.directory, '.openai/hosting.json'), 'utf8'),
  );
  assert.equal(manifest.d1, null);
  assert.equal(manifest.r2, null);
  await assert.rejects(fs.stat(path.join(disabled.directory, 'web/web-library-client.js')), {
    code: 'ENOENT',
  });
  const bundler = {
    async build(options) {
      assert.equal(options.format, 'esm');
      assert.equal(options.bundle, true);
      await fs.writeFile(options.outfile, options.stdin.contents);
    },
  };
  const result = await buildSite({ projectRoot: disabled.directory, esbuild: bundler });
  const code = await fs.readFile(result.artifact, 'utf8');
  const worker = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`))
    .default;
  const html = await (await worker.fetch(new Request('https://example.test/'), {})).text();
  assert.ok(html.includes('data-collaboration-library="off"'));
  assert.ok(html.includes('data-web-public="true"'));
  assert.ok(html.includes('data-web-music-import="off"'));
  assert.ok(!html.includes('web-library.css'));
  const entry = await (await worker.fetch(new Request('https://example.test/web/web-app.js'), {})).text();
  assert.ok(entry.includes('../src/app/app-controller.js'));
  assert.ok(!entry.includes("from './web-library-client.js'"));
  assert.ok(!entry.includes("from './web-library-provider.js'"));
  assert.equal(
    (await worker.fetch(new Request('https://example.test/web/web-library-provider.js'), {})).status,
    404,
  );
  assert.equal(
    (await worker.fetch(new Request('https://example.test/src/visuals/dance-motion.js'), {})).status,
    200,
  );
  assert.equal((await worker.fetch(new Request('https://example.test/api/library'), {})).status, 404);
  assert.equal(
    (
      await worker.fetch(
        new Request('https://example.test/api/library', { method: 'POST', body: 'never-store' }),
        {},
      )
    ).status,
    404,
  );
  assert.equal(
    (await worker.fetch(new Request('https://example.test/api/library/previous-private-file/file'), {}))
      .status,
    404,
  );
  assert.equal(
    (await worker.fetch(new Request('https://example.test/.openai/hosting.json'), {})).status,
    404,
  );
  await assert.rejects(fs.stat(path.join(disabled.directory, 'dist/.openai/drizzle')), { code: 'ENOENT' });
});

test('web HTML retains every product playback control and loads web entry without rewriting desktop source', async () => {
  const source = await fs.readFile(path.join(sourceRoot, 'src/index.html'), 'utf8');
  const html = webHtml(source, true);
  for (const control of ['dance-canvas', 'knowledge-stage', 'play-button', 'audio-input', 'script-input'])
    assert.ok(html.includes(`id="${control}"`));
  assert.ok(html.includes('/web/web-app.js'));
  assert.ok(html.includes('/web/web-library.css'));
  assert.ok(source.includes('src="./app.js"'));
  assert.ok(!source.includes('collaboration-library'));
});

test('web bridge mounts only after real app boot and uses existing controlled file commands plus gesture audio unlock', async () => {
  const calls = [],
    handlers = new Map();
  let mounted;
  const description = { textContent: '' };
  const system = {
    setAttribute() {},
    querySelector() {
      return description;
    },
  };
  class App {
    constructor() {
      this.registry = createProviderRegistry();
      this.ownedProviders = [];
      this.bus = createEventBus();
      this.intents = new ImportIntents();
      this.audio = {
        initialize() {
          calls.push('initialize-audio');
          this.context = {
            resume() {
              calls.push('resume-audio');
            },
          };
        },
      };
    }
    async boot() {
      calls.push('boot');
      return true;
    }
    reserveImportIntent(channel) {
      calls.push(['reserve', channel]);
      return this.intents.reserve(channel);
    }
    importFiles(files, { intent }) {
      assert.equal(this.intents.isCurrent('music', intent), true);
      calls.push(['music', files, intent]);
    }
    importScriptFile(file, { intent }) {
      assert.equal(this.intents.isCurrent('script', intent), true);
      calls.push(['script', file, intent]);
    }
    async destroy() {
      calls.push('destroy');
    }
  }
  const windowRef = {
    addEventListener(name, fn) {
      handlers.set(name, fn);
    },
    removeEventListener(name) {
      handlers.delete(name);
    },
  };
  const documentRef = { body: {}, getElementById: () => system, querySelector: () => ({}) };
  const { app, library } = await bootWebApp({
    AppClass: App,
    documentRef,
    windowRef,
    mountLibrary(options) {
      calls.push('mount');
      mounted = options;
      return {
        destroy() {
          calls.push('destroy-library');
        },
      };
    },
  });
  assert.deepEqual(calls, ['boot', 'mount']);
  assert.equal(app.registry.get(mounted.provider.id), mounted.provider);
  assert.ok(app.ownedProviders.includes(mounted.provider));
  assert.deepEqual([...mounted.provider.capabilities].sort(), [
    'downloadFile',
    'listFiles',
    'removeFile',
    'uploadFile',
  ]);
  assert.equal(system.disabled, true);
  const musicIntent = mounted.beginSelection({ kind: 'music' });
  const scriptIntent = mounted.beginSelection({ kind: 'script' });
  await mounted.onPrepareMusic();
  const file = new File(['audio'], 'music.mp3');
  await mounted.onSelectMusic(file, {}, musicIntent);
  await mounted.onSelectScript(file, {}, scriptIntent);
  assert.deepEqual(calls.slice(2), [
    ['reserve', 'music'],
    ['reserve', 'script'],
    'initialize-audio',
    'resume-audio',
    ['music', [file], musicIntent],
    ['script', file, scriptIntent],
  ]);
  handlers.get('beforeunload')();
  assert.equal(app.registry.get(mounted.provider.id), undefined);
  assert.ok(calls.includes('destroy-library'));
  assert.ok(library);
});

test('web bridge cleans failed initialization and disabled-library builds never mount a pretend service', async () => {
  let mounted = 0,
    destroyed = 0;
  const handlers = new Map();
  class App {
    constructor() {
      this.registry = createProviderRegistry();
      this.ownedProviders = [];
      this.bus = createEventBus();
    }
    async boot() {
      return true;
    }
    async destroy() {
      destroyed++;
    }
  }
  const windowRef = {
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: (name) => handlers.delete(name),
  };
  const documentRef = { body: {}, getElementById: () => null, querySelector: () => null };
  await bootWebApp({
    AppClass: App,
    documentRef,
    windowRef,
    collaborationLibrary: false,
    mountLibrary() {
      mounted++;
    },
  });
  assert.equal(mounted, 0);
  await assert.rejects(
    bootWebApp({
      AppClass: App,
      documentRef,
      windowRef,
      mountLibrary() {
        throw new Error('mount failed');
      },
    }),
    /mount failed/,
  );
  assert.equal(destroyed, 1);
});

function sourceButtonFixture() {
  const heading = { textContent: '系统声音' },
    description = { textContent: '' };
  const button = {
    disabled: true,
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    querySelector(selector) {
      return selector === 'strong' ? heading : selector === 'small' ? description : null;
    },
  };
  const panel = {
    children: [],
    append(node) {
      this.children.push(node);
    },
  };
  const documentRef = {
    getElementById(id) {
      return id === 'system-audio-button' ? button : id === 'source-dialog' ? panel : null;
    },
    createElement() {
      return {
        remove() {
          panel.children = panel.children.filter((node) => node !== this);
        },
      };
    },
  };
  return { button, panel, documentRef, heading, description };
}

test('secure browser capability enables shared sound with consent guidance without invoking a picker', () => {
  const fixture = sourceButtonFixture();
  let prompts = 0;
  const note = configureWebSystemAudioButton({
    documentRef: fixture.documentRef,
    windowRef: {
      isSecureContext: true,
      navigator: {
        mediaDevices: {
          getDisplayMedia() {
            prompts++;
          },
        },
      },
    },
    collaborationLibrary: true,
  });
  assert.equal(fixture.button.disabled, false);
  assert.equal(fixture.button.attributes['aria-disabled'], 'false');
  assert.equal(fixture.heading.textContent, '读取共享声音');
  assert.match(fixture.description.textContent, /标签页|屏幕/);
  assert.match(fixture.description.textContent, /共享音频/);
  assert.ok(note.textContent.includes('共享画面权限'));
  assert.ok(note.textContent.includes('不展示、保存或上传'));
  assert.ok(note.textContent.includes('Chrome／Edge'));
  assert.ok(note.textContent.includes('协作库音乐'));
  assert.equal(fixture.button.attributes['aria-describedby'], note.id);
  assert.equal(prompts, 0);
  note.remove();
  assert.equal(fixture.panel.children.length, 0);
});

test('an insecure page and an API-unavailable browser have honest disabled alternatives', () => {
  for (const [windowRef, expected] of [
    [{ isSecureContext: false, navigator: { mediaDevices: { getDisplayMedia() {} } } }, /HTTPS|localhost/],
    [
      { isSecureContext: true, navigator: { userAgent: 'Firefox', mediaDevices: {} } },
      /Chrome|Edge|本地音乐/,
    ],
    [{ isSecureContext: true, navigator: {} }, /Chrome|Edge|本地音乐/],
  ]) {
    const fixture = sourceButtonFixture();
    const guide = configureWebSystemAudioButton({
      documentRef: fixture.documentRef,
      windowRef,
      collaborationLibrary: false,
    });
    assert.equal(fixture.button.disabled, true);
    assert.equal(fixture.button.attributes['aria-disabled'], 'true');
    assert.match(fixture.description.textContent, expected);
    assert.equal(guide, null);
    assert.ok(!fixture.description.textContent.includes('DSP'));
    assert.equal(fixture.panel.children.length, 0);
  }
});

test('browser audio availability is feature-based and never advertised as guaranteed system-wide audio', () => {
  const fixture = sourceButtonFixture();
  configureWebSystemAudioButton({
    documentRef: fixture.documentRef,
    windowRef: {
      isSecureContext: true,
      navigator: { userAgent: 'Firefox', mediaDevices: { getDisplayMedia() {} } },
    },
    collaborationLibrary: false,
  });
  assert.equal(
    fixture.button.disabled,
    false,
    'A browser that gains the API can try sharing without a frozen UA block',
  );
  assert.equal(fixture.heading.textContent, '读取共享声音');
  assert.ok(fixture.panel.children[0].textContent.includes('没有“共享音频”选项'));
  assert.ok(!fixture.panel.children[0].textContent.includes('协作库音乐'));
});

test('an unavailable desktop bridge remains disabled even if the browser API is present', () => {
  const fixture = sourceButtonFixture();
  configureWebSystemAudioButton({
    documentRef: fixture.documentRef,
    windowRef: {
      desktop: { captureAvailable: false },
      isSecureContext: true,
      navigator: { mediaDevices: { getDisplayMedia() {} } },
    },
    collaborationLibrary: true,
  });
  assert.equal(fixture.button.disabled, true);
  assert.match(fixture.description.textContent, /桌面环境|本地音乐/);
  assert.equal(fixture.heading.textContent, '读取系统声音');
  assert.equal(fixture.panel.children.length, 0);
});
