# Git 변경 장부 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 등록한 로컬 Git 저장소의 특정 커밋에 포함된 파일과 첫 부모 대비 변경 목록을 읽어 JSON 장부로 출력한다.

**Architecture:** 대상 소스를 실행하지 않는 로컬 CLI다. Git 명령 경계·NUL 파서·장부 계산을 분리하고 임시 Git 저장소로 실제 동작을 검증한다. LLM·DB·웹은 이 단계에 포함하지 않는다.

**Tech Stack:** Node.js ESM, node:test, node:child_process, Git CLI. 최초 수직 기능은 외부 npm 패키지 없이 .mjs로 작성한다.

**Spec:** [제품 설계](../../design.md), [상세 구현 설계](../../implementation-design.md)

## Global Constraints

- 확정 입력: Git 커밋·이력 및 로컬 소스. 제품명과 세부 기술은 제안.
- OneDev API·PR·리뷰·AI 인계·테스트 실행·배포 기록 수집을 추가하지 않는다.
- 대상 저장소의 checkout·index·미커밋 파일을 변경하지 않는다.
- 단계 A는 commit 스냅샷 목록만 구현한다. working_tree 수집은 단계 B다.
- 파일·변경 전체를 수집하고 제외도 상태로 남긴다. LLM 설명 없이 explained로 표시하지 않는다.
- 구현 시작 전 node --version, git --version을 확인한다. Node 내장 테스트 실행이 불가능하면 런타임 준비를 선행하고 성공으로 표시하지 않는다.
- 현재 이 계획은 문서이며 아래 코드 파일은 아직 생성하지 않는다.

## 파일 구조

| 경로 | 책임 |
|---|---|
| package.json | type=module, test·scan 명령 |
| src/modules/repository/git.mjs | Git 실행, ref 고정 |
| src/modules/repository/inventory.mjs | ls-tree·diff-tree 출력 파서 |
| src/modules/repository/scan.mjs | 목록 수집과 JSON 계약 |
| src/cli/scan.mjs | 인자·출력·종료 코드 |
| tests/helpers/repository.mjs | 임시 fixture 저장소 |
| tests/git.test.mjs | 읽기 동작·입력 실패 |
| tests/inventory.test.mjs | NUL 파서·삭제·rename |
| tests/scan.test.mjs | 장부와 보존성 |
| tests/cli.test.mjs | JSON·실패 출력 |

## Task 1: Git 실행 경계와 실제 저장소 fixture

**Files:** Create package.json, src/modules/repository/git.mjs, tests/helpers/repository.mjs, tests/git.test.mjs.

**Interfaces:** git(repo,args) → Promise<Buffer>; resolveCommit(repo,ref) → Promise<string>; makeRepo() → Promise<{path,run,cleanup}>. run(args)는 fixture 안에서만 명령을 실행한다.

- [ ] package.json에 {"private":true,"type":"module","scripts":{"test":"node --test tests/*.test.mjs","scan":"node src/cli/scan.mjs"}}를 작성한다.
- [ ] tests/helpers/repository.mjs에 mkdtemp로 OS temp 아래 임시 폴더를 만들고 git init, git -c user.name=Fixture -c user.email=fixture@example.invalid commit 방식으로 fixture 커밋을 만드는 도우미를 작성한다. cleanup은 생성한 정확한 임시 경로만 재귀 삭제한다. 실제 사용자 저장소는 fixture로 사용하지 않는다.
- [ ] 다음 회귀 테스트를 작성한다.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeRepo} from './helpers/repository.mjs';
import {resolveCommit} from '../src/modules/repository/git.mjs';

