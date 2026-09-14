import { resolveCommit } from '../../repository/git.mjs';

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
