'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

/** Read one stable file snapshot without allocating past its accepted size. */
async function readBoundedHandle(handle, maxBytes, sizeError) {
  const before = await handle.stat();
  if (!before.isFile() || before.size > maxBytes) throw new Error(sizeError);
  const bytes = Buffer.alloc(before.size);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  const sentinel = Buffer.alloc(1);
  const { bytesRead: extra } = await handle.read(sentinel, 0, 1, bytes.byteLength);
  const after = await handle.stat();
  if (offset !== bytes.byteLength || extra || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
    throw new Error('文件在读取时发生变化，请重新选择。');
  return bytes;
}

async function readBoundedFile(file, maxBytes, sizeError) {
  const handle = await fs.open(file, 'r');
  try {
    return await readBoundedHandle(handle, maxBytes, sizeError);
  } finally {
    await handle.close();
  }
}

/** Replace an accepted text export only after its new bytes have been flushed. */
async function writeAtomicFile(file, text, { filesystem = fs } = {}) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.wad-${randomUUID()}.pending`);
  let handle;
  let created = false;
  try {
    handle = await filesystem.open(temporary, 'wx', 0o600);
    created = true;
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await filesystem.rename(temporary, file);
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (created) await filesystem.unlink(temporary).catch(() => {});
  }
}

module.exports = { readBoundedFile, readBoundedHandle, writeAtomicFile };
