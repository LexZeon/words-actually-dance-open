import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRegistry, getExtensionStatus } from '../src/core/contracts.js';
import { createEventBus, EVENTS } from '../src/core/events.js';
import { createWebLibraryProvider, registerWebLibraryProvider } from '../web/web-library-provider.js';

const file = () => new File(['词｜词组成句子。'], '词.txt', { type: 'text/plain' });
const item = () => ({
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'script',
  name: '词.txt',
  title: '词',
  type: 'text/plain',
  size: file().size,
  uploader: '协作者',
  createdAt: '2026-10-13T03:04:05.123Z',
  canDelete: true,
});
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise(setImmediate);
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
  send(value) {
    this.file = value;
  }
  abort() {
    this.onabort?.();
  }
  finish(value, status = 201) {
    this.responseText = JSON.stringify(value);
    this.status = status;
    this.onload?.();
  }
}

test('the temporary provider registers only four actual file capabilities and releases its own registry entry', () => {
  const registry = createProviderRegistry(),
    bus = createEventBus(),
    changes = [];
  bus.on(EVENTS.PROVIDER_CHANGED, (event) => changes.push(event));
  const lease = registerWebLibraryProvider({
    registry,
    eventBus: bus,
    fetchImpl: async () => json({ items: [], nextCursor: null }),
  });
  assert.equal(registry.get(lease.provider.id), lease.provider);
  assert.deepEqual([...lease.provider.capabilities].sort(), [
    'downloadFile',
    'listFiles',
    'removeFile',
    'uploadFile',
  ]);
  const status = getExtensionStatus(registry);
  assert.ok(
    status
      .filter((row) => ['listFiles', 'uploadFile', 'downloadFile', 'removeFile'].includes(row.method))
      .every((row) => row.available),
  );
  assert.ok(
    status
      .filter((row) => ['save', 'like', 'download', 'signIn', 'sync'].includes(row.method))
      .every((row) => !row.available),
  );
  assert.equal(lease.dispose(), true);
  assert.equal(lease.dispose(), false);
  assert.equal(registry.get(lease.provider.id), undefined);
  assert.deepEqual(
    changes.map((row) => row.action),
    ['registered', 'unregistered'],
  );
});

test('an old provider cleanup cannot unregister a replacement and disposed operations cannot reconnect', async () => {
  const registry = createProviderRegistry(),
    fetchImpl = async () => json({ items: [], nextCursor: null });
  const old = registerWebLibraryProvider({ registry, fetchImpl });
  registry.unregister(old.provider.id);
  const replacement = registerWebLibraryProvider({ registry, fetchImpl });
  assert.equal(old.dispose(), false);
  assert.equal(registry.get(replacement.provider.id), replacement.provider);
  await assert.rejects(old.provider.methods.listFiles(), { name: 'AbortError' });
  assert.deepEqual((await replacement.provider.methods.listFiles()).items, []);
  replacement.dispose();
});

test('provider list/download/delete use the same-origin API, validate metadata and publish confirmed standard events', async () => {
  const bus = createEventBus(),
    events = [],
    calls = [];
  const record = item();
  bus.on(EVENTS.COLLABORATION_FILE_DOWNLOADED, (event) => events.push(['download', event]));
  bus.on(EVENTS.COLLABORATION_FILES_CHANGED, (event) => events.push(['change', event]));
  const provider = createWebLibraryProvider({
    eventBus: bus,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'DELETE') return json({ deleted: record.id });
      if (url.endsWith('/file'))
        return new Response(await file().arrayBuffer(), {
          headers: { 'content-type': 'text/plain', 'content-length': String(record.size) },
        });
      return json({ items: [record], nextCursor: null });
    },
  });
  const list = await provider.methods.listFiles({ cursor: 'cursor~id' });
  assert.equal(list.items[0].id, record.id);
  const downloaded = await provider.methods.downloadFile(record);
  assert.equal(await downloaded.text(), await file().text());
  assert.equal((await provider.methods.removeFile(record.id)).deleted, record.id);
  assert.ok(
    calls.every(({ options }) => options.credentials === 'same-origin' && options.cache === 'no-store'),
  );
  assert.equal(calls.at(-1).options.headers['x-wad-library-request'], '1');
  assert.ok(calls.every(({ options }) => !options.headers?.['oai-authenticated-user-id']));
  assert.deepEqual(
    events.map((row) => row[0]),
    ['download', 'change'],
  );
  assert.equal(events[1][1].reason, 'remove');
  assert.ok(!JSON.stringify(events).includes('组成'));
  provider.dispose();
});

