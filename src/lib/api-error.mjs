function providerDetail(message) {
  return message
    .replace(/^LLM_HTTP_\d+\s*:\s*/i, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 240);
}

export function classifyApiError(error) {
  const candidate = error && typeof error === 'object' ? error : {};
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const status = typeof candidate.status === 'number' && Number.isFinite(candidate.status)
    ? candidate.status
    : null;
  const message = error instanceof Error ? error.message : '';

  if (message === 'SNAPSHOT_UNSTABLE') {
    return { status: 409, code: message, text: '파일이 계속 변경되어 일관된 스냅샷을 만들지 못했습니다.' };
  }
  if (message === 'INVALID_REF') {
    return { status: 400, code: message, text: 'Git 기준 ref가 올바르지 않습니다.' };
  }
  if (code === 'LLM_REQUEST_FAILED') {
    const detail = providerDetail(message);
    return {
      status: 502,
      code,
      text: `LLM 요청이 거부되었습니다${status ? ` (${status})` : ''}.${detail ? ` ${detail}` : ''}`,
    };
  }
  if (code === 'LLM_NETWORK') {
    return { status: 502, code, text: 'LLM 서버에 연결하지 못했습니다.' };
  }
  return { status: 422, code: 'ANALYSIS_FAILED', text: '저장소를 읽거나 분석하지 못했습니다.' };
}
