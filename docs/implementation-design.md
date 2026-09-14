# 상세 구현 설계서

- 버전: 0.2 / 작성일: 2026-09-14
- 기준: [제품 설계 v0.3](design.md), [리서치 근거](research-evidence.md)
- 상태: 로컬 MVP 구현 중. Git 커밋 이력·로컬 소스·읽기 전용 OneDev PR 계약을 구현했다.
- 범위: Git 커밋·로컬 소스 분석과 OneDev PR 조회. AI 인계 파일·테스트 실행·배포 기록 수집은 제외.

## 1. 구현 단위와 의존성

전체를 한 번에 구현하지 않고 실제로 확인할 수 있는 수직 기능으로 나눈다.

| 단계 | 산출물 | 의존 |
|---|---|---|
| A | 로컬 커밋의 파일·변경 장부를 JSON으로 출력 | 없음 |
| B | 작업 트리 스냅샷·DB·재시작 가능한 큐 | A |
| C | 타입·Next.js 관계와 전후 영향 분석 | A, B |
| D | LLM 설명·주장별 근거 검사·품질 게이트 | C |
| E | 웹 화면·질의응답·맥락 문서 | B, C, D |
| F | React Flow 탐색·팀 공유 clone | E |

[단계 A 실행 계획](superpowers/plans/2026-09-13-git-ledger.md)은 독립적으로 실행 가능한 첫 계획이다. B~F의 상세 계약은 본 문서에 정의하며 각각 착수 시 파일별 실행 계획을 분리한다. 단계 A만 끝내고 제품 전체가 완료됐다고 표시하지 않는다.

## 2. 디렉터리와 책임

```text
src/
  app/                         Next.js 페이지와 내부 API
  modules/
    repository/                경로 등록·Git 실행·ref 고정
      git.ts                   셸 없는 Git 실행과 제한
      inventory.ts             tree·commit·diff를 구조 데이터로 변환
      scan.ts                  커밋 분석 유스케이스
    snapshot/                  객체 읽기·작업 트리 캡처·해시
    ledger/                    변경 단위·처리 상태·계수
    analysis/
      typescript/              파싱·타입·선언·참조
      nextjs/                  버전별 파일 규약
      graph/                   전후 관계·영향 경로·탐색 frontier
    evidence/                  위치·원문·주장·검사 게이트
    llm/                       공급자 어댑터·검색·구조화 생성
    query/                     질의응답·맥락 출력
    jobs/                      lease·재시도·무효화
  contracts/                   공유 타입·직렬화 스키마
  db/                          쿼리·migration 실행
  worker/main.ts               큐 처리 프로세스
  cli/scan.ts                  단계 A와 진단용 CLI
migrations/                    SQL 스키마와 인덱스
prompts/                       생성·검토 프롬프트 버전
fixtures/                      합성 소스·Git 표본 생성 코드
tests/                        모듈·통합·웹 테스트
```

각 모듈은 공개 인터페이스를 통해서만 다른 모듈에 접근한다. Git·파일 I/O는 repository·snapshot에 모으고 LLM에서 직접 파일이나 명령을 실행하지 못하게 한다. route handler는 인증·입력 검사·유스케이스 호출만 수행한다.

## 3. 실행 환경과 패키지 정책

TypeScript와 Node.js를 공통 언어·런타임으로 사용한다. Next.js는 웹 경계, PostgreSQL은 영속 데이터와 큐에 사용한다. 초기 분석 코어는 Next.js와 독립적으로 실행된다.

단계 A는 Node 내장 테스트 러너와 기본 JavaScript ESM을 사용해 설치 없이 Git 수집 계약을 검증한다. 단계 B에서 지원 Node·Next.js·TypeScript·PostgreSQL 조합을 공식 지원표로 확인하고 정확한 버전·lockfile을 커밋한다. 분석 코어의 JavaScript를 TypeScript로 전환해도 CLI JSON 계약과 fixture는 유지한다.

외부 라이브러리 API를 가정한 구현을 이 문서에 고정하지 않는다. 스키마 검증기는 API 경계와 LLM 결과에서 동일한 계약을 적용한다. ORM은 필수로 두지 않으며 SQL migration을 기준 스키마로 관리한다.

