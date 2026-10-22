import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CLIPS, MEDIA_FILES, officialPlayerURL, BILIBILI_PLAYER_ORIGIN } from './app.js';

const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(DIRECTORY);
const DIST = path.join(DIRECTORY, 'dist');
const MARKER = '.wad-showcase-build.json';
const KIND = 'wad-standalone-video-showcase-v1';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const publicMediaRoots = [path.join(ROOT, 'public-docs/media'), path.join(ROOT, 'media')];

function inside(directory, relative) {
  assert(relative && !path.isAbsolute(relative), 'A relative owned path is required.');
  const target = path.resolve(directory, relative),
    remainder = path.relative(directory, target);
  assert(
    remainder && remainder !== '..' && !remainder.startsWith(`..${path.sep}`) && !path.isAbsolute(remainder),
    'A build path escaped its owned directory.',
  );
  return target;
}

async function exists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
async function plain(file, directory = false) {
  const stat = await fs.lstat(file);
  assert(
    !stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()),
    'Expected a plain build file or directory.',
  );
  assert(samePath(await fs.realpath(file), path.resolve(file)), 'A build path resolves through a link.');
  return stat;
}

function boxes(buffer, start = 0, end = buffer.length) {
  const children = [];
  for (let offset = start; offset < end;) {
    assert(offset + 8 <= end, 'Truncated MP4 box.');
    let size = buffer.readUInt32BE(offset),
      header = 8;
    if (size === 1) {
      assert(offset + 16 <= end, 'Truncated extended MP4 box.');
      const large = buffer.readBigUInt64BE(offset + 8);
      assert(large <= BigInt(Number.MAX_SAFE_INTEGER), 'MP4 box is too large.');
      size = Number(large);
      header = 16;
    }
    if (size === 0) size = end - offset;
    assert(size >= header && offset + size <= end, 'MP4 box leaves its parent.');
    children.push({
      type: buffer.toString('ascii', offset + 4, offset + 8),
      start: offset + header,
      end: offset + size,
    });
    offset += size;
  }
  return children;
}

export function mp4Tracks(buffer) {
  const moov = boxes(buffer).find((box) => box.type === 'moov');
  assert(moov, 'MP4 metadata is missing.');
  const tracks = [];
  for (const track of boxes(buffer, moov.start, moov.end).filter((box) => box.type === 'trak')) {
    const media = boxes(buffer, track.start, track.end).find((box) => box.type === 'mdia');
    assert(media, 'MP4 track has no media metadata.');
    const handler = boxes(buffer, media.start, media.end).find((box) => box.type === 'hdlr');
    assert(handler && handler.start + 12 <= handler.end, 'MP4 handler is missing.');
    tracks.push(buffer.toString('ascii', handler.start + 8, handler.start + 12));
  }
  return {
    video: tracks.filter((kind) => kind === 'vide').length,
    audio: tracks.filter((kind) => kind === 'soun').length,
  };
}

async function inventory(directory, relative = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    const file = inside(DIST, name);
    assert(!entry.isSymbolicLink(), 'A link exists in the output directory.');
    if (entry.isDirectory()) {
      assert(name === 'media', 'An unknown directory exists in dist.');
      await plain(file, true);
      files.push(...(await inventory(file, name)));
    } else {
      await plain(file);
      files.push(name);
    }
  }
  return files;
}

