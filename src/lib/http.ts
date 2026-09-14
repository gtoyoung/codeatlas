import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/modules/http/origin.mjs';

export function rejectCrossOrigin(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: 'ACCESS_DENIED', message: '허용되지 않은 요청입니다.' } }, { status: 403 });
  }
  return null;
}

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const known = message === 'SNAPSHOT_UNSTABLE'
    ? { status: 409, code: message, text: '파일이 계속 변경되어 일관된 스냅샷을 만들지 못했습니다.' }
    : message === 'INVALID_REF'
      ? { status: 400, code: message, text: 'Git 기준 ref가 올바르지 않습니다.' }
      : { status: 422, code: 'ANALYSIS_FAILED', text: '저장소를 읽거나 분석하지 못했습니다.' };
  return NextResponse.json({ error: { code: known.code, message: known.text } }, { status: known.status });
}
