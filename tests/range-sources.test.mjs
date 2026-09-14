import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { makeRepo } from './helpers/repository.mjs';
import { loadRangeSnapshot } from '../src/modules/snapshot/range-sources.mjs';

const identity = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid'];

test('두 Git 커밋 사이의 PR 범위를 checkout 없이 스냅샷으로 읽는다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await writeFile(join(repo.path, 'app.ts'), 'export const value = 1;\n');
  await repo.run(['add', '.']);
  await repo.run([...identity, 'commit', '-m', 'base']);
  const base = (await repo.run(['rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(join(repo.path, 'app.ts'), 'export const value = 2;\n');
  await writeFile(join(repo.path, 'new.ts'), 'export const added = true;\n');
  await repo.run(['add', '.']);
  await repo.run([...identity, 'commit', '-m', 'change']);
  const head = (await repo.run(['rev-parse', 'HEAD'])).stdout.trim();
  const before = (await repo.run(['symbolic-ref', '--short', 'HEAD'])).stdout.trim();

  const snapshot = await loadRangeSnapshot(repo.path, {
    baseRef: base,
    headRef: head,
    metadata: { type: 'pull_request', number: 12, title: 'Change value' },
  });

  assert.equal(snapshot.kind, 'pull_request');
  assert.equal(snapshot.baseOid, base);
  assert.equal(snapshot.targetOid, head);
  assert.equal(snapshot.files.find((file) => file.path === 'new.ts').state, 'indexed');
  assert.deepEqual(snapshot.changes.map((change) => change.newPath ?? change.oldPath).sort(), ['app.ts', 'new.ts']);
  assert.equal(snapshot.metadata.number, 12);
  assert.equal((await repo.run(['symbolic-ref', '--short', 'HEAD'])).stdout.trim(), before);
});

test('범위 ref가 없으면 명시적 오류를 반환한다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await assert.rejects(
    loadRangeSnapshot(repo.path, { baseRef: 'refs/pulls/99/base', headRef: 'refs/pulls/99/head' }),
    /INVALID_REF|PR_OBJECTS_MISSING/,
  );
});
