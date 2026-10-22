import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const PACKAGE_MARKER = '.wad-generated-package.json';
export const PACKAGE_PRODUCT = 'words-actually-dance';
export const PACKAGE_DIRECTORY = 'Words Actually Dance';

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export async function ensurePlainDirectory(directory, filesystem = fs) {
  try {
    const stat = await filesystem.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`打包目录不是普通文件夹：${directory}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await filesystem.mkdir(directory);
  }
  if (!samePath(await filesystem.realpath(directory), directory))
    throw new Error('打包路径不能经过符号链接或目录联接。');
}

async function ownedDirectory(directory, destination, filesystem) {
  const stat = await filesystem.lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !samePath(await filesystem.realpath(directory), directory)
  )
    throw new Error('目标打包目录不安全，未执行清理。');
  let marker;
  try {
    marker = JSON.parse(await filesystem.readFile(path.join(directory, PACKAGE_MARKER), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('已有打包目录没有归属标记，未覆盖。');
    throw error;
  }
  if (marker.product !== PACKAGE_PRODUCT || !samePath(path.resolve(marker.destination || ''), destination))
    throw new Error('已有目录不属于此打包脚本，未执行清理。');
}

/** Build beside the current release; a failed copy never removes the runnable release. */
export async function publishWindowsPackage({ windowsRoot, build, filesystem = fs, warn = console.warn }) {
  const destination = path.join(windowsRoot, PACKAGE_DIRECTORY);
  await ensurePlainDirectory(windowsRoot, filesystem);
  let previous = false;
  try {
    await filesystem.lstat(destination);
    previous = true;
    await ownedDirectory(destination, destination, filesystem);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const staging = await filesystem.mkdtemp(path.join(windowsRoot, '.wad-package-build-'));
  const backup = path.join(windowsRoot, `.wad-package-backup-${randomUUID()}`);
  let backupExists = false;
  let stagingExists = true;
  // All recursive cleanup targets remain direct children of the verified output root.
  const removeOwned = async (directory) => {
    if (!samePath(path.dirname(directory), windowsRoot) || samePath(directory, destination))
      throw new Error('清理目录超出预期打包路径。');
    await ownedDirectory(directory, destination, filesystem);
    await filesystem.rm(directory, { recursive: true, force: true });
  };
  try {
    await filesystem.writeFile(
      path.join(staging, PACKAGE_MARKER),
      JSON.stringify({ product: PACKAGE_PRODUCT, destination }, null, 2),
      'utf8',
    );
    await build(staging);
    await ownedDirectory(staging, destination, filesystem);
    // Publish only a complete application; the launcher path stays stable.
    for (const file of [
      'Words Actually Dance.exe',
      'resources/app/package.json',
      'resources/app/electron/main.cjs',
      'resources/app/src/index.html',
    ])
      if (!(await filesystem.stat(path.join(staging, file))).isFile())
        throw new Error(`新打包内容不完整：${file}`);
    if (previous) {
      await ownedDirectory(destination, destination, filesystem);
      await filesystem.rename(destination, backup);
      backupExists = true;
    }
    try {
      await filesystem.rename(staging, destination);
      stagingExists = false;
    } catch (error) {
      if (backupExists) {
        try {
          await filesystem.rename(backup, destination);
          backupExists = false;
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            `新包替换失败，旧包保留在 ${backup}，自动恢复失败。`,
          );
        }
      }
      throw error;
    }
    if (backupExists) {
      try {
        await removeOwned(backup);
        backupExists = false;
      } catch (error) {
        warn(`新版已生成；旧包备份暂时无法清理：${backup} (${error.message})`);
      }
    }
    return destination;
  } finally {
    if (stagingExists) {
      try {
        await removeOwned(staging);
      } catch (error) {
        warn(`未发布的临时打包目录保留在 ${staging}：${error.message}`);
      }
    }
  }
}
