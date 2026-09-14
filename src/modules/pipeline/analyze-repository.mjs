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
  const context = report.metadata ?? report.context ?? null;
  const recorded = [];
  if (context?.type === 'commit') {
    recorded.push({
      id: 'context-commit',
      kind: 'recorded_statement',
      path: null,
      text: `커밋 메시지: ${context.subject || '(메시지 없음)'}${context.body ? `\n${context.body}` : ''}`,
    });
  }
  if (context?.type === 'pull_request') {
    recorded.push({
      id: 'context-pr',
      kind: 'recorded_statement',
      path: null,
      text: `PR #${context.number ?? '?'} 제목: ${context.title || '(제목 없음)'}${context.description ? `\n${context.description}` : ''}`,
    });
    for (const [kind, values] of [['comment', context.comments], ['review', context.reviews], ['update', context.updates]]) {
      for (const [index, value] of (Array.isArray(values) ? values : []).entries()) {
        const text = typeof value === 'string' ? value : value?.body ?? value?.message ?? value?.comment ?? value?.content;
        if (text) recorded.push({ id: `context-${kind}-${index + 1}`, kind: 'recorded_statement', path: null, text: `${kind}: ${text}` });
      }
    }
  }
  return [...recorded, ...changes, ...relations];
}

export async function analyzeAndSaveRepository({ store, llm, repository, kind, ref = 'HEAD', snapshot = null }) {
  const sourceSnapshot = snapshot ?? (kind === 'working_tree'
    ? await scanWorkingTree(repository.path, { includeUntracked: true })
    : await loadCommitSnapshot(repository.path, ref));
  const snapshotId = randomUUID();
  const graph = analyzeSources({ snapshotId, files: sourceSnapshot.files });
  const evidence = buildEvidence(sourceSnapshot, graph);
  const summary = await llm.summarize({
    changes: sourceSnapshot.changes,
    graph,
    evidence,
    context: sourceSnapshot.metadata ?? null,
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
