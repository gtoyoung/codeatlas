import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { git, resolveCommit } from '../../repository/git.mjs';

async function readRef(repo, ref) {
  try {
    return { ref, available: true, oid: await resolveCommit(repo, ref) };
  } catch {
    return { ref, available: false, oid: null };
  }
}

export async function inspectPullRequestRefs(repo, number) {
  const normalized = String(number ?? '');
  if (!/^\d+$/.test(normalized) || Number(normalized) < 1) throw new Error('INVALID_PULL_REQUEST_NUMBER');
  const prefix = `refs/pulls/${normalized}`;
  const [base, head, merge] = await Promise.all([
    readRef(repo, `${prefix}/base`),
    readRef(repo, `${prefix}/head`),
    readRef(repo, `${prefix}/merge`),
  ]);
  return { number: Number(normalized), base, head, merge };
}

function cacheKey(remoteUrl) {
  return createHash('sha256').update(remoteUrl).digest('hex').slice(0, 24);
}

/**
 * Returns a repository containing OneDev's PR refs. The user's checkout is
 * reused when refs already exist; otherwise a bare cache is fetched without
 * changing its index, worktree, or refs.
 */
export async function ensurePullRequestRefs(repo, number, { cacheRoot = '.data/git-cache' } = {}) {
  const localRefs = await inspectPullRequestRefs(repo, number);
  if (localRefs.base.available && localRefs.head.available) {
    return { repoPath: repo, refs: localRefs, cached: false };
  }
  let remoteUrl;
  try {
    remoteUrl = (await git(repo, ['remote', 'get-url', 'origin'])).toString('utf8').trim();
  } catch (cause) {
    const error = new Error('PR_REMOTE_MISSING', { cause });
    error.code = 'PR_REMOTE_MISSING';
    throw error;
  }
  if (!remoteUrl) throw new Error('PR_REMOTE_MISSING');
  const root = resolve(/* turbopackIgnore: true */ cacheRoot);
  const cachePath = resolve(root, cacheKey(remoteUrl));
  await mkdir(cachePath, { recursive: true });
  try {
    await git(cachePath, ['init', '--bare', '--quiet']);
  } catch (cause) {
    const error = new Error('PR_CACHE_INIT_FAILED', { cause });
    error.code = 'PR_CACHE_INIT_FAILED';
    throw error;
  }
  const prefix = `refs/pulls/${Number(number)}`;
  for (const name of ['base', 'head', 'merge']) {
    try {
      await git(cachePath, [
        'fetch', '--no-tags', '--no-write-fetch-head', remoteUrl,
        `+${prefix}/${name}:${prefix}/${name}`,
      ]);
    } catch {
      // OneDev may not expose merge until the PR is mergeable. Base/head are
      // checked below and produce the actionable error if either is absent.
    }
  }
  const refs = await inspectPullRequestRefs(cachePath, number);
  if (!refs.base.available || !refs.head.available) {
    const error = new Error('PR_OBJECTS_MISSING');
    error.code = 'PR_OBJECTS_MISSING';
    throw error;
  }
  return { repoPath: cachePath, refs, cached: true };
}