test('ref를 고정하며 옵션처럼 보이는 입력을 거부한다', async t => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await repo.run(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',
    'commit','--allow-empty','-m','initial']);
  const oid = await resolveCommit(repo.path, 'HEAD');
  assert.match(oid, /^[a-f0-9]+$/);
  await assert.rejects(resolveCommit(repo.path, '--help'));
  await assert.rejects(resolveCommit(repo.path, 'missing-branch'));
});
```

- [ ] node --test tests/git.test.mjs를 실행해 미구현 import 실패를 확인한다.
- [ ] 실행 경계를 아래 동작으로 구현한다.

```js
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync = promisify(execFile);
export async function git(repo, args) {
  const {stdout} = await execFileAsync('git', ['-C', repo, '--no-pager', ...args], {
    encoding: 'buffer', timeout: 30000, maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    env: {...process.env, GIT_OPTIONAL_LOCKS:'0', GIT_TERMINAL_PROMPT:'0'}
  });
  return stdout;
}
export async function resolveCommit(repo, ref) {
  if (!ref || ref.startsWith('-') || ref.includes('\0')) throw new Error('INVALID_REF');
  const out = await git(repo, ['rev-parse','--verify','--end-of-options',ref+'^{commit}']);
  const oid = out.toString('ascii').trim();
  if (!/^[a-f0-9]+$/.test(oid)) throw new Error('INVALID_OID');
  return oid;
}
```

- [ ] 테스트를 통과시키고 존재하지 않는 저장소·출력 상한 실패가 정상 목록으로 변환되지 않는 테스트를 추가한다.
- [ ] git add package.json src/modules/repository/git.mjs tests/helper* tests/git.test.mjs 후 git commit -m "feat: add read-only Git command boundary"를 실행한다.

## Task 2: tree·변경 raw 파서

**Files:** Create src/modules/repository/inventory.mjs, tests/inventory.test.mjs.

**Interfaces:** parseTree(raw:Buffer) → TreeEntry[]; parseChanges(raw:Buffer) → ChangedEntry[]. TreeEntry와 ChangedEntry 필드는 상세 구현 설계 5장을 따른다.

- [ ] 탭이 포함된 경로를 첫 탭에서만 나누는 테스트를 작성한다.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTree, parseChanges} from '../src/modules/repository/inventory.mjs';

test('경로 안의 공백과 탭을 보존한다', () => {
  const rows = parseTree(Buffer.from('100644 blob abc123\t한 글\t파일.ts\0'));
  assert.equal(rows[0].path, '한 글\t파일.ts');
});
test('rename은 이전과 새 경로를 별도로 읽는다', () => {
  const raw = Buffer.from(':100644 100644 abc123 def456 R100\0old.ts\0new.ts\0');
  const [entry] = parseChanges(raw);
  assert.equal(entry.oldPath, 'old.ts');
  assert.equal(entry.newPath, 'new.ts');
});
```

- [ ] node --test tests/inventory.test.mjs를 실행해 실패를 확인한다.
- [ ] parseTree는 NUL로 record를 나누고 첫 TAB 이전의 mode/type/OID와 이후 path를 파싱한다. strict UTF-8 디코더를 적용하며 실패 시 PATH_ENCODING_UNSUPPORTED로 종료한다. 단계 A는 미지원 경로를 손실 변환한 성공 결과를 만들지 않는다.

```js
const decoder = new TextDecoder('utf-8', {fatal:true});
export function parseTree(raw) {
  return decoder.decode(raw).split('\0').filter(Boolean).map(record => {
    const tab = record.indexOf('\t');
    if (tab < 0) throw new Error('INVALID_TREE_RECORD');
    const [mode, objectType, oid] = record.slice(0, tab).split(' ');
    return {mode, objectType, oid, path: record.slice(tab + 1)};
  });
}
```

- [ ] parseChanges는 NUL token cursor를 사용한다. header의 status 첫 글자가 R/C면 path 두 개, 그 밖에는 한 개를 소비한다. A는 oldPath/oldOid=null, D는 newPath/newOid=null, M/T는 양쪽 path 동일, R/C는 각 경로를 보관한다. 잘못된 header·누락 token은 INVALID_DIFF_RECORD로 실패시킨다.

```js
const width = status[0] === 'R' || status[0] === 'C' ? 2 : 1;
const paths = tokens.slice(cursor, cursor + width);
if (paths.length !== width || paths.some(p => !p)) throw new Error('INVALID_DIFF_RECORD');
cursor += width;
```

- [ ] A/D/M/T, 경로 개행, 빈 출력, 잘린 rename, 잘못된 UTF-8 테스트를 추가하고 node --test tests/inventory.test.mjs를 통과시킨다.
- [ ] 두 파일을 stage하고 git commit -m "feat: parse Git tree and raw changes"를 실행한다.

## Task 3: commit 변경 장부

**Files:** Create src/modules/repository/scan.mjs, tests/scan.test.mjs.

**Interfaces:** scanCommit(repo,ref) → Promise<{schemaVersion,targetOid,baseOid,files,changes,counts}>. changes에는 state='explicitly_unexplained', reason='pending_analysis'가 붙는다.

