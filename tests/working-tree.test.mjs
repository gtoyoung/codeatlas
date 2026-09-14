import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { makeRepo } from './helpers/repository.mjs';
import { scanWorkingTree } from '../src/modules/snapshot/working-tree.mjs';

const identity = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid'];

test('작업 트리의 수정·미추적 소스를 일관된 스냅샷으로 수집한다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await writeFile(join(repo.path, 'tracked.ts'), 'export const value = 1;\n');
  await repo.run(['add', 'tracked.ts']);
  await repo.run([...identity, 'commit', '-m', 'initial']);
  await writeFile(join(repo.path, 'tracked.ts'), 'export const value = 2;\n');
  await writeFile(join(repo.path, 'new.ts'), 'export const added = true;\n');
  const before = (await repo.run(['status', '--porcelain=v1', '-z'])).stdout;

  const snapshot = await scanWorkingTree(repo.path, { includeUntracked: true });

  assert.equal(snapshot.kind, 'working_tree');
  assert.match(snapshot.manifestHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(snapshot.files.map((file) => file.path).sort(), ['new.ts', 'tracked.ts']);
  assert.equal(snapshot.changes.find((entry) => entry.newPath === 'tracked.ts').status[0], 'M');
  assert.equal(snapshot.changes.find((entry) => entry.newPath === 'new.ts').status, '?');
  assert.match(snapshot.changes.find((entry) => entry.newPath === 'tracked.ts').diff.patch, /-export const value = 1;/);
  assert.match(snapshot.changes.find((entry) => entry.newPath === 'tracked.ts').diff.patch, /\+export const value = 2;/);
  assert.match(snapshot.changes.find((entry) => entry.newPath === 'new.ts').diff.patch, /\+export const added = true;/);
  assert.equal((await repo.run(['status', '--porcelain=v1', '-z'])).stdout, before);
  assert.equal(await readFile(join(repo.path, 'tracked.ts'), 'utf8'), 'export const value = 2;\n');
});

test('미추적 파일 제외 옵션을 지킨다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await repo.run([...identity, 'commit', '--allow-empty', '-m', 'initial']);
  await writeFile(join(repo.path, 'hidden.ts'), 'hidden\n');

  const snapshot = await scanWorkingTree(repo.path, { includeUntracked: false });

  assert.equal(snapshot.files.length, 0);
  assert.equal(snapshot.changes.length, 0);
});
