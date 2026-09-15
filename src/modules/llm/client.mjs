function snippet(value, limit = 240) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function changePath(change) {
  return change?.newPath ?? change?.oldPath ?? null;
}

function recordedReason(context) {
  if (!context || !['commit', 'pull_request'].includes(context.type)) {
    return '기록된 이유가 없습니다. 변경된 코드와 정적 관계를 바탕으로 확인합니다.';
  }
  const title = context.type === 'pull_request' ? context.title : context.subject;
  const body = context.type === 'pull_request' ? context.description : context.body;
  if (!title && !body) return '기록된 이유가 없습니다. 변경된 코드와 정적 관계를 바탕으로 확인합니다.';
  const kind = context.type === 'pull_request' ? 'PR 설명' : '커밋 메시지';
  const titleText = title ? `“${snippet(title, 180)}”` : '';
  const bodyText = body ? ` 추가 설명에는 “${snippet(body, 260)}”라고 적혀 있습니다.` : '';
  return `기록된 이유는 ${kind}${titleText ? `에 적힌 ${titleText}` : '에 적힌 내용'}입니다.${bodyText}`;
}

function changedFilesSummary(changes) {
  const paths = changes.map(changePath).filter(Boolean);
  if (paths.length === 0) return '변경된 파일이 없습니다.';
  const counts = changes.reduce((result, change) => {
    const status = String(change?.status ?? '변경').toUpperCase();
    result[status] = (result[status] ?? 0) + 1;
    return result;
  }, {});
  const countText = Object.entries(counts).map(([status, count]) => `${status} ${count}`).join(' · ');
  const pathText = `${paths.slice(0, 4).join(', ')}${paths.length > 4 ? ` 외 ${paths.length - 4}개` : ''}`;
  return `${paths.length}개 파일(${countText})이 바뀌었습니다. 대상은 ${pathText}입니다.`;
}

function impactSummary(graph, changes) {
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  if (edges.length === 0) {
    return '정적 관계를 찾지 못했습니다. 독립 파일이거나 동적 연결일 수 있어 실제 실행 흐름은 확인이 필요합니다.';
  }
  const changed = new Set(changes.map(changePath).filter(Boolean));
  const nodeLabels = new Map((Array.isArray(graph?.nodes) ? graph.nodes : [])
    .filter((node) => node?.id)
    .map((node) => [node.id, node.path ?? node.label ?? node.id]));
  const displayNode = (value) => {
    const raw = String(value ?? '');
    return snippet(nodeLabels.get(raw) ?? raw.replace(/^.*?:(?:file|route):/, ''), 100);
  };
  const examples = edges.slice(0, 3).map((edge) => {
    const source = displayNode(edge.source) || '(출발 파일 없음)';
    const target = displayNode(edge.target) || '(대상 파일 없음)';
    const kind = snippet(edge.kind, 80) || '연결';
    return `${source} → ${target} (${kind})`;
  });
  const changedMention = [...changed].find((path) => edges.some((edge) => displayNode(edge.source) === path || displayNode(edge.target) === path));
  return `정적 관계 ${edges.length}개를 확인했습니다. ${examples.join(', ')}${changedMention ? `; 변경 파일 ${changedMention}가 관계에 포함됩니다.` : '.'} 동적 연결과 실행 시 영향은 확인이 필요합니다.`;
}

export function buildNarrativeSummary({ changes = [], graph = { edges: [] }, context = null, evidence = [] } = {}) {
  const safeChanges = Array.isArray(changes) ? changes : [];
  const why = recordedReason(context);
  const what = changedFilesSummary(safeChanges);
  const impact = impactSummary(graph, safeChanges);
  const confidence = '커밋·PR 메시지는 작성자가 남긴 기록이고, 파일 변경과 정적 관계는 코드에서 확인했습니다. 실행 결과와 기록 밖의 실제 의도는 확인 필요합니다.';
  const citationsByKind = (kinds) => evidence.filter((item) => kinds.includes(item?.kind)).map((item) => item.id).filter(Boolean).slice(0, 8);
  return {
    why,
    what,
    impact,
    confidence,
    sections: [
      { key: 'why', label: '왜 만들었나', text: why, citations: citationsByKind(['recorded_statement']) },
      { key: 'what', label: '무엇을 바꿨나', text: what, citations: citationsByKind(['git_change']) },
      { key: 'impact', label: '프로젝트에 어떤 변화인가', text: impact, citations: citationsByKind(['imports', 'calls', 'exports', 'route', 'renders', 'references']) },
      { key: 'confidence', label: '어디까지 확실한가', text: confidence, citations: [] },
    ],
  };
}

