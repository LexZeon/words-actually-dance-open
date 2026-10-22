import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ensurePlainDirectory, publishWindowsPackage } from './windows-package.mjs';

const require = createRequire(import.meta.url);
const workspace = await fs.realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const windowsRoot = path.join(workspace, 'dist', 'windows');
const destination = path.join(windowsRoot, 'Words Actually Dance');
const product = 'words-actually-dance';

if (process.platform !== 'win32') throw new Error('此打包脚本需要在 Windows 运行。');
const electronBinary = require('electron');
const electronDist = path.dirname(electronBinary);
await fs.access(electronBinary);
const manifest = JSON.parse(await fs.readFile(path.join(workspace, 'package.json'), 'utf8'));
await fs.access(path.join(workspace, 'src', 'index.html'));
await fs.access(path.join(workspace, 'electron', 'main.cjs'));

await ensurePlainDirectory(path.join(workspace, 'dist'));
await publishWindowsPackage({
  windowsRoot,
  build: async (staging) => {
    await fs.cp(electronDist, staging, { recursive: true });
    await fs.rename(path.join(staging, 'electron.exe'), path.join(staging, 'Words Actually Dance.exe'));

    const appDirectory = path.join(staging, 'resources', 'app');
    await fs.mkdir(appDirectory, { recursive: true });
    for (const directory of ['src', 'electron']) {
      const sourceRoot = path.join(workspace, directory);
      await fs.cp(sourceRoot, path.join(appDirectory, directory), {
        recursive: true,
        filter: async (source) => {
          const accepted = !path
            .relative(sourceRoot, source)
            .split(path.sep)
            .some((part) => {
              const name = part.toLowerCase();
              return (
                ['docs', 'artifacts', 'credentials', 'node_modules'].includes(name) ||
                name === '.env' ||
                name.startsWith('.env.') ||
                /\.(?:pem|key|p12|pfx)$/.test(name)
              );
            });
          if (accepted && (await fs.lstat(source)).isSymbolicLink())
            throw new Error(`程序源文件不能经过符号链接或目录联接：${source}`);
          return accepted;
        },
      });
    }
    const packagedManifest = {
      name: product,
      productName: 'Words Actually Dance',
      version: manifest.version,
      description: manifest.description,
      type: 'module',
      main: 'electron/main.cjs',
      private: true,
      author: manifest.author,
      ...(manifest.wadDistribution === 'open-source' ? { wadDistribution: 'open-source' } : {}),
    };
    await fs.copyFile(path.join(workspace, 'LICENSE'), path.join(appDirectory, 'LICENSE'));
    const noticeSource = path.join(workspace, 'THIRD-PARTY-NOTICES.md');
    const fallbackNotice = path.join(workspace, 'public-docs', 'THIRD-PARTY-NOTICES.md');
    await fs.copyFile(
      await fs.access(noticeSource).then(
        () => noticeSource,
        () => fallbackNotice,
      ),
      path.join(appDirectory, 'THIRD-PARTY-NOTICES.md'),
    );
    const musicCredits = path.join(workspace, 'MUSIC-CREDITS.md');
    await fs.copyFile(
      await fs.access(musicCredits).then(
        () => musicCredits,
        () => path.join(workspace, 'public-docs', 'MUSIC-CREDITS.md'),
      ),
      path.join(appDirectory, 'MUSIC-CREDITS.md'),
    );
    await fs.writeFile(
      path.join(appDirectory, 'package.json'),
      JSON.stringify(packagedManifest, null, 2),
      'utf8',
    );
  },
});

const launcher = '@echo off\r\nstart "" "%~dp0Words Actually Dance\\Words Actually Dance.exe"\r\n';
await fs.writeFile(path.join(windowsRoot, '启动实验版.cmd'), launcher, 'utf8');
console.log(`Windows 便携版已生成：${path.join(destination, 'Words Actually Dance.exe')}`);
console.log('请保留整个 Words Actually Dance 文件夹；无需安装 Node.js。');
