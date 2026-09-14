'use client';

import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

type GraphNode = { id: string; kind: string; label: string; path?: string };
type GraphEdge = { id: string; source: string; target: string; kind: string };

const colors: Record<string, string> = {
  route: '#3973e6',
  server_function: '#f06a4d',
  file: '#243b62',
};

export default function GraphView({ graph }: { graph: { nodes: GraphNode[]; edges: GraphEdge[] } }) {
  const visible = graph.nodes.slice(0, 80);
  const visibleIds = new Set(visible.map((node) => node.id));
  const nodes: Node[] = visible.map((node, index) => ({
    id: node.id,
    data: { label: node.label },
    position: { x: (index % 4) * 245, y: Math.floor(index / 4) * 110 },
    style: {
      background: colors[node.kind] ?? '#485c7a',
      border: '1px solid rgba(255,255,255,.24)',
      borderRadius: 8,
      color: '#fff',
      fontFamily: 'Cascadia Mono, monospace',
      fontSize: 11,
      padding: 10,
      width: 210,
    },
  }));
  const edges: Edge[] = graph.edges
    .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.kind.replaceAll('_', ' '),
      style: { stroke: '#8294b2' },
      labelStyle: { fill: '#526681', fontSize: 10 },
    }));

  if (nodes.length === 0) {
    return <div className="empty-state">표시할 정적 관계가 없습니다.</div>;
  }

  return (
    <div className="graph-canvas" aria-label="코드 관계 그래프">
      <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.2} maxZoom={1.6} nodesDraggable={false}>
        <Background color="#cbd5e1" gap={22} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
