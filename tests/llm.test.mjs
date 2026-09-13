import test from 'node:test';
import assert from 'node:assert/strict';

import { createLlmClient, validateCitedAnswer } from '../src/modules/llm/client.mjs';

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
