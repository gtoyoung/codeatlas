import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEvidenceGroups, buildWorkspaceTimeline } from '../src/modules/workspace/model.mjs';

const scan = {
  id: 'scan-1',
  kind: 'commit',
  targetOid: 'abc123456',
  report: {
    changes: [{ status: 'M', oldPath: 'src/replies.ts', newPath: 'src/replies.ts', diff: { status: 'available', additions: 2, deletions: 1, patch: '+return reply;' } }],
    evidence: [
      { id: 'context-commit', kind: 'recorded_statement', text: '커밋 메시지: prevent duplicates' },
      { id: 'change-1', kind: 'git_change', path: 'src/replies.ts', text: 'M: src/replies.ts' },
      { id: 'relation-1', kind: 'imports', path: 'src/routes.ts', text: 'snapshot:file:src/routes.ts imports snapshot:file:src/replies.ts', range: { path: 'src/routes.ts', startLine: 4 } },
    ],
  },
  summary: {
    title: '커밋 · prevent duplicates',
    overview: '답글 중복을 막는 변경입니다.',
    mode: 'deterministic',
    narrative: {
      why: '기록된 이유는 중복 답글을 막기 위해서입니다.',
      what: 'src/replies.ts의 응답 처리를 바꿨습니다.',
      impact: '라우트에서 답글 처리로 연결됩니다.',
      confidence: '코드에서 확인했고 실행 결과는 확인 필요합니다.',
    },
  },
  graph: {
    nodes: [
      { id: 'snapshot:file:src/routes.ts', path: 'src/routes.ts', label: 'src/routes.ts' },
      { id: 'snapshot:file:src/replies.ts', path: 'src/replies.ts', label: 'src/replies.ts' },
    ],
    edges: [{ id: 'edge-1', source: 'snapshot:file:src/routes.ts', target: 'snapshot:file:src/replies.ts', kind: 'imports', evidence: { path: 'src/routes.ts', startLine: 4 } }],
    coverage: { issues: [{ path: 'src/dynamic.ts', reason: 'unresolved_route_candidate' }] },
  },
};

test('분석 타임라인은 스냅샷·스토리·영향·질문 순서로 만든다', () => {
  const timeline = buildWorkspaceTimeline(scan, [{
    id: 'question-1',
    question: '왜 바뀌었나?',
    answer: { answer: '중복을 막기 위한 변경입니다.', sections: [{ key: 'recorded', label: '기록된 맥락', text: '커밋 기록', citations: ['context-commit'] }] },
    createdAt: '2026-09-15T00:00:00.000Z',
  }]);

  assert.deepEqual(timeline.map((event) => event.kind), ['snapshot', 'narrative', 'impact', 'question', 'answer']);
  assert.equal(timeline[1].narrative.why, scan.summary.narrative.why);
  assert.equal(timeline[3].question, '왜 바뀌었나?');
  assert.equal(timeline[4].answer.answer, '중복을 막기 위한 변경입니다.');
});

test('근거 검사기는 기록·변경·관계·확인을 분리하고 내부 ID를 숨긴다', () => {
  const groups = buildEvidenceGroups(scan);

  assert.deepEqual(groups.map((group) => group.key), ['recorded', 'changes', 'relations', 'uncertainty']);
  assert.equal(groups[0].items[0].label, '기록된 이유');
  assert.equal(groups[1].items[0].path, 'src/replies.ts');
  assert.match(groups[2].items[0].text, /src\/routes\.ts.*src\/replies\.ts/);
  assert.doesNotMatch(groups[2].items[0].text, /snapshot:file/);
  assert.match(groups[3].items[0].text, /src\/dynamic\.ts/);
});
