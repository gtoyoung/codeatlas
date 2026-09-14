import { git } from './git.mjs';

const decoder = new TextDecoder('utf-8');
const maxPatchChars = 64 * 1024;
const unifiedContextLines = 60;

function decodePatch(raw) {
  return decoder.decode(raw);
}

function changedPaths(change) {
  return [...new Set([change.oldPath, change.newPath].filter((path) => typeof path === 'string' && path.length > 0))];
}

function untrackedPatch(path, content) {
  if (typeof content !== 'string') return '';
  const normalizedPath = path.replaceAll('\\', '/');
  const lines = content.length === 0 ? [] : content.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const body = lines.map((line) => `+${line}`).join('\n');
  const lineCount = lines.length;
  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${normalizedPath}`,
    `@@ -0,0 +1,${lineCount} @@`,
    body,
    '',
  ].join('\n');
}

function summarizePatch(patch) {
  const additions = patch.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
  const deletions = patch.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).length;
  const binary = /Binary files .* differ/.test(patch);
  const truncated = patch.length > maxPatchChars;
  const value = truncated
    ? `${patch.slice(0, maxPatchChars)}\n… [diff truncated]`
    : patch;
  return {
    status: !patch ? 'unavailable' : binary ? 'binary' : 'available',
    patch: patch ? value : null,
    additions,
    deletions,
    truncated,
  };
}

async function readPatch(repo, { baseOid, targetOid, paths }) {
  if (paths.length === 0) return '';
  const args = targetOid
    ? baseOid
      ? ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--binary', `--unified=${unifiedContextLines}`, baseOid, targetOid]
      : ['diff-tree', '--root', '--no-commit-id', '-p', '--no-ext-diff', '--no-textconv', '--no-color', '--binary', `--unified=${unifiedContextLines}`, targetOid]
    : baseOid
      ? ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--binary', `--unified=${unifiedContextLines}`, baseOid]
      : null;
  if (!args) return '';
  const output = await git(repo, [...args, '--', ...paths]);
  return decodePatch(output);
}

/** Attach bounded, line-level Git patches without changing the checkout or index. */
export async function attachDiffs(repo, changes, {
  baseOid = null,
  targetOid = null,
  workingTreeFiles = [],
} = {}) {
  const currentFiles = new Map(workingTreeFiles.map((file) => [file.path, file.content]));
  return Promise.all(changes.map(async (change) => {
    const paths = changedPaths(change);
    let patch = await readPatch(repo, { baseOid, targetOid, paths });
    if (!patch && change.status?.startsWith('?') && change.newPath) {
      patch = untrackedPatch(change.newPath, currentFiles.get(change.newPath));
    }
    return { ...change, diff: summarizePatch(patch) };
  }));
}
