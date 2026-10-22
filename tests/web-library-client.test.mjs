import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadLibraryFile, validateLibraryUpload, mountWebLibrary } from '../web/web-library-client.js';

class XHR {
  static instances = [];
  constructor() {
    this.upload = {};
    this.headers = {};
    XHR.instances.push(this);
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name, value) {
    this.headers[name] = value;
  }
  send(file) {
    this.file = file;
  }
  abort() {
    this.onabort();
  }
  complete(status, value) {
    this.status = status;
    this.responseText = typeof value === 'string' ? value : JSON.stringify(value);
    this.onload();
  }
}
const textFile = () => new File(['词｜词组成句子。'], '词.txt', { type: 'text/plain' });

test('client independently validates local script and limits before any upload request', async () => {
  await validateLibraryUpload(textFile(), 'script');
  await assert.rejects(validateLibraryUpload(new File(['{}'], 'bad.json'), 'script'), /schemaVersion/);
  await assert.rejects(validateLibraryUpload(new File([], 'empty.txt'), 'script'), /非空/);
  await assert.rejects(
    validateLibraryUpload({ size: 64 * 1024 * 1024 + 1, name: 'huge.mp3' }, 'music'),
    /64 MB/,
  );
  await assert.rejects(validateLibraryUpload(new File(['html'], 'fake.html'), 'music'), /格式/);
});

test('100 percent transport progress does not resolve until the server confirms a saved item', async () => {
  const progress = [];
  let completed = false;
  const uploading = uploadLibraryFile(textFile(), 'script', {
    onProgress: (percent) => progress.push(percent),
    XMLHttpRequestClass: XHR,
  }).then((item) => {
    completed = true;
    return item;
  });
  const xhr = XHR.instances.at(-1);
  xhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
  xhr.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.deepEqual(progress, [50, 100]);
  assert.equal(xhr.headers['x-file-name'], encodeURIComponent('词.txt'));
  assert.equal(xhr.headers['x-wad-library-request'], '1');
  xhr.complete(201, { item: { id: 'saved' } });
  assert.equal((await uploading).id, 'saved');
});

test('server errors and authentication HTML reject instead of pretending a successful upload', async () => {
  const failed = uploadLibraryFile(textFile(), 'script', { XMLHttpRequestClass: XHR });
  XHR.instances.at(-1).complete(422, { error: '文案未通过验证。' });
  await assert.rejects(failed, /验证/);
  const redirected = uploadLibraryFile(textFile(), 'script', { XMLHttpRequestClass: XHR });
  XHR.instances.at(-1).complete(200, '<html>Login</html>');
  await assert.rejects(redirected, /重新登录/);
});

test('cancel aborts the in-flight XHR and a pre-aborted signal sends no request', async () => {
  const abort = new AbortController();
  const uploading = uploadLibraryFile(textFile(), 'script', {
    signal: abort.signal,
    XMLHttpRequestClass: XHR,
  });
  abort.abort();
  await assert.rejects(uploading, { name: 'AbortError' });
  const count = XHR.instances.length;
  await assert.rejects(
    uploadLibraryFile(textFile(), 'script', { signal: abort.signal, XMLHttpRequestClass: XHR }),
    { name: 'AbortError' },
  );
  assert.equal(XHR.instances.length, count);
});

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = new Map();
    this.attributes = {};
    this.content = '';
  }
  set textContent(value) {
    this.content = String(value);
    this.children = [];
  }
  get textContent() {
    return this.content + this.children.map((child) => child.textContent).join('');
  }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      this.children.push(node);
      node.parent = this;
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  addEventListener(name, fn) {
    const entries = this.listeners.get(name) || new Set();
    entries.add(fn);
    this.listeners.set(name, entries);
  }
  removeEventListener(name, fn) {
    this.listeners.get(name)?.delete(fn);
  }
  querySelectorAll(tag) {
    return this.children.flatMap((child) => [
      ...(child.tag === tag ? [child] : []),
      ...child.querySelectorAll(tag),
    ]);
  }
  click() {
    return Promise.all([...(this.listeners.get('click') || [])].map((fn) => fn()));
  }
  focus() {}
}
function dom() {
  const container = new Element('div');
  const documentRef = { createElement: (tag) => new Element(tag) };
  return { container, documentRef };
}
const item = {
  id: '00000000-0000-4000-8000-000000000001',
  name: '词.txt',
  title: '<img src=x>',
  kind: 'script',
  type: 'text/plain',
  size: textFile().size,
  uploader: '协作者',
  createdAt: '2026-10-13T03:04:05.123Z',
  canDelete: false,
};
const jsonResponse = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('temporary library selects through controlled callbacks and treats file names as text, with shared files read-only', async () => {
  const { container, documentRef } = dom();
  const selected = [];
  const calls = [];
  const library = mountWebLibrary({
    container,
    documentRef,
    onSelectMusic: () => {},
    onSelectScript: async (file, record) => selected.push({ text: await file.text(), record }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return url.endsWith('/file')
        ? new Response(await textFile().arrayBuffer())
        : jsonResponse({ items: [item], nextCursor: null });
    },
  });
  await library.reload();
  assert.ok(container.textContent.includes('<img src=x>'));
  assert.equal(container.querySelectorAll('img').length, 0);
  assert.equal(
    container.querySelectorAll('button').filter((button) => button.textContent === '删除').length,
    0,
  );
  await container
    .querySelectorAll('button')
    .find((button) => button.textContent === '载入')
    .click();
  assert.equal(selected.length, 1);
  assert.equal(selected[0].text, '词｜词组成句子。');
  assert.equal(selected[0].record.id, item.id);
  assert.ok(
    calls.every(({ options }) => options.credentials === 'same-origin' && options.cache === 'no-store'),
  );
  library.destroy();
  assert.equal(container.children.length, 0);
  library.destroy();
});

