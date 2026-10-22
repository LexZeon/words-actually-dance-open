import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';

export async function createSitePreview({ projectRoot, port = 4318 } = {}) {
  const source = await fs.readFile(path.join(projectRoot, 'dist/server/index.js'), 'utf8');
  const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`))
    .default;
  const config = JSON.parse(await fs.readFile(path.join(projectRoot, 'web/site-config.json'), 'utf8'));
  const db = new DatabaseSync(':memory:');
  if (config.collaborationLibrary)
    db.exec(await fs.readFile(path.join(projectRoot, 'drizzle/0001_library.sql'), 'utf8'));
  const objects = new Map();
  const env = {
    LIBRARY_DB: {
      prepare(sql) {
        const statement = db.prepare(sql);
        let args = [];
        return {
          bind(...values) {
            args = values;
            return this;
          },
          async run() {
            const result = statement.run(...args);
            return { success: true, meta: { changes: Number(result.changes) } };
          },
          async all() {
            return { success: true, results: statement.all(...args) };
          },
          async first() {
            return statement.get(...args) || null;
          },
        };
      },
    },
    LIBRARY_FILES: {
      async put(key, input) {
        const bytes = new Uint8Array(await new Response(input).arrayBuffer());
        objects.set(key, bytes);
        return { size: bytes.length };
      },
      async get(key, options) {
        const bytes = objects.get(key);
        if (!bytes) return null;
        const range = options?.range;
        return {
          body: new Blob([range ? bytes.slice(range.offset, range.offset + range.length) : bytes]).stream(),
        };
      },
      async delete(key) {
        objects.delete(key);
      },
    },
  };
  const server = http.createServer(async (request, response) => {
    try {
      // Loopback-only preview identity is injected by the dev server. It is
      // absent from production Worker source and never reaches hosted storage.
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers))
        if (value !== undefined && !name.startsWith('oai-authenticated-user-'))
          headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      headers.set('oai-authenticated-user-id', 'local-preview-only');
      headers.set('oai-authenticated-user-full-name', encodeURIComponent('本地预览（临时数据）'));
      headers.set('oai-authenticated-user-full-name-encoding', 'percent-encoded-utf-8');
      const method = request.method || 'GET';
      const body = ['GET', 'HEAD'].includes(method) ? undefined : Readable.toWeb(request);
      const output = await worker.fetch(
        new Request(`http://127.0.0.1:${server.address().port}${request.url}`, {
          method,
          headers,
          body,
          ...(body ? { duplex: 'half' } : {}),
        }),
        env,
      );
      response.writeHead(output.status, Object.fromEntries(output.headers));
      if (output.body) Readable.fromWeb(output.body).pipe(response);
      else response.end();
    } catch {
      response.writeHead(500);
      response.end('Local preview request failed');
    }
  });
  server.on('close', () => {
    db.close();
    objects.clear();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const { server, url } = await createSitePreview({ projectRoot });
  console.log(`本地网页预览（模拟身份、内存协作库，关闭后清空，未写入云端）：${url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