function localSummary({ changes = [], graph = { edges: [] }, context = null, evidence = [] }) {
  const paths = changes.map((change) => change.newPath ?? change.oldPath).filter(Boolean);
  const contextTitle = context?.type === 'pull_request'
    ? `PR #${context.number ?? '?'} · ${context.title || '제목 없음'}`
    : context?.type === 'commit' ? `커밋 · ${context.subject || '메시지 없음'}` : null;
  const narrative = buildNarrativeSummary({ changes, graph, context, evidence });
  return {
    mode: 'deterministic',
    title: contextTitle ?? `${changes.length}개 변경 감지`,
    overview: paths.length > 0
      ? `${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ' 외' : ''}에서 변경을 확인했습니다.`
      : contextTitle ? `${contextTitle}의 기록과 선택한 Git 범위에서 파일 변경을 확인했습니다.` : '선택한 기준에서 파일 변경이 없습니다.',
    cautions: ['코드와 Git 정보만 분석했습니다. 실행 결과와 작성자의 실제 의도는 확인하지 않았습니다.'],
    relationCount: graph.edges?.length ?? 0,
    narrative,
  };
}

function mergeNarrative(providerValue, fallback) {
  const value = providerValue && typeof providerValue === 'object' ? providerValue : {};
  const narrative = ['why', 'what', 'impact', 'confidence'].reduce((result, key) => {
    result[key] = typeof value[key] === 'string' && value[key].trim() ? value[key].trim() : fallback[key];
    return result;
  }, {});
  return {
    ...narrative,
    sections: fallback.sections.map((section) => ({ ...section, text: narrative[section.key] })),
  };
}

function parseJsonText(text) {
  const source = typeof text === 'string' ? text.trim() : '';
  const candidates = [
    source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
    source,
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next common model output shape.
    }
  }
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(source.slice(start, end + 1));
    } catch {
      // Keep the original response as an unstructured answer.
    }
  }
  return { answer: source, citations: [] };
}

async function readResponseDetail(response) {
  try {
    const source = typeof response.clone === 'function' ? response.clone() : response;
    const body = await source.json();
    const detail = body?.error?.metadata?.raw
      ?? body?.error?.message
      ?? body?.message
      ?? body?.error?.type;
    return typeof detail === 'string' ? detail.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240) : '';
  } catch {
    return '';
  }
}

async function requestLlm(fetchImpl, url, init) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    const error = new Error('LLM_NETWORK');
    error.code = 'LLM_NETWORK';
    throw error;
  }
  if (!response.ok) {
    const detail = await readResponseDetail(response);
    const error = new Error(`LLM_HTTP_${response.status ?? 'ERROR'}${detail ? `: ${detail}` : ''}`);
    error.code = 'LLM_REQUEST_FAILED';
    error.status = Number(response.status) || 502;
    throw error;
  }
  return response;
}

function llmFallbackCaution(error) {
  const message = error instanceof Error
    ? error.message.replace(/^LLM_HTTP_\d+\s*:\s*/i, '').trim().slice(0, 240)
    : '';
  return `LLM 요약을 만들지 못해 정적 요약을 표시합니다.${message ? ` 공급자 응답: ${message}` : ''}`;
}

export function validateCitedAnswer(value, allowedIds) {
  const answer = typeof value?.answer === 'string' ? value.answer.trim() : '';
  const sectionCitations = Array.isArray(value?.sections)
    ? value.sections.flatMap((section) => Array.isArray(section?.citations) ? section.citations : [])
    : [];
  const requested = Array.isArray(value?.citations) && value.citations.length > 0
    ? value.citations
    : sectionCitations;
  const citations = requested.filter((id) => typeof id === 'string' && allowedIds.has(id));
  const allValid = requested.length > 0 && requested.length === citations.length;
  return {
    answer: answer || '근거가 있는 답변을 생성하지 못했습니다.',
    citations: allValid ? citations : [],
    support: allValid ? 'supported' : 'unsupported',
  };
}

const sectionLabels = {
  conclusion: '결론',
  recorded: '기록된 맥락',
  code: '코드 근거',
  uncertainty: '확인 필요',
  next: '다음 확인',
  answer: '답변',
};

function sectionKey(value) {
  const raw = String(value ?? '').toLowerCase();
  if (raw.includes('record') || raw.includes('context') || raw.includes('기록')) return 'recorded';
  if (raw.includes('code') || raw.includes('relation') || raw.includes('코드')) return 'code';
  if (raw.includes('uncertain') || raw.includes('risk') || raw.includes('불확실') || raw.includes('확인 필요')) return 'uncertainty';
  if (raw.includes('next') || raw.includes('다음')) return 'next';
  if (raw.includes('conclusion') || raw.includes('결론')) return 'conclusion';
  return 'answer';
}

