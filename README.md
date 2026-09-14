# Code Atlas — AI 개발 인계실

2~4명 개발팀의 **Git 커밋과 로컬 소스**를 분석해 변경 내용·코드 구조·영향 후보를 설명하는 도구입니다.

로컬 MVP가 구현되어 있으며 Git 커밋과 현재 작업 트리를 분석할 수 있습니다.

- [상세 설계서](docs/design.md): 로컬 실행 구조, Git·소스 수집, 데이터 모델, LLM, 화면, 구현 단계
- [설계 결정 기록](docs/decisions.md): 확정 범위와 기술 제안

## 분석 흐름

OneDev Git 원격 → 일반 Git fetch → 로컬 Git·소스 스냅샷 → 정적 분석·LLM → 변경 장부·영향 확인 목록·근거 질의.

OneDev는 Git 원격과 읽기 전용 PR 조회에 사용할 수 있습니다. `ONEDEV_SERVER_URL`, `ONEDEV_ACCESS_TOKEN`을 설정하면 PR 목록·상세·변경·리뷰·댓글·업데이트를 서버에서 읽습니다. 토큰은 브라우저와 DB에 전달하지 않습니다. 테스트 소스는 코드로 분석할 수 있지만 통과 여부는 판단하지 않습니다.

현재 구성은 로컬 Next.js 웹·API, 정적 분석 파이프라인, 내장 PostgreSQL(PGlite)입니다. 외부 DB 설치 없이 `.data/postgres`에 저장합니다.

## v0.3 분석 신뢰성 강화

[리서치 근거](docs/research-evidence.md)를 바탕으로 상세 설계 19~25장에 분석 범위 장부, 전후 관계 비교, Next.js 규칙, 변경 의도 구분, 문장별 근거 검사, 품질 평가 기준을 추가했습니다. 누락이 없다는 보장 대신 미해석·미설명 범위를 명시합니다.

## 구현 문서

- [상세 구현 설계서](docs/implementation-design.md): 모듈·타입·DB·큐·API·LLM·화면·인수 조건
- [첫 실행 계획: Git 변경 장부](docs/superpowers/plans/2026-09-13-git-ledger.md): 파일별 구현·검증 순서

현재 MVP는 Git 변경 장부, 모든 ref의 커밋 이력, 작업 트리·커밋·PR 범위 스냅샷, 정적 관계 분석, 근거 저장, LLM 어댑터, OneDev PR API 어댑터, 웹 대시보드를 한 흐름으로 제공합니다. 커밋이나 PR을 선택하면 기록된 메시지·설명·댓글·리뷰와 코드 관계를 한 스냅샷에 고정해 질문할 수 있습니다.

## Git 변경 장부 CLI

첫 수직 기능은 로컬 저장소의 특정 커밋과 첫 부모 간 변경을 JSON으로 출력합니다.

```powershell
node src/cli/scan.mjs C:\path\to\repository HEAD
```

출력 계약은 `schemaVersion: "1.0"`입니다. 이 명령은 대상 저장소의 checkout과 index를 변경하지 않습니다.

## 웹 대시보드 실행

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다. 저장소 경로를 등록하면 현재 로컬 소스 또는 HEAD 커밋을 분석해 변경 장부, 분석 범위, 변경 파일별 영향 확인 목록을 표시합니다.

저장소를 선택한 뒤 `커밋` 탭에서 모든 ref에 도달 가능한 커밋을 검색할 수 있습니다. OneDev 환경 변수가 있으면 `PR` 탭에서 PR 작업 목록과 상세 근거를 확인합니다. OneDev 설정이 없을 때는 화면에 설정 방법을 안내하고 로컬 Git 기능은 계속 사용할 수 있습니다.

PR 분석 시 OneDev의 `base/head` ref가 로컬에 없으면 `AI_HANDOFF_GIT_CACHE_DIR`의 bare 저장소에 필요한 ref만 가져옵니다. 원본 checkout·index·작업 트리는 수정하지 않습니다.

LLM은 선택 설정입니다. OpenAI 호환 서버를 사용하려면 `.env.local`에 `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`을 설정합니다. 이 값은 `/chat/completions`로 호출됩니다. 같은 설정은 `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`로도 지정할 수 있습니다. `OPENAI_BASE_URL`을 비워두고 기존 OpenAI 키·모델만 설정하면 공식 Responses API를 사용합니다. 아무 키도 없으면 외부 호출 없이 Git·코드 근거에 기반한 정형 요약을 사용합니다. 키는 브라우저나 DB에 저장하지 않습니다.

현재 정적 분석은 직접 import, Next.js App/Pages Router 규약, 파일 수준 `use server`, 문자열 리터럴 `fetch()` 관계를 지원합니다. 동적 호출과 실행 결과는 확정하지 않고 분석 범위에 표시합니다.
