import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = await fs.readFile(path.join(root, 'dist/server/index.js'), 'utf8');
const worker = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
assert.equal(typeof worker.default.fetch, 'function');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'dist/.openai/hosting.json'), 'utf8'));
assert.ok(manifest.project_id);
assert.equal(manifest.static, undefined);
const page = await worker.default.fetch(new Request('https://example.test/'), {});
assert.equal(page.status, 200);
assert.ok((await page.text()).includes('/web/web-app.js'));
assert.equal(
  (await worker.default.fetch(new Request('https://example.test/src/app/app-controller.js'), {})).status,
  200,
);
assert.equal(
  (await worker.default.fetch(new Request('https://example.test/.openai/hosting.json'), {})).status,
  404,
);
if (manifest.d1) {
  assert.equal((await worker.default.fetch(new Request('https://example.test/api/library'), {})).status, 401);
  const journal = JSON.parse(
    await fs.readFile(path.join(root, 'dist/.openai/drizzle/meta/_journal.json'), 'utf8'),
  );
  assert.ok(journal.entries.length > 0);
}
console.log('Private Worker ESM artifact, player assets and library boundary are valid.');
