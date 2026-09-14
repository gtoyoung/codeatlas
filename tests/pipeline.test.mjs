import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { makeRepo } from './helpers/repository.mjs';
import { createStore } from '../src/modules/store/database.mjs';
import { createLlmClient } from '../src/modules/llm/client.mjs';
import { analyzeAndSaveRepository } from '../src/modules/pipeline/analyze-repository.mjs';

const identity = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid'];

test('로컬 저장소를 스캔하고 관계·요약을 한 분석 결과로 저장한다', async (t) => {
  const repo = await makeRepo();
  const store = await createStore('memory://');
  t.after(async () => { await store.close(); await repo.cleanup(); });
  await writeFile(join(repo.path, 'app.ts'), "import { value } from './value';\nexport { value };\n");
  await writeFile(join(repo.path, 'value.ts'), 'export const value = 1;\n');
  await repo.run(['add', '-A']);
  await repo.run([...identity, 'commit', '-m', 'add app']);
  const registered = await store.addRepository({ name: 'fixture', path: repo.path, defaultRef: 'HEAD' });

  const scan = await analyzeAndSaveRepository({
    store,
    llm: createLlmClient({}),
    repository: registered,
    kind: 'commit',
    ref: 'HEAD',
  });

  assert.equal(scan.report.kind, 'commit');
  assert.ok(scan.graph.edges.some((edge) => edge.kind === 'imports'));
  assert.equal(scan.summary.mode, 'deterministic');
  assert.equal((await store.listScans(registered.id)).length, 1);
});
