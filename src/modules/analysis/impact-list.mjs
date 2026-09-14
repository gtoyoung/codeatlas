const outgoingReasons = {
  imports: '직접 가져와 사용',
  route_candidate: 'API 호출 후보',
  declares_route: 'Next.js 경로 선언',
  declares_server_function: '서버 함수 선언',
};

const incomingReasons = {
  imports: '이 파일을 직접 사용',
  route_candidate: '이 경로를 호출할 가능성',
};

function normalize(path) {
  return path?.replaceAll('\\', '/') ?? null;
}

function toRelation(edge, node, reason, direction) {
  return {
    id: `${edge.id}:${direction}:${node.id}`,
    label: node.label,
    path: node.path ?? null,
    kind: edge.kind,
    direction,
    reason,
    evidencePath: edge.evidence?.path ?? null,
    evidenceLine: Number.isInteger(edge.evidence?.startLine) ? edge.evidence.startLine + 1 : null,
  };
}

export function buildImpactList({ changes, graph, maxRelationsPerFile = 8 }) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const fileNodesByPath = new Map(
    graph.nodes
      .filter((node) => node.kind === 'file' && node.path)
      .map((node) => [normalize(node.path), node]),
  );

  return changes.map((change) => {
    const changedPath = normalize(change.newPath ?? change.oldPath);
    const changedNode = fileNodesByPath.get(changedPath);
    const relations = [];
    const routeIds = new Set();

    if (changedNode) {
      for (const edge of graph.edges) {
        if (edge.source === changedNode.id) {
          const target = nodes.get(edge.target);
          const reason = outgoingReasons[edge.kind];
          if (target && reason) relations.push(toRelation(edge, target, reason, 'outgoing'));
          if (edge.kind === 'declares_route') routeIds.add(edge.target);
        } else if (edge.target === changedNode.id) {
          const source = nodes.get(edge.source);
          const reason = incomingReasons[edge.kind];
          if (source && reason) relations.push(toRelation(edge, source, reason, 'incoming'));
        }
      }

      for (const edge of graph.edges) {
        if (edge.kind !== 'route_candidate' || !routeIds.has(edge.target)) continue;
        const caller = nodes.get(edge.source);
        if (caller) relations.push(toRelation(edge, caller, '이 API를 호출할 가능성', 'incoming'));
      }
    }

    const unique = [...new Map(relations.map((relation) => (
      [`${relation.label}:${relation.reason}`, relation]
    ))).values()].slice(0, maxRelationsPerFile);

    return {
      status: change.status,
      changedPath,
      previousPath: normalize(change.oldPath),
      relations: unique,
    };
  });
}
