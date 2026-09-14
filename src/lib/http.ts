import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/modules/http/origin.mjs';
import { classifyApiError } from './api-error.mjs';

export function rejectCrossOrigin(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: 'ACCESS_DENIED', message: '허용되지 않은 요청입니다.' } }, { status: 403 });
  }
  return null;
}

export function apiError(error: unknown) {
  const known = classifyApiError(error);
  return NextResponse.json({ error: { code: known.code, message: known.text } }, { status: known.status });
}
