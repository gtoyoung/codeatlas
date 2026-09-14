import test from 'node:test';
import assert from 'node:assert/strict';

import { isSameOriginRequest } from '../src/modules/http/origin.mjs';

test('Next.js 내부 URL과 달라도 Origin이 실제 Host와 같으면 허용한다', () => {
  const request = new Request('http://localhost:3117/api/question', {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3117',
      origin: 'http://127.0.0.1:3117',
    },
  });

  assert.equal(isSameOriginRequest(request), true);
});

test('외부 Origin은 거부하고 Origin 없는 서버 요청은 허용한다', () => {
  const forged = new Request('http://localhost:3117/api/question', {
    method: 'POST',
    headers: { host: '127.0.0.1:3117', origin: 'https://attacker.example' },
  });
  const serverRequest = new Request('http://localhost:3117/api/question', {
    method: 'POST',
    headers: { host: '127.0.0.1:3117' },
  });

  assert.equal(isSameOriginRequest(forged), false);
  assert.equal(isSameOriginRequest(serverRequest), true);
});
