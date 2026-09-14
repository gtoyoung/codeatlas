import { randomUUID } from 'node:crypto';

import { analyzeSources } from '../analysis/analyze-sources.mjs';
import { loadCommitSnapshot } from '../snapshot/commit-sources.mjs';
import { scanWorkingTree } from '../snapshot/working-tree.mjs';

export function buildEvidence(report, graph) {
  const changes = report.changes.map((change, index) => ({
    id: `change-${index + 1}`,
    kind: 'git_change',
    path: change.newPath ?? change.oldPath,
    text: `${change.status}: ${change.oldPath ?? '∅'} → ${change.newPath ?? '∅'}`,
  }));
  const relations = graph.edges.map((edge, index) => ({
    id: `relation-${index + 1}`,
    kind: edge.kind,
    path: edge.evidence.path,
    text: `${edge.source} ${edge.kind} ${edge.target}`,
    range: edge.evidence,
  }));
  return [...changes, ...relations];
}

export async function analyzeAndSaveRepository({ store, llm, repository, kind, ref = 'HEAD' }) {
  const sourceSnapshot = kind === 'working_tree'
    ? await scanWorkingTree(repository.path, { includeUntracked: true })
    : await loadCommitSnapshot(repository.path, ref);
  const snapshotId = randomUUID();
  const graph = analyzeSources({ snapshotId, files: sourceSnapshot.files });
  const evidence = buildEvidence(sourceSnapshot, graph);
  const summary = await llm.summarize({
    changes: sourceSnapshot.changes,
    graph,
    evidence,
  });
  const report = {
    ...sourceSnapshot,
    files: sourceSnapshot.files.map(({ content: _content, ...file }) => file),
    evidence,
  };

  return store.saveScan({
    repositoryId: repository.id,
    kind: sourceSnapshot.kind,
    targetOid: sourceSnapshot.targetOid ?? null,
    baseOid: sourceSnapshot.baseOid,
    manifestHash: sourceSnapshot.manifestHash,
    report,
    graph,
    summary,
  });
}
