import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createPreviewServer } from '../scripts/preview.mjs';

function request(port, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const call = http.request({ hostname: '127.0.0.1', port, path: pathname, method }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }),
      );
    });
    call.on('error', reject);
    call.end();
  });
}

test('local preview serves Unicode assets, rejects malformed/traversal/link requests, and does not execute writes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wad-preview-tests-'));
  const source = path.join(directory, 'src');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'index.html'), '<title>文字实验</title>');
  const asset = '中文样式.css';
  const css = '.字 { color: white; }';
  await fs.writeFile(path.join(source, asset), css);
  const outside = path.join(directory, 'private');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), 'must-not-be-served');
  await fs.symlink(outside, path.join(source, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  const server = await createPreviewServer(source);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try {
    const index = await request(port, '/');
    assert.equal(index.status, 200);
    assert.equal(index.body.toString(), '<title>文字实验</title>');
    assert.equal(index.headers['x-content-type-options'], 'nosniff');
    assert.equal(index.headers['cache-control'], 'no-store');
    const stylesheet = await request(port, `/${encodeURIComponent(asset)}?version=latest`);
    assert.equal(stylesheet.status, 200);
    assert.equal(stylesheet.body.toString(), css);
    assert.equal(stylesheet.headers['content-type'], 'text/css; charset=utf-8');
    const head = await request(port, `/${encodeURIComponent(asset)}`, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body.byteLength, 0);
    assert.equal(Number(head.headers['content-length']), Buffer.byteLength(css));
    for (const pathname of [
      '/external/secret.txt',
      '/..%2Fprivate%2Fsecret.txt',
      '/..%5Cprivate%5Csecret.txt',
      '/%00secret.txt',
    ]) {
      const response = await request(port, pathname);
      assert.equal(response.status, 403);
      assert.ok(!response.body.toString().includes('must-not-be-served'));
    }
    assert.equal((await request(port, '/%ZZ')).status, 400);
    assert.equal((await request(port, '/missing.js')).status, 404);
    const post = await request(port, '/index.html', 'POST');
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, 'GET, HEAD');
    assert.equal(await fs.readFile(path.join(source, 'index.html'), 'utf8'), '<title>文字实验</title>');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('wad-preview-tests-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
