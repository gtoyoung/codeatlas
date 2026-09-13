import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { git, resolveCommit } from '../repository/git.mjs';
import { parseChanges } from '../repository/inventory.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true });
const maxTextBytes = 2 * 1024 * 1024;

function decodePaths(raw) {
  try {
    return decoder.decode(raw).split('\0').filter(Boolean);
  } catch {
    throw new Error('PATH_ENCODING_UNSUPPORTED');
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function capture(repo, includeUntracked) {
  const root = resolve(repo);
  const beforeStatus = await git(root, [
    'status', '--porcelain=v1', '-z',
    includeUntracked ? '--untracked-files=all' : '--untracked-files=no',
  ]);
  const baseOid = await resolveCommit(root, 'HEAD');
  const tracked = decodePaths(await git(root, ['ls-files', '-z', '--cached']));
  const untracked = includeUntracked
    ? decodePaths(await git(root, ['ls-files', '-z', '--others', '--exclude-standard']))
    : [];
  const paths = [...new Set([...tracked, ...untracked])].sort();
  const files = [];

  for (const path of paths) {
    const absolutePath = resolve(root, path);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
      throw new Error('PATH_OUTSIDE_REPOSITORY');
    }

    let stat;
    try {
      stat = await lstat(absolutePath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;

    const bytes = await readFile(absolutePath);
    const contentHash = hash(bytes);
    const isText = bytes.length <= maxTextBytes && !bytes.includes(0);
    files.push({
      path,
      oid: null,
      contentHash,
      size: bytes.length,
      state: isText ? 'indexed' : 'excluded',
      reason: isText ? null : 'binary_or_too_large',
      content: isText ? decoder.decode(bytes) : null,
    });
  }

  const trackedChanges = parseChanges(await git(root, [
    'diff', '--raw', '-z', '--no-abbrev', '--no-ext-diff', '--no-textconv', 'HEAD', '--',
  ]));
  const untrackedChanges = untracked.map((path) => ({
    status: '?',
    oldMode: null,
    newMode: null,
    oldOid: null,
    newOid: null,
    oldPath: null,
    newPath: path,
  }));
  const afterStatus = await git(root, [
    'status', '--porcelain=v1', '-z',
    includeUntracked ? '--untracked-files=all' : '--untracked-files=no',
  ]);

  if (!beforeStatus.equals(afterStatus)) return null;

  const manifestHash = hash(JSON.stringify({
    baseOid,
    status: beforeStatus.toString('base64'),
    files: files.map(({ path, contentHash, state }) => ({ path, contentHash, state })),
  }));

  return {
    schemaVersion: '1.0',
    kind: 'working_tree',
    baseOid,
    manifestHash,
    files,
    changes: [...trackedChanges, ...untrackedChanges],
    coverage: {
      totalFiles: files.length,
      indexedFiles: files.filter((file) => file.state === 'indexed').length,
      excludedFiles: files.filter((file) => file.state === 'excluded').length,
    },
  };
}

export async function scanWorkingTree(repo, { includeUntracked = true } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await capture(repo, includeUntracked);
    if (snapshot) return snapshot;
  }
  throw new Error('SNAPSHOT_UNSTABLE');
}
