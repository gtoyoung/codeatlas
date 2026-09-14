import { createHash } from 'node:crypto';

import { git, resolveCommit } from '../repository/git.mjs';
import { attachDiffs } from '../repository/diff.mjs';
import { parseChanges, parseTree } from '../repository/inventory.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true });
const maxTextBytes = 2 * 1024 * 1024;

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function oidFor(repo, ref, label) {
  try {
    return /^[a-f0-9]{7,}$/i.test(String(ref ?? ''))
      ? await resolveCommit(repo, ref)
      : await resolveCommit(repo, ref);
  } catch (cause) {
    const error = new Error('PR_OBJECTS_MISSING', { cause });
    error.code = 'PR_OBJECTS_MISSING';
    error.ref = label;
    throw error;
  }
}

async function loadFiles(repo, treeOutput) {
  const entries = parseTree(treeOutput);
  const files = [];
  for (const entry of entries) {
    if (entry.objectType !== 'blob') {
      files.push({ ...entry, state: 'excluded', reason: 'not_a_blob', content: null });
      continue;
    }
    const bytes = await git(repo, ['cat-file', 'blob', entry.oid]);
    if (bytes.length > maxTextBytes || bytes.includes(0)) {
      files.push({ ...entry, state: 'excluded', reason: 'binary_or_too_large', content: null });
      continue;
    }
    try {
      files.push({ ...entry, state: 'indexed', reason: null, content: decoder.decode(bytes) });
    } catch {
      files.push({ ...entry, state: 'excluded', reason: 'text_encoding_unsupported', content: null });
    }
  }
  return files;
}

/**
 * Reads a base..head range from Git objects without changing checkout or index.
 * PR refs can be passed directly, or callers may pass already resolved OIDs.
 */
export async function loadRangeSnapshot(repo, {
  baseRef = null,
  headRef = null,
  baseOid: requestedBaseOid = null,
  headOid: requestedHeadOid = null,
  metadata = null,
} = {}) {
  if (!baseRef && !requestedBaseOid) throw new Error('PR_OBJECTS_MISSING');
  if (!headRef && !requestedHeadOid) throw new Error('PR_OBJECTS_MISSING');
  // Resolve sequentially so a missing ref cannot leave a second Git process
  // running while the caller begins cleanup (notably on Windows).
  const baseOid = requestedBaseOid
    ? await oidFor(repo, requestedBaseOid, 'base')
    : await oidFor(repo, baseRef, 'base');
  const targetOid = requestedHeadOid
    ? await oidFor(repo, requestedHeadOid, 'head')
    : await oidFor(repo, headRef, 'head');
  const [treeOutput, diffOutput] = await Promise.all([
    git(repo, ['ls-tree', '-r', '-z', '--full-tree', targetOid]),
    git(repo, [
      'diff-tree', '--no-commit-id', '--raw', '-r', '-z', '--no-abbrev',
      '--no-ext-diff', '--no-textconv', '-M', baseOid, targetOid,
    ]),
  ]);
  const files = await loadFiles(repo, treeOutput);
  const rawChanges = parseChanges(diffOutput).map((entry) => ({
    ...entry,
    state: 'explicitly_unexplained',
    reason: 'pending_analysis',
  }));
  const changes = await attachDiffs(repo, rawChanges, { baseOid, targetOid });
  const manifestHash = hash(JSON.stringify({
    baseOid,
    targetOid,
    files: files.map(({ path, oid, state }) => ({ path, oid, state })),
    changes,
  }));
  return {
    schemaVersion: '1.0',
    kind: 'pull_request',
    baseOid,
    targetOid,
    files,
    changes,
    metadata,
    counts: { files: files.length, changes: changes.length, unexplained: changes.length },
    manifestHash,
    coverage: {
      totalFiles: files.length,
      indexedFiles: files.filter((file) => file.state === 'indexed').length,
      excludedFiles: files.filter((file) => file.state === 'excluded').length,
    },
  };
}
