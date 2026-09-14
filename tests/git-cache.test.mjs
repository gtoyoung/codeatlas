import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeRepo } from './helpers/repository.mjs';
import { ensurePullRequestRefs } from '../src/modules/integrations/onedev/refs.mjs';

const identity = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid'];

test('PR ref를 원본 checkout과 분리된 bare 캐시에 가져온다', async (t) => {
  const origin = await makeRepo();
  const work = await makeRepo();
  const cacheRoot = await mkdtemp(join(tmpdir(), 'ai-dev-handoff-cache-'));
  t.after(async () => { await origin.cleanup(); await work.cleanup(); });
  await origin.run([...identity, 'commit', '--allow-empty', '-m', 'base']);
  const base = (await origin.run(['rev-parse', 'HEAD'])).stdout.trim();
  await origin.run(['update-ref', 'refs/pulls/12/base', base]);
  await origin.run([...identity, 'commit', '--allow-empty', '-m', 'head']);
  const head = (await origin.run(['rev-parse', 'HEAD'])).stdout.trim();
  await origin.run(['update-ref', 'refs/pulls/12/head', head]);
  await work.run(['remote', 'add', 'origin', origin.path]);

  const result = await ensurePullRequestRefs(work.path, 12, { cacheRoot });
  assert.notEqual(result.repoPath, work.path);
  assert.equal(result.refs.base.oid, base);
  assert.equal(result.refs.head.oid, head);
});
