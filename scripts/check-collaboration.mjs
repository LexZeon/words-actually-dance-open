import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message || result.stderr.trim() || 'Git check failed.');
  return result.stdout.trim();
}

try {
  // Fetch only updates remote observations; it never merges, resets or touches user files.
  git(['fetch', 'origin', '--prune']);
  const branch = git(['branch', '--show-current']);
  const head = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--short']);
  const remote = git([
    'for-each-ref',
    'refs/remotes/origin',
    '--format=%(refname:short) %(objectname) %(symref)',
  ])
    .split('\n')
    .filter(Boolean)
    .filter((row) => row.trim().split(' ').length === 2)
    .map((row) => {
      const [ref, commit] = row.trim().split(' ');
      const [ahead, behind] = git(['rev-list', '--left-right', '--count', `HEAD...${ref}`])
        .split(/\s+/)
        .map(Number);
      return { ref, commit, currentAhead: ahead, currentBehind: behind };
    });
  const record = {
    checkedAt: new Date().toISOString(),
    fetchSucceeded: true,
    branch,
    head,
    dirty: Boolean(dirty),
    remote,
  };
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'artifacts/collaboration-check.json'),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  console.log(JSON.stringify(record, null, 2));
} catch (error) {
  console.error(`Collaborator update check failed: ${error.message}. Remote freshness remains unconfirmed.`);
  process.exitCode = 1;
}
