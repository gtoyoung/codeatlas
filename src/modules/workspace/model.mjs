const relationLabels = {
  imports: '가져와 사용',
  route_candidate: '호출 후보',
  declares_route: '경로를 선언',
  declares_server_function: '서버 함수를 선언',
};

function nodeDisplayMap(graph) {
  return new Map((Array.isArray(graph?.nodes) ? graph.nodes : [])
    .filter((node) => node?.id)
    .map((node) => [node.id, node.path ?? node.label ?? node.id]));
}

function displayNode(value, labels) {
  const raw = String(value ?? '');
  return labels.get(raw) ?? raw.replace(/^.*?:(?:file|route|server-function):/, '');
}

function pathOf(change) {
  return change?.newPath ?? change?.oldPath ?? null;
}

function evidenceLocation(item, fallback = null) {
  const range = item?.range ?? item?.evidence ?? fallback;
  return {
    path: range?.path ?? item?.path ?? null,
    line: Number.isInteger(range?.startLine) ? range.startLine + 1 : null,
  };
}

function changeItem(item) {
  const location = evidenceLocation(item);
  return {
    id: item.id,
    label: '코드 변경',
    text: String(item.text ?? '').split('\n')[0] || '변경 내용을 확인하세요.',
    path: location.path,
    line: location.line,
    diff: item.diff ?? null,
  };
}

function relationItem(item, edge, labels) {
  const location = evidenceLocation(item, edge?.evidence);
  const source = displayNode(edge?.source, labels);
  const target = displayNode(edge?.target, labels);
  const relation = relationLabels[edge?.kind] ?? edge?.kind ?? '연결';
  return {
    id: item.id,
    label: '영향 관계',
    text: `${source}가 ${target}를 ${relation}합니다.`,
    path: location.path,
    line: location.line,
    relation: edge?.kind ?? null,
  };
}

export function buildEvidenceGroups(scan = {}) {
  const report = scan.report ?? {};
  const graph = scan.graph ?? {};
  const evidence = Array.isArray(report.evidence) ? report.evidence : [];
  const labels = nodeDisplayMap(graph);
  const groups = [
    { key: 'recorded', label: '기록된 이유', items: [] },
    { key: 'changes', label: '코드 변경', items: [] },
    { key: 'relations', label: '영향 관계', items: [] },
    { key: 'uncertainty', label: '확인 필요', items: [] },
  ];
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const relationEdges = Array.isArray(graph.edges) ? graph.edges : [];
  const relationKinds = new Set(Object.keys(relationLabels));

  for (const item of evidence) {
    if (item?.kind === 'recorded_statement') {
      byKey.get('recorded').items.push({
        id: item.id,
        label: '기록된 이유',
        text: item.text ?? '',
        path: null,
        line: null,
      });
    } else if (item?.kind === 'git_change') {
      byKey.get('changes').items.push(changeItem(item));
    } else if (relationKinds.has(item?.kind) || String(item?.id ?? '').startsWith('relation-')) {
      const index = Number.parseInt(String(item.id).replace(/^relation-/, ''), 10) - 1;
      byKey.get('relations').items.push(relationItem(item, relationEdges[index], labels));
    } else {
      byKey.get('uncertainty').items.push({
        id: item.id,
        label: '확인 필요',
        text: item.text ?? '',
        ...evidenceLocation(item),
      });
    }
  }

  for (const [index, issue] of (Array.isArray(graph.coverage?.issues) ? graph.coverage.issues : []).entries()) {
    byKey.get('uncertainty').items.push({
      id: `coverage-${index + 1}`,
      label: '확인 필요',
      text: `${issue.path ?? '파일'} · ${issue.reason ?? '분석되지 않음'}`,
      path: issue.path ?? null,
      line: null,
    });
  }
  return groups;
}

function fallbackNarrative(scan) {
  const metadata = scan.report?.metadata;
  const title = metadata?.type === 'pull_request' ? metadata.title : metadata?.subject;
  return {
    why: title
      ? `기록된 이유는 ${metadata?.type === 'pull_request' ? 'PR' : '커밋'}에 적힌 “${title}”입니다.`
      : '기록된 이유가 없어 변경된 코드와 정적 관계를 바탕으로 확인합니다.',
    what: scan.summary?.overview ?? '변경 내용을 확인하세요.',
    impact: scan.graph?.edges?.length
      ? `정적 관계 ${scan.graph.edges.length}개를 확인했습니다. 연결된 파일의 영향은 근거 검사기에서 확인할 수 있습니다.`
      : '정적 관계를 찾지 못했습니다. 실제 실행 흐름은 확인이 필요합니다.',
    confidence: '파일 변경과 정적 관계는 코드에서 확인했고, 실행 결과와 기록 밖의 실제 의도는 확인 필요합니다.',
  };
}

function changeMetrics(changes) {
  return changes.reduce((result, change) => {
    result.files += 1;
    result.additions += Number(change.diff?.additions) || 0;
    result.deletions += Number(change.diff?.deletions) || 0;
    return result;
  }, { files: 0, additions: 0, deletions: 0 });
}

export function buildWorkspaceTimeline(scan = {}, questions = []) {
  const report = scan.report ?? {};
  const changes = Array.isArray(report.changes) ? report.changes : [];
  const evidence = Array.isArray(report.evidence) ? report.evidence : [];
  const groups = buildEvidenceGroups(scan);
  const narrative = { ...fallbackNarrative(scan), ...(scan.summary?.narrative ?? {}) };
  const metrics = changeMetrics(changes);
  const events = [
    {
      id: 'snapshot',
      kind: 'snapshot',
      title: 'Git 스냅샷',
      text: `${metrics.files}개 파일이 바뀌었습니다. 추가 ${metrics.additions}줄 · 삭제 ${metrics.deletions}줄.`,
      metrics,
      evidenceIds: evidence.filter((item) => item.kind === 'git_change').map((item) => item.id),
    },
    {
      id: 'narrative',
      kind: 'narrative',
      title: '변경 스토리',
      narrative,
      evidenceIds: groups.find((group) => group.key === 'recorded')?.items.map((item) => item.id) ?? [],
    },
    {
      id: 'impact',
      kind: 'impact',
      title: '프로젝트 영향',
      items: [...(groups.find((group) => group.key === 'relations')?.items ?? []), ...(groups.find((group) => group.key === 'uncertainty')?.items ?? [])],
      evidenceIds: groups.find((group) => group.key === 'relations')?.items.map((item) => item.id) ?? [],
    },
  ];
  const persistedQuestions = Array.isArray(questions) ? [...questions].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))) : [];
  for (const question of persistedQuestions) {
    events.push({ id: `question-${question.id}`, kind: 'question', title: '질문', question: question.question, createdAt: question.createdAt });
    events.push({ id: `answer-${question.id}`, kind: 'answer', title: '답변', answer: question.answer, questionId: question.id, createdAt: question.createdAt });
  }
  return events;
}

export function buildConversationTimeline(scan = {}, questions = []) {
  return buildWorkspaceTimeline(scan, questions)
    .filter((event) => event.kind === 'question' || event.kind === 'answer');
}