- [ ] root commit에 파일 두 개를 추가한 fixture, 두 번째 커밋에서 하나 삭제·하나 수정하는 fixture로 counts와 경로를 검증하는 테스트를 작성한다. source 코드와 package script가 실행되지 않는지 marker 파일 부재로 확인한다.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {makeRepo} from './helpers/repository.mjs';
import {scanCommit} from '../src/modules/repository/scan.mjs';
test('root 변경은 모두 미설명 상태로 기록한다', async t => {
  const repo = await makeRepo();
  t.after(repo.cleanup);
  await writeFile(join(repo.path, 'a.ts'), 'export const a = 1;\n');
  await repo.run(['add','a.ts']);
  await repo.run(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',
    'commit','-m','add a']);
  const result = await scanCommit(repo.path, 'HEAD');
  assert.equal(result.baseOid, null);
  assert.equal(result.counts.changes, 1);
  assert.equal(result.changes[0].state, 'explicitly_unexplained');
  assert.equal(result.changes[0].newPath, 'a.ts');
});
```
- [ ] node --test tests/scan.test.mjs로 실패를 확인한다.
- [ ] 아래 Git 호출 흐름으로 구현한다.

```js
const targetOid = await resolveCommit(repo, ref);
const parentsRaw = await git(repo, ['rev-list','--parents','-n','1',targetOid]);
const parents = parentsRaw.toString('ascii').trim().split(' ').slice(1);
const baseOid = parents[0] ?? null;
const treeRaw = await git(repo, ['ls-tree','-r','-z','--full-tree',targetOid]);
const diffArgs = ['diff-tree','--no-commit-id','--raw','-r','-z',
  '--no-abbrev','--no-ext-diff','--no-textconv','-M'];
const changeRaw = baseOid
  ? await git(repo, [...diffArgs,baseOid,targetOid])
  : await git(repo, [...diffArgs,'--root',targetOid]);
const files = parseTree(treeRaw);
const changes = parseChanges(changeRaw).map(entry => ({
  ...entry, state:'explicitly_unexplained', reason:'pending_analysis'
}));
return {schemaVersion:'1.0', targetOid, baseOid, files, changes,
  counts:{files:files.length, changes:changes.length, unexplained:changes.length}};
```

- [ ] 빈 커밋은 changes=0, root는 baseOid=null, merge는 첫 부모 비교인지 실제 Git fixture로 검증한다.
- [ ] 분석 전에 만든 미커밋 파일 내용과 index bytes를 분석 후 비교해 변화가 없음을 검증한다. 작업 트리의 새 파일이 커밋 files에 나타나지 않는지도 확인한다.
- [ ] node --test tests/scan.test.mjs를 통과시킨 뒤 git commit -m "feat: emit commit change ledger"로 관련 두 파일을 커밋한다.

## Task 4: CLI와 첫 기능 인수

**Files:** Create src/cli/scan.mjs, tests/cli.test.mjs; Modify README.md.

**Interfaces:** node src/cli/scan.mjs <repo-path> [ref]. 성공 stdout은 JSON만, 실패 stderr는 오류 코드·메시지, exit code는 1이다.

- [ ] 자식 프로세스로 CLI를 실행하는 테스트를 작성한다. 성공 JSON, 누락 경로 오류, 잘못된 ref의 비정상 종료, 원본 파일 보존을 확인한다.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);
test('인자 없는 CLI는 JSON 성공을 출력하지 않는다', async () => {
  await assert.rejects(exec(process.execPath, ['src/cli/scan.mjs']), error => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /SCAN_FAILED/);
    return true;
  });
});
```
- [ ] node --test tests/cli.test.mjs로 실패를 확인한다.
- [ ] 다음 CLI를 작성하고 내부 에러에서 인증정보·전체 환경을 출력하지 않는다.

```js
import {scanCommit} from '../modules/repository/scan.mjs';
const [repo, ref = 'HEAD'] = process.argv.slice(2);
try {
  if (!repo) throw new Error('USAGE: scan <repo-path> [ref]');
  const report = await scanCommit(repo, ref);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  process.stderr.write((error.code === 'ENOENT' ? 'GIT_NOT_FOUND' : 'SCAN_FAILED') + '\n');
  process.exitCode = 1;
}
```

- [ ] README에 실행 명령, schemaVersion=1.0, explained가 아직 없다는 점, commit-only 범위를 기록한다.
- [ ] node --test tests/*.test.mjs를 실행해 모두 통과하는지 확인하고 git diff --check를 실행한다.
- [ ] git commit -m "feat: expose local commit ledger CLI"로 CLI·테스트·README를 커밋한다.

## 자체 검토와 후속 범위

이 계획은 전체 제품의 Git 수집 경계만 구현한다. 큰 파일 분류·blob 보관·hunk/AST 단위 장부·working_tree·DB·타입/Next.js·LLM·웹·품질 목표는 상세 구현 설계 B~F에 남는다. 단계 A가 출력하는 파일 단위 changes를 제품의 최종 의미 단위라고 표시하지 않는다.

계획 실행 시 실제 버전에서 Git 출력 형식을 fixture로 확인한다. 예상과 다른 출력은 파서의 조용한 보정이 아니라 명시적 실패로 처리한다. 서브에이전트 병렬 실행은 이 계획의 필수 조건이 아니다.
