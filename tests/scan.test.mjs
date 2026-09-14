import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { makeRepo } from './helpers/repository.mjs';
import { scanCommit } from '../src/modules/repository/scan.mjs';

const identity = [
  '-c', 'user.name=Fixture',
  '-c', 'user.email=fixture@example.invalid',
];

async function commit(repo, message) {
  await repo.run(['add', '-A']);
  await repo.run([...identity, 'commit', '-m', message]);
}

test('root 변경을 모두 미설명 상태로 기록하며 소스를 실행하지 않는다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  const marker = join(repo.path, 'executed.marker');
  await writeFile(join(repo.path, 'a.ts'), 'export const a = 1;\n');
  await writeFile(join(repo.path, 'package.json'), JSON.stringify({
    scripts: { postinstall: `node -e "require('fs').writeFileSync('${marker}', 'bad')"` },
  }));
  await commit(repo, 'add source');

  const result = await scanCommit(repo.path, 'HEAD');

  assert.equal(result.schemaVersion, '1.0');
  assert.equal(result.baseOid, null);
  assert.equal(result.counts.files, 2);
  assert.equal(result.counts.changes, 2);
  assert.equal(result.counts.unexplained, 2);
  assert.ok(result.changes.every((entry) => (
    entry.state === 'explicitly_unexplained' && entry.reason === 'pending_analysis'
  )));
  await assert.rejects(access(marker));
});

test('첫 부모 대비 수정과 삭제를 기록한다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await writeFile(join(repo.path, 'keep.ts'), 'export const value = 1;\n');
  await writeFile(join(repo.path, 'remove.ts'), 'remove me\n');
  await commit(repo, 'initial');
  await writeFile(join(repo.path, 'keep.ts'), 'export const value = 2;\n');
  await rm(join(repo.path, 'remove.ts'));
  await commit(repo, 'modify and delete');

  const result = await scanCommit(repo.path, 'HEAD');
  const byStatus = new Map(result.changes.map((entry) => [entry.status[0], entry]));

  assert.equal(result.counts.files, 1);
  assert.equal(byStatus.get('M').newPath, 'keep.ts');
  assert.equal(byStatus.get('D').oldPath, 'remove.ts');
  assert.equal(byStatus.get('D').newPath, null);
  assert.equal(byStatus.get('M').diff.status, 'available');
  assert.match(byStatus.get('M').diff.patch, /-export const value = 1;/);
  assert.match(byStatus.get('M').diff.patch, /\+export const value = 2;/);
  assert.equal(byStatus.get('M').diff.additions, 1);
  assert.equal(byStatus.get('M').diff.deletions, 1);
  assert.match(byStatus.get('D').diff.patch, /-remove me/);
});

test('빈 커밋과 merge 커밋은 첫 부모 기준으로 비교한다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await writeFile(join(repo.path, 'base.ts'), 'base\n');
  await commit(repo, 'base');
  await repo.run(['checkout', '-b', 'feature']);
  await writeFile(join(repo.path, 'feature.ts'), 'feature\n');
  await commit(repo, 'feature');
  await repo.run(['checkout', 'master']);
  await writeFile(join(repo.path, 'main.ts'), 'main\n');
  await commit(repo, 'main');
  await repo.run([...identity, 'merge', '--no-ff', 'feature', '-m', 'merge']);

  const merged = await scanCommit(repo.path, 'HEAD');
  assert.equal(merged.changes.length, 1);
  assert.equal(merged.changes[0].newPath, 'feature.ts');

  await repo.run([...identity, 'commit', '--allow-empty', '-m', 'empty']);
  const empty = await scanCommit(repo.path, 'HEAD');
  assert.equal(empty.changes.length, 0);
  assert.deepEqual(empty.counts, { files: 3, changes: 0, unexplained: 0 });
});

test('커밋 분석은 작업 트리와 index를 변경하거나 포함하지 않는다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await writeFile(join(repo.path, 'tracked.ts'), 'committed\n');
  await commit(repo, 'initial');
  await writeFile(join(repo.path, 'tracked.ts'), 'staged\n');
  await repo.run(['add', 'tracked.ts']);
  await writeFile(join(repo.path, 'tracked.ts'), 'unstaged\n');
  await writeFile(join(repo.path, 'untracked.ts'), 'untracked\n');
  const beforeStatus = (await repo.run(['status', '--porcelain=v1', '-z'])).stdout;
  const beforeContent = await readFile(join(repo.path, 'tracked.ts'), 'utf8');

  const result = await scanCommit(repo.path, 'HEAD');

  const afterStatus = (await repo.run(['status', '--porcelain=v1', '-z'])).stdout;
  assert.equal(afterStatus, beforeStatus);
  assert.equal(await readFile(join(repo.path, 'tracked.ts'), 'utf8'), beforeContent);
  assert.ok(!result.files.some((entry) => entry.path === 'untracked.ts'));
});
