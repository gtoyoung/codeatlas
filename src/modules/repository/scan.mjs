import { git, resolveCommit } from './git.mjs';
import { parseChanges, parseTree } from './inventory.mjs';

export async function scanCommit(repo, ref) {
  const targetOid = await resolveCommit(repo, ref);
  const parentsOutput = await git(repo, [
    'rev-list', '--parents', '-n', '1', targetOid,
  ]);
  const parents = parentsOutput.toString('ascii').trim().split(' ').slice(1);
  const baseOid = parents[0] ?? null;

  const treeOutput = await git(repo, [
    'ls-tree', '-r', '-z', '--full-tree', targetOid,
  ]);
  const diffArgs = [
    'diff-tree', '--no-commit-id', '--raw', '-r', '-z', '--no-abbrev',
    '--no-ext-diff', '--no-textconv', '-M',
  ];
  const changesOutput = baseOid
    ? await git(repo, [...diffArgs, baseOid, targetOid])
    : await git(repo, [...diffArgs, '--root', targetOid]);

  const files = parseTree(treeOutput);
  const changes = parseChanges(changesOutput).map((entry) => ({
    ...entry,
    state: 'explicitly_unexplained',
    reason: 'pending_analysis',
  }));

  return {
    schemaVersion: '1.0',
    targetOid,
    baseOid,
    files,
    changes,
    counts: {
      files: files.length,
      changes: changes.length,
      unexplained: changes.length,
    },
  };
}
