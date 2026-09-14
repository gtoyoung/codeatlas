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

test('LLM 공급자 오류에 응답 본문과 상태를 안전하게 포함한다', async () => {
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

  await assert.rejects(
    client.summarize({ changes: [], graph: { edges: [] } }),
    (error) => error.code === 'LLM_REQUEST_FAILED'
      && error.status === 400
      && /free tier/.test(error.message)
      && !error.message.includes('compatible-key'),
  );
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
    client.summarize({ changes: [], graph: { edges: [] } }),
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