function sectionText(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(sectionText).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    return sectionText(value.text ?? value.content ?? value.summary ?? value.answer ?? value.items ?? '');
  }
  return '';
}

function sectionItems(value) {
  if (!Array.isArray(value?.items)) return [];
  return value.items.map(sectionText).filter(Boolean);
}

function validSectionCitations(value, allowedIds) {
  const requested = Array.isArray(value?.citations) ? value.citations : [];
  return requested.filter((id) => typeof id === 'string' && allowedIds.has(id));
}

function narrativeSections(text) {
  const source = String(text ?? '').trim();
  if (!source) return [];
  const marker = /(기록(?:\([^\n:：]*\))?\s*근거|코드\s*근거|불확실성|확인\s*필요|다음\s*확인|결론|답변)\s*[:：]/gi;
  const matches = [...source.matchAll(marker)];
  if (matches.length === 0) {
    return [{ key: 'answer', label: sectionLabels.answer, text: source, citations: [] }];
  }
  const sections = [];
  const prefix = source.slice(0, matches[0].index).trim();
  if (prefix) sections.push({ key: 'conclusion', label: sectionLabels.conclusion, text: prefix, citations: [] });
  for (const [index, match] of matches.entries()) {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const textPart = source.slice(start, end).trim();
    if (!textPart) continue;
    const key = sectionKey(match[1]);
    sections.push({ key, label: sectionLabels[key], text: textPart, citations: [] });
  }
  return sections;
}

export function buildAnswerSections(value, allowedIds) {
  const rawSections = Array.isArray(value?.sections)
    ? value.sections
    : value?.sections && typeof value.sections === 'object'
      ? Object.entries(value.sections).map(([type, section]) => ({ type, ...(section && typeof section === 'object' ? section : { text: section }) }))
      : [];
  const sections = rawSections.map((section) => {
    const key = sectionKey(section?.type ?? section?.key ?? section?.title);
    const items = sectionItems(section);
    const text = sectionText(section);
    return {
      key,
      label: typeof section?.title === 'string' && section.title.trim() ? section.title.trim() : sectionLabels[key],
      text,
      citations: validSectionCitations(section, allowedIds),
      ...(items.length > 0 ? { items } : {}),
    };
  }).filter((section) => section.text);
  return sections.length > 0 ? sections : narrativeSections(value?.answer ?? value?.conclusion ?? '');
}

async function callOpenAI(config, fetchImpl, prompt) {
  const response = await requestLlm(fetchImpl, 'https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: config.OPENAI_MODEL, input: prompt, store: false }),
  });
  const body = await response.json();
  return body.output_text ?? body.output?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === 'output_text')?.text ?? '';
}

function firstValue(config, ...keys) {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function compatibleEndpoint(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) return normalized;
  return `${normalized}/chat/completions`;
}

function chatText(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((item) => item?.text ?? '').join('');
  return '';
}

async function callOpenAICompatible(config, fetchImpl, prompt) {
  const response = await requestLlm(fetchImpl, compatibleEndpoint(config.__LLM_BASE_URL), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.__LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.__LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    }),
  });
  return chatText(await response.json());
}

