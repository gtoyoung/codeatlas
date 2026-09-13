import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../src/modules/store/database.mjs';

test('저장소와 분석 결과를 PostgreSQL 스키마에 보존한다', async (t) => {
  const store = await createStore('memory://');
  t.after(() => store.close());
  const repository = await store.addRepository({
    name: 'sample',
    path: 'C:\\sample',
    defaultRef: 'HEAD',
  });
  const scan = await store.saveScan({
    repositoryId: repository.id,
    kind: 'commit',
    targetOid: 'abc123',
    baseOid: null,
    manifestHash: 'manifest',
    report: { counts: { files: 1, changes: 1 } },
    graph: { nodes: [], edges: [], coverage: { totalFiles: 1 } },
    summary: { title: '첫 분석', mode: 'deterministic' },
  });

  assert.equal((await store.listRepositories())[0].name, 'sample');
  assert.equal((await store.listScans(repository.id))[0].id, scan.id);
  assert.equal((await store.getScan(scan.id)).report.counts.changes, 1);
});

test('같은 로컬 경로를 중복 등록하지 않는다', async (t) => {
  const store = await createStore('memory://');
  t.after(() => store.close());
  const first = await store.addRepository({ name: 'one', path: 'C:\\same', defaultRef: 'HEAD' });
  const second = await store.addRepository({ name: 'two', path: 'C:\\same', defaultRef: 'main' });

  assert.equal(first.id, second.id);
  assert.equal((await store.listRepositories()).length, 1);
});