async function build() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('node showcase-site/build.mjs [--media-root <project public-docs/media or media>]');
    return;
  }
  assert(
    !args.length || (args.length === 2 && args[0] === '--media-root'),
    'Use no arguments or --media-root <reviewed public media directory>.',
  );
  const mediaRoot = args.length
    ? path.resolve(args[1])
    : (await exists(publicMediaRoots[0]))
      ? publicMediaRoots[0]
      : publicMediaRoots[1];
  assert(
    publicMediaRoots.some((candidate) => samePath(candidate, mediaRoot)),
    'Only this project’s public-docs/media or media directory is accepted.',
  );
  await plain(DIRECTORY, true);
  await plain(mediaRoot, true);
  const plan = new Map();
  for (const name of ['index.html', 'styles.css', 'app.js']) {
    const file = inside(DIRECTORY, name);
    await plain(file);
    plan.set(name, await fs.readFile(file));
  }
  const html = plan.get('index.html').toString('utf8'),
    app = plan.get('app.js').toString('utf8');
  assert(
    !/<iframe\b|type=["']file["']/i.test(html) && !/getUserMedia|getDisplayMedia|AudioContext/.test(app),
    'Gallery must use only its audited source-player factory and stay independent from capture, upload and analysis.',
  );
  assert(
    (app.match(/createElement\(['"]iframe['"]\)/g) ?? []).length === 1,
    'Only the audited official-player iframe factory is allowed.',
  );
  for (const clip of CLIPS.filter((entry) => entry.kind === 'song')) {
    const player = new URL(officialPlayerURL(clip.id));
    assert(
      player.origin === BILIBILI_PLAYER_ORIGIN &&
        player.origin === 'https://player.bilibili.com' &&
        player.pathname === '/player.html',
      'An embedded player is outside the exact official Bilibili endpoint.',
    );
    assert(
      player.searchParams.get('autoplay') === '1' &&
        player.searchParams.get('muted') === '0' &&
        player.searchParams.get('danmaku') === '0',
      'Official-player parameters differ from the reviewed contract.',
    );
  }
  const streams = [];
  for (const name of MEDIA_FILES) {
    assert(/^[a-z0-9-]+\.(mp4|gif|webp)$/.test(name), 'Unexpected public-media filename.');
    const file = inside(mediaRoot, name);
    await plain(file);
    const bytes = await fs.readFile(file);
    if (name.endsWith('.mp4')) {
      const clip = CLIPS.find((entry) => entry.file === name),
        tracks = mp4Tracks(bytes);
      assert(
        tracks.video === 1 && tracks.audio === (clip.kind === 'song' ? 0 : 1),
        `Unexpected audio/video tracks in ${name}; no output was changed.`,
      );
      streams.push({ file: `media/${name}`, kind: clip.kind, ...tracks });
    } else if (name.endsWith('.gif'))
      assert(/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)), 'Invalid public GIF.');
    else
      assert(
        bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
        'Invalid public poster.',
      );
    plan.set(`media/${name}`, bytes);
  }
  assert(
    [...plan.values()].reduce((sum, bytes) => sum + bytes.length, 0) <= 100 * 1024 * 1024,
    'Gallery output exceeds the bounded size.',
  );

  let previous = null;
  if (await exists(DIST)) {
    await plain(DIST, true);
    const marker = inside(DIST, MARKER);
    assert(await exists(marker), 'Refusing to overwrite an unowned dist directory.');
    await plain(marker);
    previous = JSON.parse(await fs.readFile(marker, 'utf8'));
    assert(
      previous.kind === KIND && Array.isArray(previous.files),
      'Output marker does not belong to this gallery builder.',
    );
    const actual = await inventory(DIST),
      expected = new Set([MARKER, ...previous.files.map((entry) => entry.file)]);
    assert(
      actual.length === expected.size && actual.every((file) => expected.has(file)),
      'Unknown files exist in dist; preserve them before rebuilding.',
    );
    for (const entry of previous.files)
      assert(
        hash(await fs.readFile(inside(DIST, entry.file))) === entry.sha256,
        'An owned output was modified; refusing to overwrite it.',
      );
  } else await fs.mkdir(DIST);
  if (!(await exists(path.join(DIST, 'media')))) await fs.mkdir(path.join(DIST, 'media'));
  for (const [name, bytes] of plan)
    await fs.writeFile(inside(DIST, name), bytes, { flag: previous ? 'w' : 'wx' });
  for (const entry of previous?.files ?? [])
    if (!plan.has(entry.file)) await fs.unlink(inside(DIST, entry.file));
  const files = [...plan].map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: hash(bytes) }));
  const marker = {
    kind: KIND,
    createdAt: new Date().toISOString(),
    mediaSource: path.relative(ROOT, mediaRoot).split(path.sep).join('/'),
    files,
    streams,
  };
  await fs.writeFile(inside(DIST, MARKER), `${JSON.stringify(marker, null, 2)}\n`);
  for (const entry of files)
    assert(
      hash(await fs.readFile(inside(DIST, entry.file))) === entry.sha256,
      'Written output hash differs from the source.',
    );
  console.log(
    JSON.stringify(
      {
        output: 'showcase-site/dist',
        files: files.length,
        clips: CLIPS.length,
        copiedMedia: MEDIA_FILES.length,
        bytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
        songPreviewsWithoutAudio: streams.filter((entry) => entry.kind === 'song' && entry.audio === 0)
          .length,
        originalPreviewsWithAudio: streams.filter((entry) => entry.kind === 'original' && entry.audio === 1)
          .length,
        deployPerformed: false,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await build();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
