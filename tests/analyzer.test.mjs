import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeSources } from '../src/modules/analysis/analyze-sources.mjs';

test('TypeScript 심벌과 Next.js 경로 관계를 코드 근거와 함께 만든다', () => {
  const graph = analyzeSources({
    snapshotId: 'snapshot-1',
    files: [
      { path: 'app/page.tsx', content: "import { Widget } from '../components/Widget';\nexport default function Page(){ return <Widget/> }", oid: '1' },
      { path: 'components/Widget.tsx', content: "export function Widget(){ return fetch('/api/chat') }", oid: '2' },
      { path: 'app/api/chat/route.ts', content: "export async function POST(){ return Response.json({ok:true}) }", oid: '3' },
      { path: 'app/actions.ts', content: "'use server';\nexport async function save(){ return true }", oid: '4' },
    ],
  });

  assert.equal(graph.coverage.totalFiles, 4);
  assert.equal(graph.coverage.failedFiles, 0);
  assert.ok(graph.nodes.some((node) => node.kind === 'route' && node.label === '/api/chat'));
  assert.ok(graph.nodes.some((node) => node.kind === 'server_function' && node.label === 'save'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'imports' && edge.evidence.path === 'app/page.tsx'));
  assert.ok(graph.edges.some((edge) => edge.kind === 'route_candidate' && edge.evidence.path === 'components/Widget.tsx'));
});

test('해석 실패 파일을 0개의 관계로 숨기지 않는다', () => {
  const graph = analyzeSources({
    snapshotId: 'snapshot-2',
    files: [{ path: 'broken.ts', content: 'export const =', oid: 'bad' }],
  });

  assert.equal(graph.coverage.totalFiles, 1);
  assert.equal(graph.coverage.partialFiles, 1);
  assert.ok(graph.coverage.issues.some((issue) => issue.path === 'broken.ts'));
});

test('지원하지 않는 텍스트 파일은 분석 대상에서 제외하고 사유를 기록한다', () => {
  const graph = analyzeSources({
    snapshotId: 'snapshot-3',
    files: [
      { path: 'src/value.ts', content: 'export const value = 1', oid: 'source' },
      { path: 'README.md', content: '# 문서', oid: 'document' },
    ],
  });

  assert.equal(graph.coverage.totalFiles, 2);
  assert.equal(graph.coverage.indexedFiles, 1);
  assert.equal(graph.coverage.excludedFiles, 1);
  assert.ok(graph.coverage.issues.some((issue) => issue.path === 'README.md' && issue.reason === 'unsupported_file_type'));
  assert.ok(!graph.nodes.some((node) => node.path === 'README.md'));
});
