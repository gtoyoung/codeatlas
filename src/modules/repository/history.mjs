import { git, resolveCommit } from './git.mjs';
import { parseChanges } from './inventory.mjs';

const decoder = new TextDecoder('utf-8', { fatal: false });
const FIELD = '\0';
const RECORD = '\x1e';

function parseRefs(raw) {
  const values = decoder.decode(raw).split(FIELD);
  const refs = new Map();
  for (let index = 0; index + 1 < values.length; index += 2) {
    const ref = values[index].trim();
    const oid = values[index + 1].trim();
    if (!ref || !/^[a-f0-9]+$/.test(oid)) continue;
    const current = refs.get(oid) ?? [];
    current.push(ref);
    refs.set(oid, current);
  }
  return refs;
}

function parseLog(raw) {
  return decoder.decode(raw).split(RECORD).filter((record) => record.trim()).map((rawRecord) => {
    const record = rawRecord.replace(/^\s+/, '');
    const fields = record.split(FIELD);
    if (fields.length < 10) throw new Error('INVALID_COMMIT_RECORD');
    const [oid, parents, authorName, authorEmail, authoredAt, committerName, committerEmail, committedAt, subject, body] = fields;
    if (!/^[a-f0-9]+$/.test(oid)) throw new Error('INVALID_COMMIT_RECORD');
    return {
      oid,
      parentOids: parents ? parents.split(' ').filter(Boolean) : [],
      author: { name: authorName, email: authorEmail },
      authoredAt,
      committer: { name: committerName, email: committerEmail },
      committedAt,
      subject,
      body: (body ?? '').trim(),
    };
  });
}

async function commitChanges(repo, commit) {
  const args = [
    'diff-tree', '--no-commit-id', '--raw', '-r', '-z', '--no-abbrev',
    '--no-ext-diff', '--no-textconv', '-M',
  ];
  if (commit.parentOids[0]) args.push(commit.parentOids[0], commit.oid);
  else args.push('--root', commit.oid);
  return parseChanges(await git(repo, args));
}

export async function listCommitHistory(repo, { limit = 50, query = '' } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
  const [logRaw, refsRaw, shallowRaw, headRaw] = await Promise.all([
    git(repo, [
      'log', '--all', '--topo-order', '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%b%x1e',
    ]),
    git(repo, ['for-each-ref', 'refs/heads', 'refs/remotes', 'refs/tags', '--format=%(refname)%00%(objectname)%00']),
    git(repo, ['rev-parse', '--is-shallow-repository']),
    git(repo, ['rev-parse', '--verify', 'HEAD']),
  ]);
  const refs = parseRefs(refsRaw);
  const headOid = headRaw.toString('ascii').trim();
  if (/^[a-f0-9]+$/.test(headOid)) refs.set(headOid, [...(refs.get(headOid) ?? []), 'refs/HEAD']);
  const term = String(query ?? '').trim().toLocaleLowerCase();
  const matched = parseLog(logRaw).filter((commit) => (
    !term || `${commit.subject}\n${commit.body}\n${commit.author.name}`.toLocaleLowerCase().includes(term)
  ));
  const candidates = matched.slice(0, safeLimit);
  const commits = [];
  for (const commit of candidates) {
    commits.push({
      ...commit,
      refs: refs.get(commit.oid) ?? [],
      changedFiles: (await commitChanges(repo, commit)).map((change) => ({
        ...change,
        path: change.newPath ?? change.oldPath,
      })),
    });
  }
  return {
    commits,
    totalMatched: matched.length,
    complete: shallowRaw.toString('utf8').trim() !== 'true',
    truncated: matched.length > candidates.length,
  };
}

export async function getCommitMetadata(repo, ref) {
  const oid = await resolveCommit(repo, ref);
  const raw = await git(repo, [
    'show', '-s', '--format=%H%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%b', oid,
  ]);
  const fields = decoder.decode(raw).split('\0');
  const [resolvedOid, authorName, authorEmail, authoredAt, committerName, committerEmail, committedAt, subject, body] = fields;
  return {
    type: 'commit',
    oid: resolvedOid,
    subject: subject ?? '',
    body: (body ?? '').trim(),
    author: { name: authorName ?? '', email: authorEmail ?? '' },
    committer: { name: committerName ?? '', email: committerEmail ?? '' },
    authoredAt: authoredAt ?? null,
    committedAt: committedAt ?? null,
  };
}
