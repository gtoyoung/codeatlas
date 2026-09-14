import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRepo } from './helpers/repository.mjs';
import { inspectPullRequestRefs } from '../src/modules/integrations/onedev/refs.mjs';

test('PR 번호에 대응하는 OneDev Git ref를 읽고 없는 ref는 누락으로 표시한다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await repo.run(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'initial']);
  const oid = (await repo.run(['rev-parse', 'HEAD'])).stdout.trim();
  await repo.run(['update-ref', 'refs/pulls/12/head', oid]);
  const result = await inspectPullRequestRefs(repo.path, 12);
  assert.equal(result.number, 12);
  assert.equal(result.head.oid, oid);
  assert.equal(result.base.available, false);
  assert.equal(result.merge.available, false);
});

test('PR 번호 외 입력을 거부한다', async () => {
  await assert.rejects(inspectPullRequestRefs('C:\\missing', '12/head'), /INVALID_PULL_REQUEST_NUMBER/);
});
