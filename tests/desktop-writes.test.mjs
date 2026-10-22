import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDesktopWrites } = require('../electron/desktop-writes.cjs');
const flush = () => new Promise(setImmediate);

test('same-file writes retain acceptance order, failed saves recover, and quit drains every accepted write', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wad-desktop-writes-'));
  const file = path.join(directory, '演出文案.txt');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let opened = 0;
  const queue = createDesktopWrites({
    filesystem: {
      ...fs,
      async open(...args) {
        const handle = await fs.open(...args);
        const index = opened++;
        return {
          async writeFile(...values) {
            if (index === 0) {
              await gate;
              await handle.writeFile('partial');
              throw new Error('first-save-failed');
            }
            return handle.writeFile(...values);
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        };
      },
    },
  });
  try {
    await fs.writeFile(file, 'original');
    const first = queue.write(file, 'first');
    const failed = assert.rejects(first, /first-save-failed/);
    const second = queue.write(file, 'second');
    await flush();
    assert.equal(queue.pendingCount, 2);
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    let drained = false;
    const drain = queue.drain().then(() => {
      drained = true;
    });
    await flush();
    assert.equal(drained, false);
    release();
    await failed;
    await second;
    await drain;
    assert.equal(queue.pendingCount, 0);
    assert.equal(await fs.readFile(file, 'utf8'), 'second');
    assert.deepEqual(await fs.readdir(directory), [path.basename(file)]);
  } finally {
    release();
    await queue.drain();
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('wad-desktop-writes-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('independent exports proceed without waiting for another path, and state directories are created when requested', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wad-desktop-writes-'));
  const queue = createDesktopWrites();
  try {
    const file = path.join(directory, 'new-user-data', 'state.json');
    await queue.write(file, '{"version":1}', { createDirectory: true });
    await queue.settled(file);
    assert.equal(await fs.readFile(file, 'utf8'), '{"version":1}');
    await Promise.all([
      queue.write(file, '{"version":2}'),
      queue.write(path.join(directory, 'export.txt'), '正文'),
    ]);
    assert.equal(await fs.readFile(file, 'utf8'), '{"version":2}');
    assert.equal(await fs.readFile(path.join(directory, 'export.txt'), 'utf8'), '正文');
  } finally {
    await queue.drain();
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('wad-desktop-writes-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