## 4. 공통 타입 계약

```ts
type SnapshotKind = 'commit' | 'working_tree';
type FileState = 'indexed' | 'partial' | 'failed' | 'excluded';
type Resolution = 'resolved' | 'ambiguous' | 'unresolved' | 'external_boundary';
type UnitState = 'explained' | 'explicitly_unexplained' | 'excluded_with_reason';
type ClaimType = 'git_observation' | 'code_observation' |
  'recorded_statement' | 'inference' | 'unknown';
type Support = 'supported' | 'partial' | 'unsupported' | 'contradicted' | 'not_checked';

interface SourceRange {
  startLine: number; startCharacter: number;
  endLine: number; endCharacter: number;
  encoding: 'utf16';
}
interface SnapshotRef {
  id: string; repositoryId: string; kind: SnapshotKind;
  baseCommit: string | null; manifestHash: string;
}
interface EvidenceRef {
  id: string; snapshotId: string; path: string;
  blobOid: string; excerptHash: string;
  range: SourceRange; symbolId: string | null;
  side: 'before' | 'after' | 'current';
}
interface ClaimDraft {
  text: string; type: ClaimType; changeUnitIds: string[];
  evidenceIds: string[]; counterevidenceIds: string[];
}
```

SourceRange는 0 기반·끝 제외다. 원문 바이트는 별도 보관하고 텍스트 디코딩·줄바꿈 변환·위치 계산 정책을 기록한다. Git OID는 저장소 객체 형식에 맞게 검증하며 SHA-1 길이로만 고정하지 않는다. 앱 콘텐츠 해시는 SHA-256으로 분리한다. ID는 서버에서 발급하고 입력 LLM이 새 Evidence ID를 발급할 수 없다.

## 5. Git 수집 계약

```ts
interface GitPort {
  resolveCommit(repoPath: string, ref: string): Promise<string>;
  listFiles(repoPath: string, commitOid: string): Promise<TreeEntry[]>;
  listChanges(repoPath: string, baseOid: string | null,
              targetOid: string): Promise<ChangedEntry[]>;
  readBlob(repoPath: string, blobOid: string): Promise<Uint8Array>;
}
interface TreeEntry { path: string; mode: string; oid: string; objectType: string }
interface ChangedEntry {
  status: string; oldPath: string | null; newPath: string | null;
  oldOid: string | null; newOid: string | null;
}
```

실행 규칙:

- execFile 또는 spawn의 인자 배열을 사용한다. shell=false, GIT_OPTIONAL_LOCKS=0, pager 비활성화.
- 저장소 경로를 정규화하고 등록된 root 안의 경로인지 확인한다. 네트워크 경로·symlink 정책을 명시적으로 검사한다.
- diff는 외부 diff·textconv를 비활성화하고 NUL 구분 raw 출력을 사용한다.
- 명령별 timeout·출력 바이트 상한을 둔다. 상한 초과 데이터를 정상 결과로 파싱하지 않는다.
- 선택 ref를 먼저 불변 commit OID로 고정하고 뒤 작업에는 OID를 사용한다.
- root 변경은 빈 트리와의 차이로 해석한다. merge는 첫 부모 순변경으로 명시한다.
- index·worktree를 수정하지 않으며 fetch는 별도 활성화된 명령에서만 실행한다.
- 비 UTF-8 경로 등 현재 디코더가 안전하게 표시하지 못하는 경로는 원시 경로 바이트를 보관하고 표시 제한을 남긴다.

## 6. 스냅샷·변경 장부

commit 스냅샷은 Git tree·blob과 기준 OID로 구성한다. 원문이 Git GC 후 사라질 수 있으므로 게시 근거에 사용한 blob은 제품 저장소에 내용 주소 방식으로 보존한다.

working_tree는 HEAD·index·선택된 파일 목록을 조사하고 파일을 캡처한 뒤 상태·해시를 다시 비교한다. 최대 3회 안에 안정된 수집을 얻지 못하면 SNAPSHOT_UNSTABLE로 종료한다. 파일별 읽기를 반복 확인한 상태이며 OS 수준의 원자적 파일시스템 스냅샷이라고 표현하지 않는다.

변경 장부 생성 순서:

1. raw Git 변경 목록을 전체 수집한다.
2. 파일 정책을 적용하고 제외 항목도 상태와 사유를 유지한다.
3. 전후 텍스트 diff와 AST 단위를 연결한다.
4. AST 미연결 hunk를 raw_diff 단위로 보존한다.
5. 설명 생성 전에 모든 단위를 explicitly_unexplained / pending_analysis로 초기화한다.
6. 근거 검사를 통과한 설명이 연결된 단위만 explained로 변경한다.

빈 변경은 분모 0과 '변경 없음'으로 표시한다. 실행 실패나 목록 일부 수집을 빈 변경으로 변환하지 않는다. 변경 단위 key는 changeSet + file identity + hunk 범위 + 내용 해시로 생성한다.

## 7. DB와 트랜잭션

| 테이블 | 기본키·필수 제약 | 주요 인덱스 |
|---|---|---|
| repositories | id, 고유 정규화 local root | root |
| snapshots | id, repository FK, kind, manifest_hash | repo+hash+kind unique |
| snapshot_files | snapshot+path_bytes_hash unique, state, blob_oid | snapshot+state |
| commits | repository+oid unique | author, commit_time |
| change_sets | repository, base/target snapshot FK | repo+base+target+policy unique |
| change_units | id, change_set FK, state, reason | change_set+state |
| graph_nodes | snapshot+symbol_key unique | snapshot+kind |
| graph_edges | snapshot, source/target, kind, provenance | snapshot+source, snapshot+target |
| reference_candidates | snapshot, location, resolution, reason | snapshot+resolution |
| evidence | id, snapshot FK, 원문/blob hash, range | snapshot+path_hash |
| claims | id, run FK, type, support, text | run+support |
| claim_evidence | claim/evidence FK, role | claim+evidence+role unique |
| claim_units | claim/unit FK | claim+unit unique |
| analysis_runs | id, input_hash, versions, state, gate | input_hash+pipeline_version |
| analysis_dependencies | dependent result, source fingerprint | source fingerprint |
| jobs | id, dedupe_key unique, lease_token, lease_until | state+available_at |

graph_edges의 source/target은 같은 스냅샷 노드만 허용한다. 애플리케이션 검사와 복합 FK로 강제한다. before/after 관계 비교는 graph_deltas로 분리해 서로 다른 스냅샷 연결을 암묵적으로 허용하지 않는다.

migration 순서: 001 repository/snapshot → 002 changes/ledger → 003 graph → 004 evidence/claims → 005 jobs/dependencies. 초기에는 DB 재생성 가능한 개발 migration만 적용하고 데이터가 생긴 뒤에는 별도 명시적 전진 migration을 작성한다.

분석은 임시 run에 결과를 저장하고 계수·FK·근거 검사 완료 후 한 트랜잭션에서 published_run 포인터를 갱신한다. 과거 run이 나중에 끝나도 최신 snapshot 포인터를 변경하지 못한다. 분석 상태와 게시 게이트는 별도 필드다.

## 8. 큐·재시도·복구

```ts
type JobKind = 'capture' | 'index' | 'compare' | 'explain' | 'validate' | 'publish';
interface JobInput { repositoryId: string; snapshotIds: string[]; pipelineVersion: string }
```

워커는 짧은 트랜잭션에서 실행 가능한 작업을 잠그고 lease를 얻는다. lease 기간은 60초, heartbeat는 15초 간격을 초기값으로 둔다. 결과 갱신은 lease_token이 일치할 때만 허용한다. 만료된 워커의 늦은 쓰기를 거부한다.

일시 오류는 최대 3회 지수 지연으로 재시도하고 parser unsupported·invalid ref·권한 거부는 재시도하지 않는다. LLM의 근거 보완 생성 2회는 인프라 재시도 횟수와 별도다. 취소는 새 작업 등록을 중단하고 프로세스 종료를 요청하며 부분 run을 게시하지 않는다.

정확히 한 번 실행을 가정하지 않는다. at-least-once 실행과 입력 해시·고유 제약·lease fencing으로 결과 중복을 제어한다.

## 9. 관계 분석 구현

