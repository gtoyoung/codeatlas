import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRepo } from './helpers/repository.mjs';
import { git, resolveCommit } from '../src/modules/repository/git.mjs';

test('ref를 커밋으로 고정하며 옵션처럼 보이는 입력을 거부한다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await repo.run([
    '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid',
    'commit', '--allow-empty', '-m', 'initial',
  ]);

  const oid = await resolveCommit(repo.path, 'HEAD');
  assert.match(oid, /^[a-f0-9]+$/);
  await assert.rejects(resolveCommit(repo.path, '--help'), /INVALID_REF/);
  await assert.rejects(resolveCommit(repo.path, 'missing-branch'));
});

test('존재하지 않는 저장소의 실패를 빈 출력으로 바꾸지 않는다', async () => {
  await assert.rejects(git('Z:\\missing-ai-dev-handoff-repository', ['status']));
});
