'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { writeAtomicFile } = require('./desktop-files.cjs');

/** Same-file writes keep acceptance order; failures do not block later saves. */
function createDesktopWrites({ filesystem = fs } = {}) {
  const tails = new Map();
  const pending = new Set();
  const keyFor = (file) => {
    const absolute = path.resolve(file);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  };

  function write(file, text, { createDirectory = false } = {}) {
    const key = keyFor(file);
    const task = (tails.get(key) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (createDirectory) await filesystem.mkdir(path.dirname(file), { recursive: true });
        await writeAtomicFile(file, text, { filesystem });
      });
    tails.set(key, task);
    pending.add(task);
    const settled = () => {
      pending.delete(task);
      if (tails.get(key) === task) tails.delete(key);
    };
    task.then(settled, settled);
    return task;
  }

  return {
    write,
    get pendingCount() {
      return pending.size;
    },
    async settled(file) {
      await tails.get(keyFor(file))?.catch(() => {});
    },
    async drain() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
  };
}

module.exports = { createDesktopWrites };
