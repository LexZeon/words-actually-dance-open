import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function assetsIn(directory, prefix) {
  const assets = {};
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (
      entry.name.startsWith('.') ||
      ['node_modules', 'scripts', 'worker', 'drizzle', 'migrations', 'dev'].includes(entry.name)
    )
      continue;
    const name = path.posix.join(prefix, entry.name),
      absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Site assets cannot contain links.');
    if (entry.isDirectory()) Object.assign(assets, await assetsIn(absolute, name));
    else if (contentTypes[path.extname(entry.name)])
      assets[`/${name}`] = {
        type: contentTypes[path.extname(entry.name)],
        bytes: (await fs.readFile(absolute)).toString('base64'),
      };
  }
  return assets;
}

export function webHtml(source, collaborationLibrary) {
  return source
    .replace(
      '<html lang="zh-CN">',
      `<html lang="zh-CN" data-collaboration-library="${collaborationLibrary ? 'on' : 'off'}"${collaborationLibrary ? '' : ' data-web-public="true" data-web-music-import="off"'}>`,
    )
    .replace('href="./styles.css"', 'href="/src/styles.css"')
    .replace('href="./visuals/extra-effects.css"', 'href="/src/visuals/extra-effects.css"')
    .replace(
      '</head>',
      `${collaborationLibrary ? '<link rel="stylesheet" href="/web/web-library.css" />' : ''}\n</head>`,
    )
    .replace(
      '<script type="module" src="./app.js"></script>',
      '<script type="module" src="/web/web-app.js"></script>',
    );
}

export async function buildSite({ projectRoot = root, esbuild } = {}) {
  const config = JSON.parse(await fs.readFile(path.join(projectRoot, 'web/site-config.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, '.openai/hosting.json'), 'utf8'));
  if (manifest.static) throw new Error('This build is a Worker ESM Site.');
  const assets = {
    ...(await assetsIn(path.join(projectRoot, 'src'), 'src')),
    ...(await assetsIn(path.join(projectRoot, 'web'), 'web')),
  };
  const html = webHtml(
    await fs.readFile(path.join(projectRoot, 'src/index.html'), 'utf8'),
    config.collaborationLibrary,
  );
  assets['/'] = { type: 'text/html; charset=utf-8', bytes: Buffer.from(html).toString('base64') };
  assets['/index.html'] = assets['/'];
  if (!config.collaborationLibrary) {
    delete assets['/web/web-library-client.js'];
    delete assets['/web/web-library.css'];
    delete assets['/web/web-library-provider.js'];
    const entry = await fs.readFile(path.join(projectRoot, 'web/web-app.js'), 'utf8');
    assets['/web/web-app.js'].bytes = Buffer.from(
      entry
        .replace(
          /^import \{ mountWebLibrary \} from '\.\/web-library-client\.js';\r?\n/mu,
          'const mountWebLibrary = null;\n',
        )
        .replace(
          /^import \{ registerWebLibraryProvider \} from '\.\/web-library-provider\.js';\r?\n/mu,
          'const registerWebLibraryProvider = null;\n',
        ),
    ).toString('base64');
  }
  const source = `${config.collaborationLibrary ? 'import { handleLibraryRequest } from "./web/worker/library-api.js";' : 'const handleLibraryRequest = async () => null;'}
const assets = ${JSON.stringify(assets)};
export default { async fetch(request, env) {
  const api = await handleLibraryRequest(request, env); if(api) return api;
  const pathname = new URL(request.url).pathname;
  if(pathname.startsWith('/api/')) return new Response('Not found',{status:404});
  if(!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:{allow:'GET, HEAD'}});
  const asset = assets[pathname]; if(!asset) return new Response('Not found',{status:404});
  const bytes = Uint8Array.from(atob(asset.bytes), value => value.charCodeAt(0));
  return new Response(request.method==='HEAD'?null:bytes,{headers:{'content-type':asset.type,'content-length':String(bytes.length),'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin'}});
} };
`;
  const output = path.resolve(projectRoot, 'dist/server/index.js');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const bundler = esbuild || (await import('esbuild'));
  await bundler.build({
    stdin: { contents: source, resolveDir: projectRoot, sourcefile: 'wad-private-site.js' },
    outfile: output,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: false,
    logLevel: 'silent',
  });
  await fs.mkdir(path.join(projectRoot, 'dist/.openai'), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, 'dist/.openai/hosting.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  if (config.collaborationLibrary)
    await fs.cp(path.join(projectRoot, 'drizzle'), path.join(projectRoot, 'dist/.openai/drizzle'), {
      recursive: true,
    });
  else {
    const migrationOutput = path.resolve(projectRoot, 'dist/.openai/drizzle');
    try {
      const resolved = await fs.realpath(migrationOutput),
        inside = path.relative(await fs.realpath(projectRoot), resolved);
      if (
        inside.startsWith(`..${path.sep}`) ||
        inside === '..' ||
        path.isAbsolute(inside) ||
        resolved !== migrationOutput
      )
        throw new Error('Unsafe migration output path.');
      await fs.rm(migrationOutput, { recursive: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return {
    artifact: output,
    assets: Object.keys(assets).length,
    collaborationLibrary: config.collaborationLibrary,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await buildSite()));