async function callAnthropic(config, fetchImpl, prompt) {
  const response = await requestLlm(fetchImpl, 'https://api.anthropic.com/v1/messages', {
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
  const body = await response.json();
  return body.content?.find((item) => item.type === 'text')?.text ?? '';
}

export function createLlmClient(config = process.env, fetchImpl = fetch) {
  const compatible = {
    __LLM_BASE_URL: firstValue(config, 'LLM_BASE_URL', 'OPENAI_BASE_URL'),
    __LLM_API_KEY: firstValue(config, 'LLM_API_KEY', 'OPENAI_API_KEY'),
    __LLM_MODEL: firstValue(config, 'LLM_MODEL', 'OPENAI_MODEL'),
  };
  const hasCompatible = compatible.__LLM_BASE_URL && compatible.__LLM_API_KEY && compatible.__LLM_MODEL;
  const provider = hasCompatible
    ? 'openai-compatible'
    : config.OPENAI_API_KEY && config.OPENAI_MODEL
      ? 'openai'
      : config.ANTHROPIC_API_KEY && config.ANTHROPIC_MODEL
        ? 'anthropic'
        : null;

  async function call(prompt) {
    if (provider === 'openai-compatible') return callOpenAICompatible(compatible, fetchImpl, prompt);
    if (provider === 'openai') return callOpenAI(config, fetchImpl, prompt);
    if (provider === 'anthropic') return callAnthropic(config, fetchImpl, prompt);
    return null;
  }

  return {
    provider: provider ?? 'local',

    async summarize(input) {
      if (!provider) return localSummary(input);
      const fallback = localSummary(input);
      try {
        const text = await call([
          '아래 Git 변경, 커밋·PR 기록, 정적 관계만 근거로 비개발자도 이해할 수 있는 자연스러운 한국어 변경 스토리를 작성하세요.',
          '왜 만들었나, 무엇을 바꿨나, 프로젝트에 어떤 변화인가, 어디까지 확실한가(확인 필요)를 분리해 설명하세요.',
          '기록된 이유(커밋 메시지·PR 설명)와 코드에서 확인한 사실을 섞지 마세요. 기록되지 않은 의도와 실행 결과를 사실로 단정하지 마세요.',
          'JSON만 반환하세요. 형식: {"title":"짧은 제목","overview":"2~3문장 요약","narrative":{"why":"왜 만들었나","what":"무엇을 바꿨나","impact":"프로젝트에 어떤 변화인가","confidence":"어디까지 확실한가"}}',
          JSON.stringify(input).slice(0, 60_000),
        ].join('\n'));
        const parsed = parseJsonText(text);
        const narrative = mergeNarrative(parsed?.narrative, fallback.narrative);
        const overview = typeof parsed?.overview === 'string' && parsed.overview.trim()
          ? parsed.overview.trim()
          : typeof parsed?.answer === 'string' && parsed.answer.trim()
            ? parsed.answer.trim()
            : (text || fallback.overview);
        return {
          ...fallback,
          mode: provider,
          title: typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title.trim() : fallback.title,
          overview,
          narrative,
        };
      } catch (error) {
        return {
          ...fallback,
          mode: 'deterministic',
          cautions: [...(fallback.cautions ?? []), llmFallbackCaution(error)],
        };
      }
    },

    async answer({ question, evidence, context = null }) {
      if (!provider) {
        const citations = evidence.map((item) => item.id).slice(0, 5);
        return {
          answer: `${context?.type === 'pull_request' ? '선택한 PR' : context?.type === 'commit' ? '선택한 커밋' : '현재 스냅샷'}의 기록과 ${evidence.length}개 근거를 확인하세요. 외부 LLM이 설정되지 않아 기록 밖의 의도는 추정하지 않았습니다.`,
          citations,
          support: evidence.length > 0 ? 'supported' : 'unsupported',
          sections: [
            {
              key: 'conclusion',
              label: '결론',
              text: `${evidence.length}개 근거를 확인했습니다.`,
              citations,
            },
            {
              key: 'uncertainty',
              label: '확인 필요',
              text: '외부 LLM이 설정되지 않아 기록 밖의 작성 의도와 실행 결과는 판단하지 않았습니다.',
              citations: [],
            },
          ],
          mode: 'deterministic',
        };
      }
      const prompt = [
        '질문에 한국어로 답하고 JSON만 반환하세요.',
        '형식: {"answer":"한 문장 결론","sections":[{"type":"recorded","title":"기록된 맥락","items":["커밋·PR 기록에서 확인되는 사실"],"citations":["evidence-id"]},{"type":"code","title":"코드 근거","items":["소스와 정적 관계에서 확인되는 사실"],"citations":["evidence-id"]},{"type":"uncertainty","title":"확인 필요","items":["근거가 없어 단정할 수 없는 내용"],"citations":[]},{"type":"next","title":"다음 확인","items":["사용자가 확인할 다음 항목"],"citations":[]}],"citations":["evidence-id"]}.',
        '기록된 맥락과 코드 근거를 섞지 말고 섹션별로 분리하세요. 비어 있는 섹션은 생략해도 됩니다.',
        '주어진 근거 ID만 인용하고 근거 밖 내용은 알 수 없다고 답하세요. 작성자의 의도는 기록에 적힌 표현과 코드 근거를 구분해 설명하세요.',
        `질문: ${question}`,
        `선택한 커밋·PR 맥락: ${JSON.stringify(context ?? {}).slice(0, 30_000)}`,
        `근거: ${JSON.stringify(evidence).slice(0, 80_000)}`,
      ].join('\n');
      const parsed = parseJsonText(await call(prompt));
      const allowedIds = new Set(evidence.map((item) => item.id));
      return {
        ...validateCitedAnswer(parsed, allowedIds),
        sections: buildAnswerSections(parsed, allowedIds),
        mode: provider,
      };
    },
  };
}
