import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('부모 폴더가 없는 로컬 데이터 경로를 초기화한다', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ai-dev-handoff-db-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await createStore(join(root, 'nested', 'postgres'));
  t.after(() => store.close());

  assert.deepEqual(await store.listRepositories(), []);
});

test('분석 질문 이력을 생성 순서로 다시 읽는다', async (t) => {
  const store = await createStore('memory://');
  t.after(() => store.close());
  const repository = await store.addRepository({ name: 'questions', path: 'C:\\questions', defaultRef: 'HEAD' });
  const scan = await store.saveScan({
    repositoryId: repository.id,
    kind: 'working_tree',
    targetOid: null,
    baseOid: null,
    manifestHash: 'manifest',
    report: {},
    graph: {},
    summary: {},
  });

  const first = await store.saveQuestion({ scanId: scan.id, question: '왜 바뀌었나?', answer: { answer: '기록을 확인했습니다.' } });
  await store.saveQuestion({ scanId: scan.id, question: '어디에 영향이 있나?', answer: { answer: '관계를 확인하세요.' } });
  const questions = await store.listQuestions(scan.id);

  assert.equal(questions.length, 2);
  assert.equal(questions[0].id, first.id);
  assert.equal(questions[0].scanId, scan.id);
  assert.equal(questions[0].question, '왜 바뀌었나?');
  assert.deepEqual(questions[0].answer, { answer: '기록을 확인했습니다.' });
  assert.ok(questions[0].createdAt <= questions[1].createdAt);
});
