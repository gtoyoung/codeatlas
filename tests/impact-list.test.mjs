import test from 'node:test';
import assert from 'node:assert/strict';

import { buildImpactList } from '../src/modules/analysis/impact-list.mjs';

const graph = {
  nodes: [
    { id: 'file:a', kind: 'file', label: 'src/a.ts', path: 'src/a.ts' },
    { id: 'file:b', kind: 'file', label: 'src/b.ts', path: 'src/b.ts' },
    { id: 'file:route', kind: 'file', label: 'src/app/api/chat/route.ts', path: 'src/app/api/chat/route.ts' },
    { id: 'route:chat', kind: 'route', label: '/api/chat', path: 'src/app/api/chat/route.ts' },
  ],
  edges: [
    { id: 'import', source: 'file:a', target: 'file:b', kind: 'imports', evidence: { path: 'src/a.ts', startLine: 0 } },
    { id: 'route', source: 'file:a', target: 'route:chat', kind: 'route_candidate', evidence: { path: 'src/a.ts', startLine: 4 } },
    { id: 'declare', source: 'file:route', target: 'route:chat', kind: 'declares_route', evidence: { path: 'src/app/api/chat/route.ts', startLine: 0 } },
  ],
};

test('변경 파일이 사용하는 코드와 API 경로를 확인 목록으로 만든다', () => {
  const impacts = buildImpactList({
    changes: [{ status: 'M', oldPath: 'src/a.ts', newPath: 'src/a.ts' }],
    graph,
  });

  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].changedPath, 'src/a.ts');
  assert.deepEqual(impacts[0].relations.map((relation) => relation.label), ['src/b.ts', '/api/chat']);
  assert.deepEqual(impacts[0].relations.map((relation) => relation.reason), ['직접 가져와 사용', 'API 호출 후보']);
  assert.equal(impacts[0].relations[1].evidenceLine, 5);
});

test('변경 파일을 사용하는 상위 파일도 역방향 영향 후보로 보여준다', () => {
  const impacts = buildImpactList({
    changes: [{ status: 'M', oldPath: 'src/b.ts', newPath: 'src/b.ts' }],
    graph,
  });

  assert.equal(impacts[0].relations[0].label, 'src/a.ts');
  assert.equal(impacts[0].relations[0].reason, '이 파일을 직접 사용');
});

test('관계를 찾지 못한 변경도 숨기지 않는다', () => {
  const impacts = buildImpactList({
    changes: [{ status: 'A', oldPath: null, newPath: 'src/alone.ts' }],
    graph,
  });

  assert.equal(impacts[0].relations.length, 0);
  assert.equal(impacts[0].status, 'A');
});

test('변경된 API 경로를 호출하는 파일까지 영향 후보로 연결한다', () => {
  const impacts = buildImpactList({
    changes: [{ status: 'M', oldPath: 'src/app/api/chat/route.ts', newPath: 'src/app/api/chat/route.ts' }],
    graph,
  });

  assert.ok(impacts[0].relations.some((relation) => relation.label === '/api/chat' && relation.reason === 'Next.js 경로 선언'));
  assert.ok(impacts[0].relations.some((relation) => relation.label === 'src/a.ts' && relation.reason === '이 API를 호출할 가능성'));
});
