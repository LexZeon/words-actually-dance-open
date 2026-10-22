import { parseScriptInput } from '../../src/content/script-document.js';
import {
  decodeScriptFile,
  scriptTitleFromFilename,
  MAX_SCRIPT_FILE_BYTES,
} from '../../src/content/script-file.js';

export const LIBRARY_LIMITS = Object.freeze({
  musicBytes: 64 * 1024 * 1024,
  scriptBytes: MAX_SCRIPT_FILE_BYTES,
});
const musicTypes = Object.freeze({
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  webm: 'audio/webm',
});
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
class LibraryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });

function identity(request) {
  const id = request.headers.get('oai-authenticated-user-id')?.trim();
  if (!id || id.length > 256) throw new LibraryError('请登录后访问协作库。', 401);
  let name = request.headers.get('oai-authenticated-user-full-name') || '';
  if (request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') {
    try {
      name = decodeURIComponent(name);
    } catch {
      name = '';
    }
  }
  return {
    id,
    name: (name || request.headers.get('oai-authenticated-user-email') || '协作者').slice(0, 160),
  };
}

function assertSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new LibraryError('请在本网站内操作协作库。', 403);
  if (request.headers.get('x-wad-library-request') !== '1') throw new LibraryError('请求格式不正确。', 400);
}

function fileInfo(request, kind) {
  if (kind !== 'music' && kind !== 'script') throw new LibraryError('请选择音乐或文案。');
  let name;
  try {
    name = decodeURIComponent(request.headers.get('x-file-name') || '');
  } catch {
    throw new LibraryError('文件名无法读取。');
  }
  if (!name || name.length > 180 || /[\x00-\x1f/\\]/u.test(name))
    throw new LibraryError('文件名不正确或过长。');
  const extension = name.split('.').at(-1).toLowerCase();
  if (kind === 'script' && !['json', 'txt'].includes(extension))
    throw new LibraryError('文案支持 TXT 或 JSON。', 415);
  if (kind === 'music' && !musicTypes[extension]) throw new LibraryError('请选择支持的本地音乐文件。', 415);
  const size = Number(request.headers.get('x-file-size'));
  const maximum = kind === 'music' ? LIBRARY_LIMITS.musicBytes : LIBRARY_LIMITS.scriptBytes;
  if (!Number.isSafeInteger(size) || size < 1 || size > maximum)
    throw new LibraryError(
      kind === 'music' ? '音乐文件需在 64 MB 以内。' : '文案文件需在 512 KB 以内。',
      413,
    );
  const length = request.headers.get('content-length');
  if (length && Number(length) !== size) throw new LibraryError('文件长度不一致，请重新上传。');
  if (!request.body) throw new LibraryError('文件内容为空。');
  return {
    name,
    size,
    extension,
    type: kind === 'music' ? musicTypes[extension] : extension === 'json' ? 'application/json' : 'text/plain',
  };
}

function musicSignature(bytes, extension) {
  const ascii = (start, end) => new TextDecoder().decode(bytes.subarray(start, end));
  if (extension === 'mp3') return ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (extension === 'aac') return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  if (extension === 'wav') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
  if (extension === 'ogg' || extension === 'opus') return ascii(0, 4) === 'OggS';
  if (extension === 'flac') return ascii(0, 4) === 'fLaC';
  if (extension === 'm4a') return ascii(4, 8) === 'ftyp';
  if (extension === 'aif' || extension === 'aiff')
    return ascii(0, 4) === 'FORM' && ['AIFF', 'AIFC'].includes(ascii(8, 12));
  return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

async function readBounded(body, size) {
  const reader = body.getReader();
  const parts = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > size) throw new LibraryError('文件长度超过声明，请重新上传。', 413);
      parts.push(value);
    }
    if (length !== size) throw new LibraryError('文件未完整上传，请重试。');
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

