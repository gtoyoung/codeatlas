import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { makeRepo } from './helpers/repository.mjs';
import { listCommitHistory } from '../src/modules/repository/history.mjs';

test('모든 ref에서 도달 가능한 커밋을 최신 순서와 변경 수로 읽는다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await writeFile(join(repo.path, 'one.ts'), 'export const one = 1;\n');
  await repo.run(['add', '.']);
  await repo.run(['-c', 'user.name=Alice', '-c', 'user.email=alice@example.invalid', 'commit', '-m', 'add one']);
  const first = (await repo.run(['rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(join(repo.path, 'two.ts'), 'export const two = 2;\n');
  await repo.run(['add', '.']);
  await repo.run(['-c', 'user.name=Bob', '-c', 'user.email=bob@example.invalid', 'commit', '-m', 'add two']);
  await repo.run(['branch', 'feature']);

  const history = await listCommitHistory(repo.path, { limit: 20 });
  assert.equal(history.complete, true);
  assert.equal(history.commits.length, 2);
  assert.equal(history.commits[0].subject, 'add two');
  assert.equal(history.commits[0].author.name, 'Bob');
  assert.equal(history.commits[1].oid, first);
  assert.ok(history.commits[0].changedFiles.some((file) => file.path === 'two.ts'));
  assert.ok(history.commits[0].refs.some((ref) => ref.endsWith('/HEAD')));
});

test('limit과 검색어는 UI용 이력 범위를 제한한다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await repo.run(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'keep']);
  await repo.run(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'target change']);
  const history = await listCommitHistory(repo.path, { limit: 1, query: 'target' });
  assert.equal(history.commits.length, 1);
  assert.equal(history.commits[0].subject, 'target change');
});
