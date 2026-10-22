import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
const scriptsRoot = fileURLToPath(new URL('../scripts/', import.meta.url));
const powershell = path.join(
  process.env.SystemRoot || 'C:/Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe',
);
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
function run(script) {
  const command = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $ErrorActionPreference = 'Stop'; ${script}`;
  return spawnSync(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(command, 'utf16le').toString('base64'),
    ],
    { encoding: 'utf8', windowsHide: true },
  );
}

test(
  'Windows PowerShell 5.1 reads and parses every launcher script as UTF-8 rather than ANSI',
  { skip: !windows },
  async () => {
    for (const name of ['launch.ps1', 'create-desktop-shortcut.ps1']) {
      const file = path.join(scriptsRoot, name);
      const bytes = await fs.readFile(file);
      assert.equal(
        bytes.subarray(0, 3).toString('hex'),
        'efbbbf',
        `${name} needs a UTF-8 BOM for Windows PowerShell 5.1`,
      );
      const result = run(
        `$tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile(${quote(file)}, [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count) { throw ($errors.Message -join '; ') }; 'parsed'`,
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), 'parsed');
    }
  },
);

test(
  'the fixed launcher handles Unicode paths, chooses the latest complete portable directory, and preserves development fallback',
  { skip: !windows },
  async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wad-launcher-tests-'));
    const project = path.join(directory, '字真的在跳动 空格');
    await fs.mkdir(path.join(project, 'scripts'), { recursive: true });
    const launcher = path.join(project, 'scripts/launch.ps1');
    await fs.copyFile(path.join(scriptsRoot, 'launch.ps1'), launcher);
    const check = () => run(`& ${quote(launcher)} -Check`);
    try {
      const missing = check();
      assert.equal(missing.status, 1);
      const development = path.join(project, 'node_modules/electron/dist/electron.exe');
      await fs.mkdir(path.dirname(development), { recursive: true });
      await fs.writeFile(development, 'test only; not executable');
      for (const file of ['package.json', 'electron/main.cjs', 'src/index.html']) {
        await fs.mkdir(path.dirname(path.join(project, file)), { recursive: true });
        await fs.writeFile(path.join(project, file), 'fixture');
      }
      const devResult = check();
      assert.equal(devResult.status, 0, devResult.stderr);
      const dev = JSON.parse(devResult.stdout);
      assert.equal(dev.mode, 'development');
      assert.equal(dev.arguments, `"${project}"`);
      const portableRoot = path.join(project, 'dist/windows/Words Actually Dance');
      await fs.mkdir(portableRoot, { recursive: true });
      await fs.writeFile(path.join(portableRoot, 'Words Actually Dance.exe'), 'test only; not executable');
      const incomplete = check();
      assert.equal(incomplete.status, 1);
      for (const file of ['package.json', 'electron/main.cjs', 'src/index.html']) {
        const target = path.join(portableRoot, 'resources/app', file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, 'fixture');
      }
      const portableResult = check();
      assert.equal(portableResult.status, 0, portableResult.stderr);
      const portable = JSON.parse(portableResult.stdout);
      assert.equal(portable.mode, 'portable');
      assert.equal(portable.executable, path.join(portableRoot, 'Words Actually Dance.exe'));
      assert.equal(portable.workingDirectory, portableRoot);
      assert.equal(portable.arguments, null);
    } finally {
      assert.equal(path.dirname(directory), os.tmpdir());
      assert.ok(path.basename(directory).startsWith('wad-launcher-tests-'));
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'the Unicode ShellLink implementation compiles and round-trips a shortcut without modifying the desktop',
  { skip: !windows },
  async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wad-launcher-tests-'));
    try {
      const link = path.join(directory, '字真的在跳动 快捷方式.lnk');
      const target = path.join(directory, '中文 程序.exe');
      const argumentsValue = '-File "C:\\中文目录\\launch.ps1"';
      const result = run(
        `Add-Type -Path ${quote(path.join(scriptsRoot, 'windows-shell-link.cs'))}; [WordsActuallyDance.WindowsShortcut]::Save(${quote(link)}, ${quote(target)}, ${quote(argumentsValue)}, ${quote(directory)}, ''); [WordsActuallyDance.WindowsShortcut]::Read(${quote(link)}) | ConvertTo-Json -Compress`,
      );
      assert.equal(result.status, 0, result.stderr);
      const saved = JSON.parse(result.stdout);
      assert.equal(saved.TargetPath, target);
      assert.equal(saved.Arguments, argumentsValue);
      assert.equal(saved.WorkingDirectory, directory);
    } finally {
      assert.equal(path.dirname(directory), os.tmpdir());
      assert.ok(path.basename(directory).startsWith('wad-launcher-tests-'));
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);
