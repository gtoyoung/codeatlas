import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAnswerSections, buildNarrativeSummary, createLlmClient, validateCitedAnswer } from '../src/modules/llm/client.mjs';

test('API 설정이 없으면 외부 호출 없이 근거 기반 로컬 요약을 반환한다', async () => {
  const client = createLlmClient({}, () => { throw new Error('must not call'); });
  const result = await client.summarize({ changes: [{ status: 'M', newPath: 'app/page.tsx' }], graph: { edges: [] } });

  assert.equal(result.mode, 'deterministic');
  assert.match(result.title, /1개/);
});

test('OpenAI 응답의 허용되지 않은 근거 ID를 차단한다', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ output_text: JSON.stringify({ answer: '변경됨', citations: ['invented'] }) }),
  });
  const client = createLlmClient({ OPENAI_API_KEY: 'key', OPENAI_MODEL: 'model' }, fakeFetch);
  const result = await client.answer({ question: '무엇이 바뀌었나?', evidence: [{ id: 'e1', text: 'page changed' }] });

  assert.equal(result.support, 'unsupported');
  assert.deepEqual(result.citations, []);
});

test('모든 인용이 허용된 답변만 supported로 표시한다', () => {
  assert.deepEqual(
    validateCitedAnswer({ answer: '페이지가 변경됐다.', citations: ['e1'] }, new Set(['e1'])),
    { answer: '페이지가 변경됐다.', citations: ['e1'], support: 'supported' },
  );
});

test('구조화된 답변은 섹션과 허용된 인용만 보존한다', () => {
  const sections = buildAnswerSections({
    answer: '변경 목적을 확인했습니다.',
    sections: [
      { type: 'recorded', title: '기록된 맥락', text: '커밋 메시지에 적힌 내용입니다.', citations: ['context-1', 'invented'] },
      { type: 'code', title: '코드 근거', text: 'API 호출 코드가 추가되었습니다.', citations: ['relation-1'] },
    ],
  }, new Set(['context-1', 'relation-1']));

  assert.deepEqual(sections, [
    { key: 'recorded', label: '기록된 맥락', text: '커밋 메시지에 적힌 내용입니다.', citations: ['context-1'] },
    { key: 'code', label: '코드 근거', text: 'API 호출 코드가 추가되었습니다.', citations: ['relation-1'] },
  ]);
});

test('구조화된 항목 목록은 화면용 목록으로 보존한다', () => {
  const sections = buildAnswerSections({
    answer: '결론',
    sections: [{ type: 'code', title: '코드 근거', items: ['첫 번째 근거', '두 번째 근거'], citations: ['relation-1'] }],
  }, new Set(['relation-1']));

  assert.deepEqual(sections[0].items, ['첫 번째 근거', '두 번째 근거']);
  assert.equal(sections[0].text, '첫 번째 근거\n두 번째 근거');
});

test('JSON을 지키지 않은 긴 답변도 근거 영역 표식으로 나눈다', () => {
  const sections = buildAnswerSections({
    answer: '기록(커밋 메시지) 근거: 자동화 파이프라인을 만들었습니다. 코드 근거: src/main.py에서 API 호출을 확인했습니다. 확인 필요: 실제 실행 결과는 알 수 없습니다.',
  }, new Set());

  assert.deepEqual(sections.map((section) => section.label), ['기록된 맥락', '코드 근거', '확인 필요']);
  assert.match(sections[1].text, /src\/main\.py/);
});

test('OpenAI 호환 URL·모델·키를 받아 chat completions 형식으로 호출한다', async () => {
  let request = null;
  const fakeFetch = async (url, init) => {
    request = { url, init };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ answer: '호환 응답', citations: ['e1'] }) } }] }) };
  };
  const client = createLlmClient({
    LLM_BASE_URL: 'https://llm.example.test/v1/',
    LLM_API_KEY: 'compatible-key',
    LLM_MODEL: 'qwen-max',
  }, fakeFetch);
  const result = await client.answer({ question: '무엇이 바뀌었나?', evidence: [{ id: 'e1', text: 'changed' }] });

  assert.equal(client.provider, 'openai-compatible');
  assert.equal(result.support, 'supported');
  assert.equal(request.url, 'https://llm.example.test/v1/chat/completions');
  assert.equal(request.init.headers.Authorization, 'Bearer compatible-key');
  assert.equal(JSON.parse(request.init.body).model, 'qwen-max');
});

test('LLM 공급자 오류가 있어도 정적 분석용 요약은 저장 가능한 형태로 폴백한다', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { type: 'MissingSessionID', message: "OpenCode's free tier is only available in OpenCode" } }),
  });
  const client = createLlmClient({
    LLM_BASE_URL: 'https://opencode.ai/zen/v1',
    LLM_API_KEY: 'compatible-key',
    LLM_MODEL: 'big-pickle',
  }, fakeFetch);

  const result = await client.summarize({ changes: [], graph: { edges: [] } });
  assert.equal(result.mode, 'deterministic');
  assert.match(result.cautions.join(' '), /LLM/);
  assert.match(result.cautions.join(' '), /free tier/);
  assert.doesNotMatch(result.cautions.join(' '), /compatible-key/);
});

