import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readBoundedFile, readBoundedHandle, writeAtomicFile } = require('../electron/desktop-files.cjs');

test('desktop reader returns exact Unicode/binary bytes and rejects oversized or non-file selections', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wad-desktop-files-'));
  try {
    const file = path.join(directory, '文字与音乐 test.json');
    const bytes = Buffer.from('字真的在跳动\n👩🏽‍💻\u0000', 'utf8');
    await fs.writeFile(file, bytes);
    assert.deepEqual(await readBoundedFile(file, bytes.byteLength, 'file-too-large'), bytes);
    await assert.rejects(readBoundedFile(file, bytes.byteLength - 1, 'file-too-large'), /file-too-large/);
    await assert.rejects(readBoundedFile(directory, 1024, 'not-a-file'), /not-a-file/);
  } finally {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('wad-desktop-files-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function changingHandle(original, replacement) {
  let reads = 0;
  const requested = [];
  return {
    requested,
    async stat() {
      return { isFile: () => true, size: reads ? replacement.length : original.length, mtimeMs: 1 };
    },
    async read(target, offset, length, position) {
      reads++;
      requested.push({ length, targetBytes: target.byteLength });
      const source = replacement;
      const count = Math.min(length, Math.max(0, source.length - position));
      if (count) source.copy(target, offset, position, position + count);
      return { bytesRead: count };
    },
  };
}

test('a selected file growing after stat cannot allocate/read the new unbounded size', async () => {
  const handle = changingHandle(Buffer.from('small'), Buffer.alloc(1_000_000, 97));
  await assert.rejects(readBoundedHandle(handle, 512, 'file-too-large'), /发生变化/);
  assert.ok(handle.requested.every((read) => read.targetBytes <= 5));
  assert.equal(
    handle.requested.reduce((sum, read) => sum + read.length, 0),
    6,
  );
});

test('a selected file shrinking during read is rejected rather than padded with unread bytes', async () => {
  const handle = changingHandle(Buffer.from('original'), Buffer.from('new'));
  await assert.rejects(readBoundedHandle(handle, 512, 'file-too-large'), /发生变化/);
});

test('short OS reads assemble the full snapshot, while same-size changes remain detectable', async () => {
  const bytes = Buffer.from('multiple reads');
  let changed = false;
  const handle = {
    async stat() {
      return { isFile: () => true, size: bytes.length, mtimeMs: changed ? 2 : 1 };
    },
    async read(target, offset, length, position) {
      const count = Math.min(3, length, Math.max(0, bytes.length - position));
      bytes.copy(target, offset, position, position + count);
      return { bytesRead: count };
    },
  };
  assert.deepEqual(await readBoundedHandle(handle, 512, 'file-too-large'), bytes);
  const read = handle.read;
  handle.read = async (...args) => {
    changed = true;
    return read(...args);
  };
  await assert.rejects(readBoundedHandle(handle, 512, 'file-too-large'), /发生变化/);
});

test('a partial export failure preserves the original Unicode file and removes its temporary file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wad-desktop-files-'));
  const file = path.join(directory, '知识 已有文案.json');
  const original = '原文 👩🏽‍💻';
  try {
    await fs.writeFile(file, original, 'utf8');
    const filesystem = {
      ...fs,
      async open(...args) {
        const handle = await fs.open(...args);
        return {
          async writeFile() {
            await handle.writeFile('不完整');
            throw new Error('simulated-disk-full');
          },
          close: () => handle.close(),
          sync: () => handle.sync(),
        };
      },
    };
    await assert.rejects(writeAtomicFile(file, '新的完整文案', { filesystem }), /simulated-disk-full/);
    assert.equal(await fs.readFile(file, 'utf8'), original);
    assert.deepEqual(await fs.readdir(directory), [path.basename(file)]);
    await writeAtomicFile(file, '完整的新文案 🎶');
    assert.equal(await fs.readFile(file, 'utf8'), '完整的新文案 🎶');
    assert.deepEqual(await fs.readdir(directory), [path.basename(file)]);
  } finally {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('wad-desktop-files-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a failed final rename preserves the original file rather than reporting a successful export', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wad-desktop-files-'));
  const file = path.join(directory, 'locked.txt');
  try {
    await fs.writeFile(file, 'original');
    await assert.rejects(
      writeAtomicFile(file, 'replacement', {
        filesystem: {
          ...fs,
          rename: async () => {
            throw new Error('simulated-sharing-violation');
          },
        },
      }),
      /simulated-sharing-violation/,
    );
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    assert.deepEqual(await fs.readdir(directory), [path.basename(file)]);
  } finally {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('wad-desktop-files-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