test('callback failure remains visible and does not announce a successfully loaded script', async () => {
  const { container, documentRef } = dom();
  const library = mountWebLibrary({
    container,
    documentRef,
    onSelectMusic: () => {},
    onSelectScript: () => {
      throw new Error('播放器尚未就绪。');
    },
    fetchImpl: async (url) =>
      url.endsWith('/file')
        ? new Response(await textFile().arrayBuffer())
        : jsonResponse({ items: [item], nextCursor: null }),
  });
  await library.reload();
  await container
    .querySelectorAll('button')
    .find((button) => button.textContent === '载入')
    .click();
  assert.ok(container.textContent.includes('播放器尚未就绪。'));
  assert.ok(!container.textContent.includes('已载入文案'));
  assert.equal(library.getState().busy, false);
  library.destroy();
});

test('destroy cancels the current list request and ignores a late response', async () => {
  const { container, documentRef } = dom();
  let finish, signal;
  const library = mountWebLibrary({
    container,
    documentRef,
    onSelectMusic: () => {},
    onSelectScript: () => {},
    fetchImpl: (_url, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const pending = library.reload();
  library.destroy();
  assert.equal(signal.aborted, true);
  finish(jsonResponse({ items: [item], nextCursor: null }));
  await pending;
  assert.equal(container.children.length, 0);
  assert.equal(library.getState().items, 0);
});

test('authentication redirect HTML is surfaced without breaking the list UI', async () => {
  const { container, documentRef } = dom();
  const library = mountWebLibrary({
    container,
    documentRef,
    onSelectMusic: () => {},
    onSelectScript: () => {},
    fetchImpl: async () => new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } }),
  });
  await library.reload();
  assert.ok(container.textContent.includes('请登录'));
  assert.equal(library.getState().busy, false);
  library.destroy();
});

function intentGate() {
  let current = null;
  return {
    reserve() {
      current?.cancel();
      const abort = new AbortController();
      const token = {
        signal: abort.signal,
        isCurrent: () => current === token && !abort.signal.aborted,
        cancel: () => abort.abort(),
      };
      current = token;
      return token;
    },
    supersede() {
      current?.cancel();
      current = null;
    },
  };
}

