import test from 'node:test';
import assert from 'node:assert/strict';

import { createOneDevClient, OneDevError } from '../src/modules/integrations/onedev/client.mjs';

test('OneDev 요청은 Bearer 인증을 사용하고 PR 목록을 표준 형태로 만든다', async () => {
  const requests = [];
  const client = createOneDevClient({
    serverUrl: 'https://onedev.example.test/',
    accessToken: 'secret-token',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ content: [{
        id: 7, number: 12, title: 'Add retry', status: 'OPEN',
        source: 'feature/retry', target: 'main',
        submitter: { name: 'Alice' }, lastUpdated: 1710000000000,
      }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await client.listPullRequests({ query: 'open', offset: 2, count: 10 });
  assert.equal(result.items[0].number, 12);
  assert.equal(result.items[0].author.name, 'Alice');
  assert.match(requests[0].url, /~api\/pulls\?query=open&offset=2&count=10/);
  assert.equal(requests[0].init.headers.Authorization, 'Bearer secret-token');
});

test('OneDev 오류는 상태와 재시도 가능한지 구분한다', async () => {
  const client = createOneDevClient({
    serverUrl: 'https://onedev.example.test',
    accessToken: 'token',
    fetchImpl: async () => new Response(JSON.stringify({ message: 'denied' }), { status: 401 }),
  });
  await assert.rejects(client.getPullRequest(3), (error) => {
    assert.ok(error instanceof OneDevError);
    assert.equal(error.code, 'ONEDEV_UNAUTHORIZED');
    assert.equal(error.status, 401);
    return true;
  });
});

test('토큰 없는 설정은 네트워크 요청 전에 명확히 실패한다', async () => {
  const client = createOneDevClient({ serverUrl: 'https://onedev.example.test', accessToken: '' });
  await assert.rejects(client.listPullRequests(), /ONEDEV_NOT_CONFIGURED/);
});
