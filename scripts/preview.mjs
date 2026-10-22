import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

export async function createPreviewServer(directory) {
  const root = await fs.realpath(directory);
  function withinRoot(file) {
    const relative = path.relative(root, file);
    return (
      relative === '' ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    );
  }

  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1:4317').pathname);
      if (pathname === '/') pathname = '/index.html';
      const requested = path.resolve(root, '.' + pathname);
      if (pathname.includes('\0') || pathname.includes('\\') || !withinRoot(requested)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      const real = await fs.realpath(requested);
      if (!withinRoot(real)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      const stat = await fs.stat(real);
      if (!stat.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });
      const body = request.method === 'HEAD' ? undefined : await fs.readFile(real);
      response.writeHead(200, {
        'Content-Type': mime[path.extname(real).toLowerCase()] || 'application/octet-stream',
        'Content-Length': body?.byteLength ?? stat.size,
      });
      response.end(body);
    } catch (error) {
      response.writeHead(error instanceof URIError ? 400 : 404);
      response.end(error instanceof URIError ? 'Bad request' : 'Not found');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const server = await createPreviewServer(root);
  server.on('error', (error) => {
    console.error(`无法启动本地预览：${error.message}`);
    process.exitCode = 1;
  });
  server.listen(4317, '127.0.0.1', () => console.log('文字实验预览：http://127.0.0.1:4317'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