test('a newer local intent aborts a cloud download and a late ignored-abort response cannot reach the app', async () => {
  const { container, documentRef } = dom(),
    gate = intentGate();
  let finish,
    downloadSignal,
    selections = 0;
  const library = mountWebLibrary({
    container,
    documentRef,
    beginSelection: () => gate.reserve(),
    onSelectMusic: () => {},
    onSelectScript: () => {
      selections++;
    },
    fetchImpl: async (url, options) => {
      if (!url.endsWith('/file')) return jsonResponse({ items: [item], nextCursor: null });
      downloadSignal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  await library.reload();
  const pending = container
    .querySelectorAll('button')
    .find((button) => button.textContent === '载入')
    .click();
  assert.equal(library.getState().busy, true);
  gate.supersede();
  assert.equal(downloadSignal.aborted, true);
  assert.equal(library.getState().busy, false);
  finish(new Response(await textFile().arrayBuffer()));
  await pending;
  assert.equal(selections, 0);
  assert.ok(!container.textContent.includes('已载入文案'));
  library.destroy();
});

test('closing or escaping the library cancels pending music and script intents before cloud files can overwrite local choices', async () => {
  for (const mode of ['close', 'escape']) {
    const { container, documentRef } = dom(),
      gate = intentGate();
    let finish,
      token,
      imported = 0;
    const music = { ...item, kind: 'music', name: 'sample.mp3', type: 'audio/mpeg' };
    const library = mountWebLibrary({
      container,
      documentRef,
      beginSelection: () => (token = gate.reserve()),
      onSelectMusic: () => {
        imported++;
      },
      onSelectScript: () => {
        imported++;
      },
      fetchImpl: async (url) => {
        if (!url.endsWith('/file'))
          return jsonResponse({ items: [mode === 'escape' ? music : item], nextCursor: null });
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
    await library.reload();
    const pending = container
      .querySelectorAll('button')
      .find((button) => ['载入', '播放'].includes(button.textContent))
      .click();
    await Promise.resolve();
    if (mode === 'close')
      await container
        .querySelectorAll('button')
        .find((button) => button.textContent === '收起')
        .click();
    else for (const listener of container.querySelectorAll('dialog')[0].listeners.get('cancel')) listener();
    assert.equal(token.signal.aborted, true);
    finish(new Response(await textFile().arrayBuffer()));
    await pending;
    assert.equal(imported, 0);
    assert.equal(library.getState().busy, false);
    library.destroy();
  }
});

test('an old canceled selection cannot unlock or announce success over a newer cloud selection', async () => {
  const { container, documentRef } = dom(),
    gate = intentGate();
  let finishOld, finishNewImport;
  const newer = { ...item, id: '00000000-0000-4000-8000-000000000002', name: 'newer.txt', title: '新的知识' };
  const selected = [];
  const library = mountWebLibrary({
    container,
    documentRef,
    beginSelection: () => gate.reserve(),
    onSelectMusic: () => {},
    onSelectScript: async (_file, record, intent) => {
      assert.equal(intent.isCurrent(), true);
      selected.push(record.id);
      await new Promise((resolve) => {
        finishNewImport = resolve;
      });
      return true;
    },
    fetchImpl: async (url) => {
      if (!url.endsWith('/file')) return jsonResponse({ items: [item, newer], nextCursor: null });
      if (url.includes(item.id))
        return new Promise((resolve) => {
          finishOld = resolve;
        });
      return new Response(await textFile().arrayBuffer());
    },
  });
  await library.reload();
  const buttons = container.querySelectorAll('button').filter((button) => button.textContent === '载入');
  const oldPending = buttons[0].click();
  await container
    .querySelectorAll('button')
    .find((button) => button.textContent === '收起')
    .click();
  const newPending = buttons[1].click();
  while (!finishNewImport) await new Promise((resolve) => setImmediate(resolve));
  finishOld(new Response(await textFile().arrayBuffer()));
  await oldPending;
  assert.equal(library.getState().busy, true, 'The stale operation cannot unlock the newer import');
  assert.deepEqual(selected, [newer.id]);
  finishNewImport();
  await newPending;
  assert.equal(library.getState().busy, false);
  assert.ok(container.textContent.includes('已载入文案“新的知识”'));
  library.destroy();
});

test('a guarded application import returning false never produces a successful load announcement', async () => {
  const { container, documentRef } = dom();
  const library = mountWebLibrary({
    container,
    documentRef,
    onSelectMusic: () => {},
    onSelectScript: () => false,
    fetchImpl: async (url) =>
      url.endsWith('/file')
        ? new Response(await textFile().arrayBuffer())
        : jsonResponse({ items: [item], nextCursor: null }),
  });
  await library.reload();
  await container
    .querySelectorAll('button')
    .find((button) => button.textContent === '载入')
    .click();
  assert.ok(container.textContent.includes('该次载入已取消'));
  assert.ok(!container.textContent.includes('已载入文案'));
  library.destroy();
});