test('OpenRouter 공급자 메타데이터의 rate limit 원인을 보존한다', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: {
      message: 'Provider returned error',
      metadata: { raw: 'temporarily rate-limited upstream' },
    } }),
  });
  const client = createLlmClient({
    LLM_BASE_URL: 'https://openrouter.ai/api/v1',
    LLM_API_KEY: 'compatible-key',
    LLM_MODEL: 'google/gemma-4-26b-a4b-it:free',
  }, fakeFetch);

  await assert.rejects(
    client.answer({ question: '무엇이 바뀌었나?', evidence: [{ id: 'change-1', text: 'changed' }] }),
    (error) => error.code === 'LLM_REQUEST_FAILED'
      && error.status === 429
      && /temporarily rate-limited upstream/.test(error.message),
  );
});

test('커밋·PR 맥락을 LLM 질문 프롬프트에 함께 고정한다', async () => {
  let prompt = '';
  const fakeFetch = async (_url, init) => {
    prompt = JSON.parse(init.body).input;
    return { ok: true, json: async () => ({ output_text: JSON.stringify({ answer: '기록을 확인했습니다.', citations: ['context-1'] }) }) };
  };
  const client = createLlmClient({ OPENAI_API_KEY: 'key', OPENAI_MODEL: 'model' }, fakeFetch);
  await client.answer({
    question: '작성자는 왜 이 변경을 했나?',
    context: { type: 'commit', subject: 'Prevent duplicate requests', body: 'Serialize the update.' },
    evidence: [{ id: 'context-1', text: 'commit message: Prevent duplicate requests' }],
  });
  assert.match(prompt, /Prevent duplicate requests/);
  assert.match(prompt, /Serialize the update/);
});

test('변경 스토리는 기록·코드·영향·확인 경계를 쉬운 문장으로 나눈다', () => {
  const result = buildNarrativeSummary({
    changes: [
      { status: 'M', newPath: 'src/replies.ts' },
      { status: 'A', newPath: 'src/reply-route.ts' },
    ],
    graph: {
      edges: [
        { source: 'src/reply-route.ts', target: 'src/replies.ts', kind: 'imports', evidence: { path: 'src/reply-route.ts', startLine: 4 } },
      ],
    },
    context: {
      type: 'commit',
      subject: 'fix: prevent duplicate replies',
      body: 'Serialize the update.',
    },
  });

  assert.match(result.why, /기록된 이유/);
  assert.match(result.why, /prevent duplicate replies/);
  assert.match(result.what, /src\/replies\.ts/);
  assert.match(result.impact, /src\/replies\.ts/);
  assert.match(result.confidence, /확인 필요/);
  assert.deepEqual(result.sections.map((section) => section.key), ['why', 'what', 'impact', 'confidence']);
});

test('변경 스토리의 관계 예시는 내부 노드 ID 대신 파일 경로로 읽힌다', () => {
  const result = buildNarrativeSummary({
    changes: [{ status: 'M', newPath: 'src/replies.ts' }],
    graph: {
      nodes: [
        { id: 'snapshot:file:src/replies.ts', path: 'src/replies.ts', label: 'replies.ts' },
        { id: 'snapshot:file:src/routes.ts', path: 'src/routes.ts', label: 'routes.ts' },
      ],
      edges: [{ source: 'snapshot:file:src/routes.ts', target: 'snapshot:file:src/replies.ts', kind: 'imports' }],
    },
  });

  assert.match(result.impact, /src\/routes\.ts/);
  assert.match(result.impact, /src\/replies\.ts/);
  assert.doesNotMatch(result.impact, /snapshot:file/);
});

test('LLM 요약 프롬프트는 비개발자용 변경 스토리 형식을 요구한다', async () => {
  let prompt = '';
  const fakeFetch = async (_url, init) => {
    prompt = JSON.parse(init.body).input;
    return { ok: true, json: async () => ({ output_text: JSON.stringify({
      title: '중복 답변 방지',
      overview: '답변 중복을 막는 변경입니다.',
      narrative: { why: '중복 답변을 막기 위해', what: '응답 처리를 조정했습니다.', impact: '답변 흐름이 안정됩니다.', confidence: '코드에서 확인했습니다.' },
    }) }) };
  };
  const client = createLlmClient({ OPENAI_API_KEY: 'key', OPENAI_MODEL: 'model' }, fakeFetch);
  const result = await client.summarize({
    changes: [{ status: 'M', newPath: 'src/replies.ts' }],
    graph: { edges: [] },
    context: { type: 'commit', subject: 'Prevent duplicate replies', body: 'Serialize the update.' },
    evidence: [{ id: 'context-commit', kind: 'recorded_statement', text: '커밋 메시지: Prevent duplicate replies' }],
  });

  assert.equal(result.mode, 'openai');
  assert.equal(result.narrative.why, '중복 답변을 막기 위해');
  assert.match(prompt, /왜 만들었나/);
  assert.match(prompt, /무엇을 바꿨나/);
  assert.match(prompt, /프로젝트에 어떤 변화/);
  assert.match(prompt, /확인 필요/);
  assert.match(prompt, /Prevent duplicate replies/);
});

test('구조화되지 않은 LLM 요약은 정적 변경 스토리로 안전하게 폴백한다', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ output_text: '설명만 반환했습니다.' }) });
  const client = createLlmClient({ OPENAI_API_KEY: 'key', OPENAI_MODEL: 'model' }, fakeFetch);
  const result = await client.summarize({ changes: [{ status: 'D', oldPath: 'src/old.ts' }], graph: { edges: [] } });

  assert.equal(result.mode, 'openai');
  assert.match(result.overview, /설명만 반환했습니다/);
  assert.match(result.narrative.why, /기록된 이유가 없습니다/);
  assert.match(result.narrative.what, /src\/old\.ts/);
});
