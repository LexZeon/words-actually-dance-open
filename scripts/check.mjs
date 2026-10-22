import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sources = [];

async function collect(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !['node_modules', 'dist', '.git', 'artifacts'].includes(entry.name))
      await collect(file);
    else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) sources.push(file);
  }
}

for (const directory of ['src', 'electron', 'scripts', 'web']) await collect(path.join(workspace, directory));
let failed = false;
for (const file of sources) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
  if (check.status !== 0 || check.error) {
    failed = true;
    console.error(`语法检查失败：${path.relative(workspace, file)}`);
    console.error(check.error?.message || check.stderr || check.stdout);
  }
}
if (failed) process.exitCode = 1;
else console.log(`${sources.length} 个 JavaScript 文件语法检查通过。`);