TypeScript 분석기는 스냅샷 CompilerHost에서 Program을 만들고 syntax → symbol resolution → reference 후보 순서로 처리한다. type-only import와 값 참조를 분리한다. symbol 이름만으로 연결하지 않고 선언 위치·모듈 정보를 포함한다.

Next.js 규칙은 supports(version, fileLayout), extract(snapshot) 계약을 가지며 규칙별 fixture를 둔다. 미지원 버전에서는 resolved 규약 관계를 생성하지 않는다. 최소 App/Pages 라우트, layout, route group, use server 선언부터 구현하고 나머지는 미지원 표시를 먼저 제공한다.

변경 영향은 이전 그래프의 삭제 심벌과 새 그래프의 변경 심벌을 시작점으로 역참조를 탐색한다. visited key는 snapshot+node+relation filter다. 분석 예산을 초과하면 frontier를 저장한다. 설정·lockfile·분석기 버전 변경은 전체 의미 분석 캐시 무효화 대상으로 처리한다.

## 10. LLM·근거 처리

```ts
interface LlmPort {
  generateClaims(input: EvidenceBundle, signal: AbortSignal): Promise<ClaimDraft[]>;
  reviewClaim(input: ClaimReviewInput, signal: AbortSignal): Promise<ReviewResult>;
}
interface EvidenceBundle {
  snapshotIds: string[]; changeUnitIds: string[];
  evidence: Array<{ id: string; text: string; role: string }>;
  unresolvedReasons: string[];
}
interface ClaimReviewInput { claim: ClaimDraft; bundle: EvidenceBundle }
interface ReviewResult { support: Support; evidenceIds: string[]; reason: string }
```

공급자 응답을 JSON 스키마로 검사하고 문자열에서 임의 ID를 복구해 게시하지 않는다. 서버의 evidence allowlist와 교차 검사한다. 전체 저장소를 매번 넘기지 않고 변경 단위별 전후 근거를 우선 배정한다.

검사는 구조 → 결정적 사실 대조 → 의미 지지 검사 → 변경 장부 대조 순서다. 지원된 관계만으로 만들 수 있는 설명은 LLM 없이 정형 문장으로 생성할 수 있다. 의미 검토 결과에는 LLM 검토임을 표시한다.

프롬프트 파일은 generate-claims.v1.md와 review-claim.v1.md로 분리한다. 필수 규칙은 하나의 주장에 하나의 사실, 원문 없는 동기는 inference, 부재·전체성 표현 제한, 근거 ID 재사용만 허용, 미해석 영역 명시다. 프롬프트 본문 해시와 공급자·모델 설정을 run에 저장한다.

## 11. API 요청·응답 계약

```json
{
  "repositoryId": "repo-1",
  "target": {"kind": "commit", "ref": "HEAD"},
  "compare": {"mode": "first-parent"}
}
```

POST /api/repositories/:id/scan은 위 입력을 검증하고 202 {jobId, snapshotId:null}을 반환한다. ref 해석 후 job 상태에 snapshotId를 채운다. working_tree는 ref 대신 includeUntrackedPaths를 받고 등록 root 안의 경로만 허용한다.

공통 오류 형식은 {error:{code,message,retryable},requestId}다. NOT_FOUND=404, INVALID_INPUT=400, ACCESS_DENIED=403, SNAPSHOT_UNSTABLE=409, SOURCE_LIMIT=422, DEPENDENCY_UNAVAILABLE은 부분 분석 사유, INTERNAL_ERROR=500으로 구분한다. 비동기 오류는 GET /api/jobs/:id의 failed 상태와 error에 기록한다.

조회 응답에는 snapshotId·runId·gate·coverage를 포함한다. 페이지네이션 cursor에는 정렬 시각과 ID를 사용한다. 근거 조회는 blob 존재·해시를 검증하고 보관 만료는 410을 반환한다. 현재 파일로 조용히 대체하지 않는다.

## 12. 웹 화면 구현

| 경로 | 데이터 | 사용 행동 |
|---|---|---|
| /repositories | 등록 경로·ref·마지막 분석 | 등록·스캔 |
| /repositories/[id] | 변경 피드·coverage | 기간·작성자·기능 필터 |
| /changes/[id] | 전후 diff·단위 장부·claims | 문장 클릭으로 근거 펼치기 |
| /snapshots/[id]/features | 정적 관계·미해석 영역 | 진입점부터 탐색 |
| /snapshots/[id]/questions | 버전 고정 질문·답변 | 근거 확인·맥락 복사 |