test('upload progress never announces storage before a complete matching server record is returned', async () => {
  const bus = createEventBus(),
    events = [],
    progress = [];
  bus.on(EVENTS.COLLABORATION_FILES_CHANGED, (event) => events.push(event));
  const provider = createWebLibraryProvider({ eventBus: bus, XMLHttpRequestClass: XHR });
  const uploading = provider.methods.uploadFile(file(), {
    kind: 'script',
    onProgress: (value) => progress.push(value),
  });
  await flush();
  const xhr = XHR.instances.at(-1);
  xhr.upload.onprogress({ lengthComputable: true, loaded: 24, total: 24 });
  assert.deepEqual(progress, [100]);
  assert.equal(events.length, 0);
  xhr.finish({ item: item() });
  assert.equal((await uploading).id, item().id);
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, 'upload');
  const mismatched = provider.methods.uploadFile(file(), { kind: 'script' });
  await flush();
  XHR.instances.at(-1).finish({ item: { ...item(), size: 1 } });
  await assert.rejects(mismatched, /未确认/);
  assert.equal(events.length, 1);
  provider.dispose();
});

test('provider disposal aborts every pending upload/read and ignores late network responses', async () => {
  const bus = createEventBus(),
    events = [];
  bus.on(EVENTS.COLLABORATION_FILES_CHANGED, (event) => events.push(event));
  let resolve, signal;
  const provider = createWebLibraryProvider({
    eventBus: bus,
    XMLHttpRequestClass: XHR,
    fetchImpl: (_url, options) => {
      signal = options.signal;
      return new Promise((done) => (resolve = done));
    },
  });
  const reading = provider.methods.listFiles();
  const uploading = provider.methods.uploadFile(file(), { kind: 'script' });
  const readRejected = assert.rejects(reading, { name: 'AbortError' }),
    uploadRejected = assert.rejects(uploading, { name: 'AbortError' });
  await flush();
  provider.dispose();
  assert.equal(signal.aborted, true);
  resolve(json({ items: [item()], nextCursor: null }));
  await Promise.all([readRejected, uploadRejected]);
  assert.equal(events.length, 0);
});

test('file downloads enforce actual stored size, handle encoded transfer lengths, and reject login HTML', async () => {
  const record = item(),
    bytes = await file().arrayBuffer();
  const compressed = createWebLibraryProvider({
    fetchImpl: async () =>
      new Response(bytes, { headers: { 'content-encoding': 'gzip', 'content-length': '10' } }),
  });
  assert.equal((await compressed.methods.downloadFile(record)).size, record.size);
  compressed.dispose();
  for (const response of [
    new Response(bytes.slice(0, 3)),
    new Response(new Uint8Array(record.size + 1)),
    new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } }),
  ]) {
    const provider = createWebLibraryProvider({ fetchImpl: async () => response });
    await assert.rejects(provider.methods.downloadFile(record), /未完整|超过|请登录/);
    provider.dispose();
  }
});

test('canceling a stalled download closes its body reader without publishing a completed download', async () => {
  let canceled = false;
  const bus = createEventBus(),
    events = [];
  bus.on(EVENTS.COLLABORATION_FILE_DOWNLOADED, (event) => events.push(event));
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array([1, 2, 3]));
    },
    cancel() {
      canceled = true;
    },
  });
  const provider = createWebLibraryProvider({ eventBus: bus, fetchImpl: async () => new Response(body) }),
    abort = new AbortController();
  const downloading = provider.methods.downloadFile(item(), { signal: abort.signal });
  const rejection = assert.rejects(downloading, { name: 'AbortError' });
  await flush();
  abort.abort();
  await rejection;
  assert.equal(canceled, true);
  assert.equal(events.length, 0);
  provider.dispose();
});

test('authentication failures and malformed list records cannot appear as a connected successful read', async () => {
  for (const response of [
    new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } }),
    json({ error: '请登录。' }, 401),
    json({ items: [{ ...item(), id: '../other' }] }),
  ]) {
    const provider = createWebLibraryProvider({ fetchImpl: async () => response });
    await assert.rejects(provider.methods.listFiles(), /登录|无法读取/);
    provider.dispose();
  }
});