/** FixedLengthStream preserves known length for R2 while checking every received byte. */
async function streamMusic(body, bucket, key, info) {
  let received = 0,
    prefix = new Uint8Array(0),
    verified = false;
  const checked = body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > info.size) throw new LibraryError('音乐超过声明的文件长度。', 413);
        if (!verified) {
          const next = new Uint8Array(Math.min(32, prefix.length + chunk.length));
          next.set(prefix);
          next.set(chunk.subarray(0, next.length - prefix.length), prefix.length);
          prefix = next;
          if (prefix.length >= Math.min(32, info.size)) {
            if (!musicSignature(prefix, info.extension))
              throw new LibraryError('文件内容不符合音乐格式。', 415);
            verified = true;
          }
        }
        controller.enqueue(chunk);
      },
      flush() {
        if (received !== info.size) throw new LibraryError('音乐未完整上传，请重试。');
        if (!verified) throw new LibraryError('无法读取音乐文件。', 415);
      },
    }),
  );
  const fixed =
    typeof FixedLengthStream === 'function' ? new FixedLengthStream(info.size) : new TransformStream();
  const abort = new AbortController();
  const pumping = checked.pipeTo(fixed.writable, { signal: abort.signal });
  const storing = Promise.resolve().then(() =>
    bucket.put(key, fixed.readable, { httpMetadata: { contentType: info.type } }),
  );
  try {
    const [, saved] = await Promise.all([pumping, storing]);
    if (!saved || saved.size !== info.size) throw new LibraryError('音乐未完整保存，请重试。', 503);
  } catch (error) {
    abort.abort();
    // A rejected put may never have acquired the readable side. Cancel it too
    // so pipeTo cannot wait forever on an unconsumed backpressured write.
    await fixed.readable.cancel(error).catch(() => {});
    await Promise.allSettled([pumping, storing]);
    throw error;
  }
}

function itemFor(row, user) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    title: row.title,
    size: row.size,
    type: row.content_type,
    uploader: row.uploader,
    createdAt: row.created_at,
    canDelete: row.owner_id === user.id,
  };
}
const columns = 'id, name, kind, title, size, content_type, uploader, created_at, owner_id, object_key';

async function upload(request, env, user, url) {
  assertSameOrigin(request);
  const kind = url.searchParams.get('kind');
  const info = fileInfo(request, kind);
  const id = crypto.randomUUID(),
    key = `library/${id}`,
    createdAt = new Date().toISOString();
  let title = info.name;
  try {
    if (kind === 'script') {
      const bytes = await readBounded(request.body, info.size);
      let topic;
      try {
        topic = parseScriptInput(decodeScriptFile(bytes), scriptTitleFromFilename(info.name));
      } catch (error) {
        throw new LibraryError(error.message, 422);
      }
      title = topic.title;
      const saved = await env.LIBRARY_FILES.put(key, bytes, {
        httpMetadata: { contentType: info.type },
      });
      if (!saved || saved.size !== info.size) throw new LibraryError('文案未完整保存，请重试。', 503);
    } else await streamMusic(request.body, env.LIBRARY_FILES, key, info);
    const saved = await env.LIBRARY_DB.prepare(
      'INSERT INTO library_files (id, owner_id, uploader, name, kind, title, size, content_type, object_key, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM library_files WHERE owner_id = ?) < 200 AND (SELECT COALESCE(SUM(size), 0) FROM library_files WHERE owner_id = ?) + ? <= 1073741824',
    )
      .bind(
        id,
        user.id,
        user.name,
        info.name,
        kind,
        title,
        info.size,
        info.type,
        key,
        createdAt,
        user.id,
        user.id,
        info.size,
      )
      .run();
    if (!saved.success || saved.meta?.changes !== 1)
      throw new LibraryError('当前账户的协作库已达到容量上限，请先删除部分文件。', 409);
    return json(
      {
        item: itemFor(
          {
            id,
            owner_id: user.id,
            uploader: user.name,
            name: info.name,
            kind,
            title,
            size: info.size,
            content_type: info.type,
            created_at: createdAt,
          },
          user,
        ),
      },
      201,
    );
  } catch (error) {
    await env.LIBRARY_FILES.delete(key).catch(() => {});
    throw error;
  }
}

function byteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (!match || (!match[1] && !match[2])) throw new LibraryError('文件范围不正确。', 416);
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
    throw new LibraryError('文件范围超出大小。', 416);
  return { offset: start, length: end - start + 1 };
}

/** Sites dispatch supplies trusted identity; this module adds per-operation authorization. */
export async function handleLibraryRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/library' && !url.pathname.startsWith('/api/library/')) return null;
  try {
    const user = identity(request);
    if (!env.LIBRARY_DB || !env.LIBRARY_FILES)
      throw new LibraryError('协作库存储暂未就绪，请稍后重试。', 503);
    if (url.pathname === '/api/library') {
      if (request.method === 'GET') {
        const before = url.searchParams.get('before');
        const [date, cursorId] = before ? before.split('~') : ['9999', 'zzzz'];
        if (
          before &&
          (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(date) || !uuidPattern.test(cursorId))
        )
          throw new LibraryError('分页参数不正确。');
        const result = await env.LIBRARY_DB.prepare(
          `SELECT ${columns} FROM library_files WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC, id DESC LIMIT 101`,
        )
          .bind(date, date, cursorId)
          .all();
        if (!result.success) throw new Error('Library list failed');
        const rows = result.results || [];
        return json({
          items: rows.slice(0, 100).map((row) => itemFor(row, user)),
          nextCursor: rows.length > 100 ? `${rows[99].created_at}~${rows[99].id}` : null,
          limits: LIBRARY_LIMITS,
        });
      }
      if (request.method === 'POST') return await upload(request, env, user, url);
      return json({ error: '不支持此操作。' }, 405);
    }
    const match = /^\/api\/library\/([^/]+)(\/file)?$/u.exec(url.pathname);
    if (!match || !uuidPattern.test(match[1])) throw new LibraryError('文件不存在。', 404);
    const row = await env.LIBRARY_DB.prepare(`SELECT ${columns} FROM library_files WHERE id = ?`)
      .bind(match[1])
      .first();
    if (!row) throw new LibraryError('文件不存在或已删除。', 404);
    if (match[2] && ['GET', 'HEAD'].includes(request.method)) {
      const range = byteRange(request.headers.get('range'), row.size);
      const object = await env.LIBRARY_FILES.get(row.object_key, range ? { range } : undefined);
      if (!object) throw new LibraryError('文件暂时无法读取。', 404);
      const headers = new Headers({
        'content-type': row.content_type,
        'content-length': String(range?.length ?? row.size),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'accept-ranges': 'bytes',
        'content-disposition': `attachment; filename="file.${row.name.split('.').at(-1)}"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      });
      if (object.httpEtag) headers.set('etag', object.httpEtag);
      if (range)
        headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${row.size}`);
      if (request.method === 'HEAD') await object.body?.cancel?.();
      return new Response(request.method === 'HEAD' ? null : object.body, {
        status: range ? 206 : 200,
        headers,
      });
    }
    if (!match[2] && request.method === 'DELETE') {
      assertSameOrigin(request);
      if (row.owner_id !== user.id) throw new LibraryError('只能删除自己上传的文件。', 403);
      await env.LIBRARY_FILES.delete(row.object_key);
      const removed = await env.LIBRARY_DB.prepare('DELETE FROM library_files WHERE id = ? AND owner_id = ?')
        .bind(row.id, user.id)
        .run();
      if (!removed.success) throw new Error('Library delete failed');
      return json({ deleted: row.id });
    }
    return json({ error: '不支持此操作。' }, 405);
  } catch (error) {
    return json(
      { error: error instanceof LibraryError ? error.message : '协作库操作未完成，请稍后重试。' },
      error instanceof LibraryError ? error.status : 503,
    );
  }
}
