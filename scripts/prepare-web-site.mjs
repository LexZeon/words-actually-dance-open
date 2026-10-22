import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const markerName = '.wad-site-source.json';
const markerKind = 'words-actually-dance-site-export-v1';
const ignored = new Set(['node_modules', 'dist', '.git', '.sites-runtime']);
const sourceExtensions = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.json',
  '.sql',
  '.yaml',
  '.yml',
]);

async function sourceFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.openai') continue;
    const absolute = path.join(directory, entry.name),
      relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Site source cannot contain links: ${relative}`);
    if (entry.isDirectory()) files.push(...(await sourceFiles(absolute, relative)));
    else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name).toLowerCase()))
      files.push({ absolute, relative });
    else if (entry.isFile()) continue;
    else throw new Error(`Site source contains a special file: ${relative}`);
  }
  return files;
}

async function readOptional(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertOwnedTarget(destination, relative) {
  const target = path.resolve(destination, relative),
    within = path.relative(destination, target);
  if (!within || within === '..' || within.startsWith(`..${path.sep}`) || path.isAbsolute(within))
    throw new Error('Invalid Site source path.');
  let cursor = destination;
  for (const component of within.split(path.sep)) {
    cursor = path.join(cursor, component);
    try {
      if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('Site target cannot contain symlinks.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return target;
}

/** Export only owned source paths, preserving the Sites helper's Git and dependency state. */
export async function prepareWebSite({ projectRoot, collaborationLibrary = true } = {}) {
  const root = await fs.realpath(projectRoot);
  const destination = path.resolve(root, 'artifacts/site-checkout');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    if ((await fs.lstat(destination)).isSymbolicLink()) throw new Error('Site checkout cannot be a symlink.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.mkdir(destination, { recursive: true });
  const before = await readOptional(path.join(destination, markerName));
  const previous = before ? JSON.parse(before) : null;
  if (previous && (previous.kind !== markerKind || previous.sourceRoot !== root))
    throw new Error('Existing Site export belongs to another source tree.');
  if (!previous && (await fs.readdir(destination)).length)
    throw new Error('Site checkout is not empty; refusing to overwrite unowned files.');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'web/.openai/hosting.json'), 'utf8'));
  if (!manifest.project_id || manifest.static)
    throw new Error('A registered Worker Site manifest is required.');
  if (!collaborationLibrary) {
    manifest.d1 = null;
    manifest.r2 = null;
  }
  const planned = new Map();
  for (const directory of ['src', 'web'])
    for (const file of await sourceFiles(path.join(root, directory), directory)) {
      if (file.relative.startsWith('web/.openai/')) continue;
      if (
        !collaborationLibrary &&
        (file.relative.startsWith('web/drizzle/') ||
          file.relative.startsWith('web/migrations/') ||
          file.relative.startsWith('web/worker/') ||
          /web-library/u.test(file.relative))
      )
        continue;
      planned.set(file.relative, await fs.readFile(file.absolute));
    }
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'web/package.json'), 'utf8'));
  planned.set('package.json', Buffer.from(JSON.stringify(packageJson, null, 2) + '\n'));
  planned.set('.openai/hosting.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  planned.set(
    '.gitignore',
    Buffer.from('node_modules/\ndist/\n.sites-runtime/\n.wad-site-source.json\n.web-build/\n'),
  );
  planned.set('web/site-config.json', Buffer.from(JSON.stringify({ collaborationLibrary }) + '\n'));
  const lock = await readOptional(path.join(root, 'web/pnpm-lock.yaml'));
  if (lock) planned.set('pnpm-lock.yaml', Buffer.from(lock));
  const workspace = await readOptional(path.join(root, 'web/pnpm-workspace.yaml'));
  if (workspace) planned.set('pnpm-workspace.yaml', Buffer.from(workspace));
  if (collaborationLibrary)
    for (const file of await sourceFiles(path.join(root, 'web/drizzle')))
      planned.set(path.posix.join('drizzle', file.relative), await fs.readFile(file.absolute));
  const owned = new Set(previous?.files || []);
  for (const relative of new Set([...owned, ...planned.keys()]))
    await assertOwnedTarget(destination, relative);
  for (const relative of planned.keys()) {
    const existing = await readOptional(path.join(destination, relative));
    if (!owned.has(relative) && existing !== null && !Buffer.from(existing).equals(planned.get(relative)))
      throw new Error(`Refusing to overwrite unowned Site file: ${relative}`);
  }
  // Prune only exact previously exported files. Never recursively remove a
  // checkout, Git state, dependency folder, or another task's content.
  for (const relative of owned) {
    if (planned.has(relative)) continue;
    const target = path.resolve(destination, relative),
      inside = path.relative(destination, target);
    if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside))
      throw new Error('Invalid export ownership path.');
    await fs.unlink(target).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  for (const [relative, bytes] of planned) {
    const target = path.join(destination, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }
  await fs.writeFile(
    path.join(destination, markerName),
    JSON.stringify({ kind: markerKind, sourceRoot: root, files: [...planned.keys()].sort() }, null, 2) + '\n',
  );
  return {
    directory: destination,
    sourceFiles: planned.size,
    collaborationLibrary,
    projectId: manifest.project_id,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--without-library'))
    throw new Error('Usage: node scripts/prepare-web-site.mjs [--without-library]');
  console.log(
    JSON.stringify(
      await prepareWebSite({
        projectRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
        collaborationLibrary: !args.includes('--without-library'),
      }),
    ),
  );
}
