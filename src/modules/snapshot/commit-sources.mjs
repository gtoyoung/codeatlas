import { git } from '../repository/git.mjs';
import { getCommitMetadata } from '../repository/history.mjs';
import { scanCommit } from '../repository/scan.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true });
const maxTextBytes = 2 * 1024 * 1024;

export async function loadCommitSnapshot(repo, ref) {
  const ledger = await scanCommit(repo, ref);
  const files = [];

  for (const entry of ledger.files) {
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

  return {
    ...ledger,
    kind: 'commit',
    metadata: await getCommitMetadata(repo, ledger.targetOid),
    manifestHash: ledger.targetOid,
    files,
    coverage: {
      totalFiles: files.length,
      indexedFiles: files.filter((file) => file.state === 'indexed').length,
      excludedFiles: files.filter((file) => file.state === 'excluded').length,
    },
  };
}
