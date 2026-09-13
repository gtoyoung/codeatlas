import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { makeRepo } from './helpers/repository.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(projectRoot, 'src', 'cli', 'scan.mjs');
const identity = [
  '-c', 'user.name=Fixture',
  '-c', 'user.email=fixture@example.invalid',
];

async function runCli(args) {
  return execFileAsync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    windowsHide: true,
    encoding: 'utf8',
  });
}

test('CLI는 커밋 장부를 JSON으로만 출력한다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await writeFile(join(repo.path, 'source.ts'), 'export const source = true;\n');
  await repo.run(['add', 'source.ts']);
  await repo.run([...identity, 'commit', '-m', 'source']);

  const { stdout, stderr } = await runCli([repo.path, 'HEAD']);
  const report = JSON.parse(stdout);

  assert.equal(stderr, '');
  assert.equal(report.schemaVersion, '1.0');
  assert.equal(report.changes[0].newPath, 'source.ts');
});

test('인자 없는 CLI는 성공 JSON을 출력하지 않는다', async () => {
  await assert.rejects(runCli([]), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /^SCAN_FAILED:/);
    return true;
  });
});

test('잘못된 ref는 오류로 종료한다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await repo.run([...identity, 'commit', '--allow-empty', '-m', 'initial']);

  await assert.rejects(runCli([repo.path, 'missing']), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /^SCAN_FAILED:/);
    return true;
  });
});

test('CLI 실행은 원본 작업 파일을 변경하지 않는다', async (t) => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await writeFile(join(repo.path, 'tracked.ts'), 'committed\n');
  await repo.run(['add', 'tracked.ts']);
  await repo.run([...identity, 'commit', '-m', 'initial']);
  await writeFile(join(repo.path, 'tracked.ts'), 'local work\n');
  const before = (await repo.run(['status', '--porcelain=v1', '-z'])).stdout;

  await runCli([repo.path, 'HEAD']);

  const after = (await repo.run(['status', '--porcelain=v1', '-z'])).stdout;
  assert.equal(after, before);
});
