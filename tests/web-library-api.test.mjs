import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleLibraryRequest, LIBRARY_LIMITS } from '../web/worker/library-api.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../web/drizzle/0001_library.sql', import.meta.url), 'utf8'));
  const files = new Map();
  const env = {
    LIBRARY_DB: {
      prepare(sql) {
        const statement = db.prepare(sql);
        let values = [];
        return {
          bind(...bound) {
            values = bound;
            return this;
          },
          async run() {
            const result = statement.run(...values);
            return { success: true, meta: { changes: Number(result.changes) } };
          },
          async all() {
            return { success: true, results: statement.all(...values) };
          },
          async first() {
            return statement.get(...values) || null;
          },
        };
      },
    },
    LIBRARY_FILES: {
      async put(key, input, options) {
        const bytes = new Uint8Array(await new Response(input).arrayBuffer());
        files.set(key, { bytes, options });
        return { size: bytes.length };
      },
      async delete(key) {
        files.delete(key);
      },
      async get(key, options) {
        const entry = files.get(key);
        if (!entry) return null;
        const range = options?.range;
        const bytes = range ? entry.bytes.slice(range.offset, range.offset + range.length) : entry.bytes;
        return { body: new Blob([bytes]).stream(), httpEtag: '"test"' };
      },
    },
  };
  return { db, files, env };
}
function request(path = '/api/library', { user = 'owner', method = 'GET', body, headers = {} } = {}) {
  const identity = user
    ? {
        'oai-authenticated-user-id': user,
        'oai-authenticated-user-full-name': encodeURIComponent('测试协作者'),
        'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
      }
    : {};
  return new Request(`https://private.example${path}`, {
    method,
    body,
    headers: { ...identity, ...headers },
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
}
function uploadRequest(name, bytes, kind = 'script', extra = {}) {
  return request(`/api/library?kind=${kind}`, {
    method: 'POST',
    body: bytes,
    headers: {
      'x-wad-library-request': '1',
      'x-file-name': encodeURIComponent(name),
      'x-file-size': String(bytes.byteLength),
      ...extra,
    },
  });
}
const textBytes = new TextEncoder().encode('节拍｜节拍是音乐的脉搏。');
const waveBytes = () => {
  const bytes = new Uint8Array(80);
  bytes.set(new TextEncoder().encode('RIFF'));
  bytes.set(new TextEncoder().encode('WAVE'), 8);
  return bytes;
};

test('library rejects anonymous and unavailable storage and ignores unrelated routes', async () => {
  const { env, db } = fixture();
  assert.equal((await handleLibraryRequest(request('/api/library', { user: null }), env)).status, 401);
  assert.equal((await handleLibraryRequest(request(), {})).status, 503);
  assert.equal(await handleLibraryRequest(request('/other'), env), null);
  db.close();
});

test('validated text saves original bytes in R2 and metadata in D1, visible to other authorized collaborators', async () => {
  const { env, db, files } = fixture();
  const response = await handleLibraryRequest(uploadRequest('节拍.txt', textBytes), env);
  assert.equal(response.status, 201);
  const { item } = await response.json();
  assert.equal(item.kind, 'script');
  assert.equal(item.uploader, '测试协作者');
  assert.equal(item.canDelete, true);
  assert.deepEqual([...files.values()][0].bytes, textBytes);
  const list = await (await handleLibraryRequest(request('/api/library', { user: 'invited' }), env)).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].canDelete, false);
  const download = await handleLibraryRequest(
    request(`/api/library/${item.id}/file`, { user: 'invited' }),
    env,
  );
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), textBytes);
  db.close();
});

