import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyApiError } from '../src/lib/api-error.mjs';

test('LLM provider 오류는 422 대신 안전한 502 원인으로 반환한다', async () => {
  const result = classifyApiError(Object.assign(new Error('LLM_HTTP_400: provider rejected request'), {
    code: 'LLM_REQUEST_FAILED',
    status: 400,
  }));
  assert.equal(result.status, 502);
  assert.equal(result.code, 'LLM_REQUEST_FAILED');
  assert.match(result.text, /provider rejected request/);
});
