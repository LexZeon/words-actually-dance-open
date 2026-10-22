import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  PACKAGE_DIRECTORY,
  PACKAGE_MARKER,
  PACKAGE_PRODUCT,
  publishWindowsPackage,
} from '../scripts/windows-package.mjs';

async function workspace(action) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wad-package-tests-'));
  const windowsRoot = path.join(directory, '打包输出');
  await fs.mkdir(windowsRoot);
  try {
    await action({ windowsRoot, destination: path.join(windowsRoot, PACKAGE_DIRECTORY) });
  } finally {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('wad-package-tests-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function release(directory, version) {
  await fs.mkdir(path.join(directory, 'resources/app/electron'), { recursive: true });
  await fs.mkdir(path.join(directory, 'resources/app/src'), { recursive: true });
  await fs.writeFile(path.join(directory, 'Words Actually Dance.exe'), `binary-${version}`);
  await fs.writeFile(path.join(directory, 'resources/app/package.json'), JSON.stringify({ version }));
  await fs.writeFile(path.join(directory, 'resources/app/electron/main.cjs'), `// ${version}`);
  await fs.writeFile(path.join(directory, 'resources/app/src/index.html'), `<title>${version}</title>`);
}

async function existing(destination) {
  await fs.mkdir(destination);
  await fs.writeFile(
    path.join(destination, PACKAGE_MARKER),
    JSON.stringify({ product: PACKAGE_PRODUCT, destination }),
  );
  await release(destination, 'old');
}

test('an interrupted package copy keeps the previous latest executable and cleans only its own staging directory', async () => {
  await workspace(async ({ windowsRoot, destination }) => {
    await existing(destination);
    await assert.rejects(
      publishWindowsPackage({
        windowsRoot,
        build: async (directory) => {
          await fs.writeFile(path.join(directory, 'partial-copy'), 'partial');
          throw new Error('simulated-copy-failure');
        },
      }),
      /simulated-copy-failure/,
    );
    assert.equal(await fs.readFile(path.join(destination, 'Words Actually Dance.exe'), 'utf8'), 'binary-old');
    assert.deepEqual(await fs.readdir(windowsRoot), [PACKAGE_DIRECTORY]);
  });
});

test('a complete new package replaces the stable launcher target and incomplete packages never publish', async () => {
  await workspace(async ({ windowsRoot, destination }) => {
    await existing(destination);
    await assert.rejects(publishWindowsPackage({ windowsRoot, build: async () => {} }), /ENOENT|不完整/);
    assert.equal(await fs.readFile(path.join(destination, 'Words Actually Dance.exe'), 'utf8'), 'binary-old');
    assert.equal(
      await publishWindowsPackage({ windowsRoot, build: (directory) => release(directory, 'new') }),
      destination,
    );
    assert.equal(await fs.readFile(path.join(destination, 'Words Actually Dance.exe'), 'utf8'), 'binary-new');
    assert.deepEqual(await fs.readdir(windowsRoot), [PACKAGE_DIRECTORY]);
  });
});

test('a final replacement failure rolls the original release back to the same shortcut target', async () => {
  await workspace(async ({ windowsRoot, destination }) => {
    await existing(destination);
    const filesystem = {
      ...fs,
      async rename(from, to) {
        if (path.basename(from).startsWith('.wad-package-build-'))
          throw new Error('simulated-publish-failure');
        return fs.rename(from, to);
      },
    };
    await assert.rejects(
      publishWindowsPackage({ windowsRoot, filesystem, build: (directory) => release(directory, 'new') }),
      /simulated-publish-failure/,
    );
    assert.equal(await fs.readFile(path.join(destination, 'Words Actually Dance.exe'), 'utf8'), 'binary-old');
    assert.deepEqual(await fs.readdir(windowsRoot), [PACKAGE_DIRECTORY]);
  });
});

test('unknown or incorrectly marked folders are never overwritten, and a junction output root is rejected', async () => {
  await workspace(async ({ windowsRoot, destination }) => {
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, 'user.txt'), 'user-owned');
    let built = false;
    const build = async () => {
      built = true;
    };
    await assert.rejects(publishWindowsPackage({ windowsRoot, build }), /归属标记/);
    await fs.writeFile(
      path.join(destination, PACKAGE_MARKER),
      JSON.stringify({ product: PACKAGE_PRODUCT, destination: windowsRoot }),
    );
    await assert.rejects(publishWindowsPackage({ windowsRoot, build }), /不属于/);
    assert.equal(built, false);
    assert.equal(await fs.readFile(path.join(destination, 'user.txt'), 'utf8'), 'user-owned');
    const alias = path.join(path.dirname(windowsRoot), 'junction-output');
    await fs.symlink(windowsRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(publishWindowsPackage({ windowsRoot: alias, build }), /普通文件夹|符号链接/);
    assert.equal(await fs.readFile(path.join(destination, 'user.txt'), 'utf8'), 'user-owned');
  });
});
