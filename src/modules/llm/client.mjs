function localSummary({ changes = [], graph = { edges: [] }, context = null }) {
  const paths = changes.map((change) => change.newPath ?? change.oldPath).filter(Boolean);
  const contextTitle = context?.type === 'pull_request'
    ? `PR #${context.number ?? '?'} · ${context.title || '제목 없음'}`
    : context?.type === 'commit' ? `커밋 · ${context.subject || '메시지 없음'}` : null;
  return {
    mode: 'deterministic',
    title: contextTitle ?? `${changes.length}개 변경 감지`,
    overview: paths.length > 0
      ? `${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ' 외' : ''}에서 변경을 확인했습니다.`
      : contextTitle ? `${contextTitle}의 기록과 선택한 Git 범위에서 파일 변경을 확인했습니다.` : '선택한 기준에서 파일 변경이 없습니다.',
    cautions: ['코드와 Git 정보만 분석했습니다. 실행 결과와 작성자의 실제 의도는 확인하지 않았습니다.'],
    relationCount: graph.edges?.length ?? 0,
  };
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { answer: text, citations: [] };
  }
}

export function validateCitedAnswer(value, allowedIds) {
  const answer = typeof value?.answer === 'string' ? value.answer.trim() : '';
  const requested = Array.isArray(value?.citations) ? value.citations : [];
  const citations = requested.filter((id) => typeof id === 'string' && allowedIds.has(id));
  const allValid = requested.length > 0 && requested.length === citations.length;
  return {
    answer: answer || '근거가 있는 답변을 생성하지 못했습니다.',
    citations: allValid ? citations : [],
    support: allValid ? 'supported' : 'unsupported',
  };
}

async function callOpenAI(config, fetchImpl, prompt) {
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: config.OPENAI_MODEL, input: prompt, store: false }),
  });
  if (!response.ok) throw new Error(`LLM_HTTP_${response.status ?? 'ERROR'}`);
  const body = await response.json();
  return body.output_text ?? body.output?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === 'output_text')?.text ?? '';
}

async function callAnthropic(config, fetchImpl, prompt) {
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ANTHROPIC_API_KEY}`,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.ANTHROPIC_MODEL,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`LLM_HTTP_${response.status ?? 'ERROR'}`);
  const body = await response.json();
  return body.content?.find((item) => item.type === 'text')?.text ?? '';
}

export function createLlmClient(config = process.env, fetchImpl = fetch) {
  const provider = config.OPENAI_API_KEY && config.OPENAI_MODEL
    ? 'openai'
    : config.ANTHROPIC_API_KEY && config.ANTHROPIC_MODEL
      ? 'anthropic'
      : null;

  async function call(prompt) {
    if (provider === 'openai') return callOpenAI(config, fetchImpl, prompt);
    if (provider === 'anthropic') return callAnthropic(config, fetchImpl, prompt);
    return null;
  }

  return {
    provider: provider ?? 'local',

    async summarize(input) {
      if (!provider) return localSummary(input);
      const fallback = localSummary(input);
      const text = await call([
        '아래 Git 변경과 정적 관계만 근거로 짧은 한국어 요약을 작성하세요.',
        '기록되지 않은 의도와 실행 결과를 사실로 단정하지 마세요.',
        JSON.stringify(input).slice(0, 60_000),
      ].join('\n'));
      return { ...fallback, mode: provider, overview: text || fallback.overview };
    },

    async answer({ question, evidence, context = null }) {
      if (!provider) {
        return {
          answer: `${context?.type === 'pull_request' ? '선택한 PR' : context?.type === 'commit' ? '선택한 커밋' : '현재 스냅샷'}의 기록과 ${evidence.length}개 근거를 확인하세요. 외부 LLM이 설정되지 않아 기록 밖의 의도는 추정하지 않았습니다.`,
          citations: evidence.map((item) => item.id).slice(0, 5),
          support: evidence.length > 0 ? 'supported' : 'unsupported',
          mode: 'deterministic',
        };
      }
      const prompt = [
        '질문에 한국어로 답하고 JSON만 반환하세요: {"answer":"...","citations":["evidence-id"]}.',
        '주어진 근거 ID만 인용하고 근거 밖 내용은 알 수 없다고 답하세요.',
        `질문: ${question}`,
        `선택한 커밋·PR 맥락: ${JSON.stringify(context ?? {}).slice(0, 30_000)}`,
        `근거: ${JSON.stringify(evidence).slice(0, 80_000)}`,
      ].join('\n');
      const parsed = parseJsonText(await call(prompt));
      return { ...validateCitedAnswer(parsed, new Set(evidence.map((item) => item.id))), mode: provider };
    },
  };
}