test('server parses malformed structured documents independently and writes no objects on rejection', async () => {
  const { env, db, files } = fixture();
  const invalid = new TextEncoder().encode('{"schemaVersion":1,"lines":[]}');
  const response = await handleLibraryRequest(uploadRequest('bad.json', invalid), env);
  assert.equal(response.status, 422);
  assert.ok((await response.json()).error);
  assert.equal(files.size, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM library_files').get().count, 0);
  db.close();
});

test('same-origin write guard rejects cross-site forms and unauthenticated deletion', async () => {
  const { env, db } = fixture();
  assert.equal(
    (
      await handleLibraryRequest(
        uploadRequest('script.txt', textBytes, 'script', { origin: 'https://other.example' }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleLibraryRequest(
        uploadRequest('script.txt', textBytes, 'script', { 'x-wad-library-request': '' }),
        env,
      )
    ).status,
    400,
  );
  const { item } = await (await handleLibraryRequest(uploadRequest('script.txt', textBytes), env)).json();
  assert.equal(
    (
      await handleLibraryRequest(
        request(`/api/library/${item.id}`, {
          method: 'DELETE',
          user: 'invited',
          headers: { 'x-wad-library-request': '1' },
        }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleLibraryRequest(
        request(`/api/library/${item.id}`, { method: 'DELETE', headers: { 'x-wad-library-request': '1' } }),
        env,
      )
    ).status,
    200,
  );
  assert.equal((await handleLibraryRequest(request(`/api/library/${item.id}/file`), env)).status, 404);
  db.close();
});

test('music streams valid bytes, enforces declared length, rejects disguised non-audio, and supports byte ranges', async () => {
  const { env, db, files } = fixture();
  const bytes = waveBytes();
  const { item } = await (await handleLibraryRequest(uploadRequest('测试.wav', bytes, 'music'), env)).json();
  assert.equal(item.kind, 'music');
  assert.equal(files.size, 1);
  const range = await handleLibraryRequest(
    request(`/api/library/${item.id}/file`, { headers: { range: 'bytes=4-11' } }),
    env,
  );
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 4-11/80');
  assert.deepEqual(new Uint8Array(await range.arrayBuffer()), bytes.slice(4, 12));
  assert.equal(
    (
      await handleLibraryRequest(
        request(`/api/library/${item.id}/file`, { headers: { range: 'bytes=80-' } }),
        env,
      )
    ).status,
    416,
  );
  assert.equal(
    (
      await handleLibraryRequest(
        uploadRequest('fake.mp3', new TextEncoder().encode('<script>malicious</script>'), 'music'),
        env,
      )
    ).status,
    415,
  );
  assert.equal(
    (await handleLibraryRequest(uploadRequest('short.wav', bytes, 'music', { 'x-file-size': '100' }), env))
      .status,
    400,
  );
  assert.equal(
    (
      await handleLibraryRequest(
        uploadRequest('huge.wav', bytes, 'music', { 'x-file-size': String(LIBRARY_LIMITS.musicBytes + 1) }),
        env,
      )
    ).status,
    413,
  );
  assert.equal(files.size, 1, 'Rejected uploads cannot leave accessible files');
  db.close();
});

test('metadata failure rolls back uploaded R2 bytes and never returns a pretend success', async () => {
  const { env, db, files } = fixture();
  const original = env.LIBRARY_DB.prepare;
  env.LIBRARY_DB.prepare = (sql) => {
    if (sql.startsWith('INSERT')) throw new Error('D1 unavailable');
    return original(sql);
  };
  const response = await handleLibraryRequest(uploadRequest('fail.txt', textBytes), env);
  assert.equal(response.status, 503);
  assert.equal(files.size, 0);
  db.close();
});

test('chunked streams cannot bypass declared byte limits and a failed R2 write terminates the pipe', async () => {
  const { env, db, files } = fixture();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(waveBytes());
      controller.close();
    },
  });
  const oversized = request('/api/library?kind=music', {
    method: 'POST',
    body: stream,
    headers: { 'x-wad-library-request': '1', 'x-file-name': 'test.wav', 'x-file-size': '40' },
  });
  assert.equal((await handleLibraryRequest(oversized, env)).status, 413);
  assert.equal(files.size, 0);
  env.LIBRARY_FILES.put = () => {
    throw new Error('R2 refused write');
  };
  const failed = await handleLibraryRequest(uploadRequest('fail.wav', waveBytes(), 'music'), env);
  assert.equal(failed.status, 503);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM library_files').get().count, 0);
  db.close();
});

test('pagination preserves files with identical upload timestamps using the stable id tie-breaker', async () => {
  const { env, db } = fixture();
  const created = '2026-10-13T03:04:05.123Z';
  const statement = db.prepare('INSERT INTO library_files VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (let n = 0; n < 105; n++) {
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    statement.run(
      id,
      'owner',
      'Uploader',
      `${n}.txt`,
      'script',
      `${n}`,
      1,
      'text/plain',
      `library/${id}`,
      created,
    );
  }
  const first = await (await handleLibraryRequest(request(), env)).json();
  const second = await (
    await handleLibraryRequest(request(`/api/library?before=${encodeURIComponent(first.nextCursor)}`), env)
  ).json();
  assert.equal(first.items.length, 100);
  assert.equal(second.items.length, 5);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.items, ...second.items].map(({ id }) => id)).size, 105);
  db.close();
});

test('per-uploader quota is enforced by conditional D1 insertion with rollback', async () => {
  const { env, db, files } = fixture();
  const statement = db.prepare('INSERT INTO library_files VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (let n = 0; n < 200; n++)
    statement.run(
      `id${n}`,
      'owner',
      'Uploader',
      `${n}.txt`,
      'script',
      `${n}`,
      1,
      'text/plain',
      `library/id${n}`,
      '2026-10-13T03:04:05.123Z',
    );
  assert.equal((await handleLibraryRequest(uploadRequest('overflow.txt', textBytes), env)).status, 409);
  assert.equal(files.size, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM library_files').get().count, 200);
  db.close();
});