공통 SnapshotBanner는 커밋/working_tree·기준 버전·부분 결과를 항상 표시한다. CoveragePanel은 파일 수·미설명 수·제외 사유를 노출한다. EvidencePanel은 전후 코드와 주장 종류·검사 방법을 표시한다. summary만 내려받아 근거를 로딩할 수 없는 상태는 정상 완료로 표시하지 않는다.

React Flow는 단계 F에 연결한다. C단계 관계 결과는 먼저 목록·경로 형태로 제공해 UI 라이브러리 없이 검증 가능하게 한다.

## 13. 운영과 제한

분석 대상 소스의 스크립트·설정 코드를 실행하지 않는다. LLM 키는 서버 환경 설정으로만 읽고 출력에 포함하지 않는다. Git credential은 Git 자체 경로에 맡기고 원격 URL에서 토큰을 제거한다.

로컬 API도 허용 origin·CSRF 방어·경로 범위 검사를 적용한다. 브라우저 요청으로 임의 프로그램·임의 Git 인자를 실행할 수 없다. 서버 공유 모드는 인증 도입 전 외부에 노출하지 않는다.

초기 상한은 설정으로 관리한다: 단일 텍스트 blob 2 MiB, Git 메타데이터 출력 64 MiB, capture 재시도 3회, 영향 탐색 10,000 노드·50,000 관계·30초. 상한은 제외 또는 partial을 발생시키며 조용한 잘림을 허용하지 않는다. fixture와 실제 저장소로 비용·메모리 측정 후 조정한다.

## 14. 인수·추적표

| 제품 설계 요구 | 구현 위치 | 평가 |
|---|---|---|
| 8장 Git 정합성 | repository, snapshot | root·merge·rename·working tree fixtures |
| 19장 누락 장부 | ledger | 전 항목 상태·0분모·제외 계수 |
| 20장 타입·규약 | analysis/typescript, nextjs | 버전별 참조 precision/recall |
| 21장 전후 영향 | analysis/graph, jobs | 삭제 호출자·예산 frontier·무효화 |
| 22장 의도·근거 | evidence, llm | 무관 인용·과장 의도·버전 혼합 차단 |
| 23장 검색·분할 | llm, query | chunk 병합 시 단위 유실 차단 |
| 24장 UI·저장 | db, app | partial·근거·미설명 노출 |
| 25장 품질 | fixtures, tests | 고정 보류 표본과 사람 라벨 대조 |

정확도 목표는 제품 설계 25장을 따른다. 아직 실제 소스나 모델 평가를 수행하지 않았으므로 수치를 달성했다고 표시하지 않는다. 단계별 commit과 검증 결과를 남긴다.

## 15. 구현 현황: 커밋·PR 작업 공간

`src/modules/repository/history.mjs`는 `git log --all`과 `for-each-ref`를 통해 모든 ref에서 도달 가능한 커밋의 SHA, 부모, author/committer, 메시지, 변경 파일, ref를 읽는다. shallow clone은 `complete: false`로 표시하고, 원본 checkout·index는 수정하지 않는다. `GET /api/repositories/:id/commits`가 검색과 최대 100개 목록을 제공한다.

`src/modules/integrations/onedev/client.mjs`는 서버 전용 Bearer 토큰으로 OneDev PR 목록과 상세 하위 리소스를 읽는다. `refs.mjs`는 PR 번호의 `base/head/merge` ref가 현재 로컬 Git 객체에 있는지 확인한다. API 응답은 PR 기록과 로컬 ref 상태를 분리하며, 토큰은 응답·영속 저장소에 포함하지 않는다.

웹 화면은 현재 변경, 커밋, PR 탭으로 구성한다. 커밋은 검색 가능한 시간순 장부와 선택 상세, PR은 상태 필터·목록·상세 근거 패널로 보여준다. 관계 그래프는 사용자 화면에 노출하지 않고 기존 영향 확인 목록을 유지한다. 실제 OneDev 서버가 없는 개발 환경에서는 어댑터 fixture 테스트와 미설정 상태 UI로 검증한다.
