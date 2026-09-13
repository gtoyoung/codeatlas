# AI 개발 인계실

2~4명 개발팀의 **Git 커밋과 로컬 소스**를 분석해 변경 내용·코드 구조·영향 후보를 설명하는 도구입니다.

현재는 상세 설계 초안 단계이며 애플리케이션은 구현하지 않았습니다.

- [상세 설계서](docs/design.md): 로컬 실행 구조, Git·소스 수집, 데이터 모델, LLM, 화면, 구현 단계
- [설계 결정 기록](docs/decisions.md): 확정 범위와 기술 제안

## 분석 흐름

OneDev Git 원격 → 일반 Git fetch → 로컬 Git·소스 스냅샷 → 정적 분석·LLM → 변경 피드·관계 지도·맥락 문서.

OneDev는 Git 원격으로만 사용합니다. OneDev API·PR 연동, AI 인계 파일, 테스트 실행·배포 기록 수집은 제외합니다. 테스트 소스는 코드로 분석할 수 있지만 통과 여부는 판단하지 않습니다.

초기 구성 제안은 로컬 Next.js 웹·API, 별도 분석 워커, PostgreSQL입니다. 공유 서버 모드는 서버의 별도 Git clone을 분석하며 개인 PC의 미커밋 변경은 수집하지 않습니다.

## v0.3 분석 신뢰성 강화

[리서치 근거](docs/research-evidence.md)를 바탕으로 상세 설계 19~25장에 분석 범위 장부, 전후 관계 비교, Next.js 규칙, 변경 의도 구분, 문장별 근거 검사, 품질 평가 기준을 추가했습니다. 누락이 없다는 보장 대신 미해석·미설명 범위를 명시합니다.

## 구현 문서

- [상세 구현 설계서](docs/implementation-design.md): 모듈·타입·DB·큐·API·LLM·화면·인수 조건
- [첫 실행 계획: Git 변경 장부](docs/superpowers/plans/2026-09-13-git-ledger.md): 파일별 구현·검증 순서

전체 구현은 A~F로 분리합니다. 첫 계획은 외부 패키지 없이 Git 커밋 장부를 확인하는 기능이며 제품 전체 구현 완료를 의미하지 않습니다.

## Git 변경 장부 CLI

첫 수직 기능은 로컬 저장소의 특정 커밋과 첫 부모 간 변경을 JSON으로 출력합니다.

```powershell
npm run scan -- C:\path\to\repository HEAD
```

출력 계약은 `schemaVersion: "1.0"`입니다. 현재는 커밋의 파일 단위 변경만 수집하며 모든 변경을 `explicitly_unexplained`로 표시합니다. 작업 트리 분석, 코드 관계 분석, LLM 설명, DB와 웹 화면은 아직 구현 범위에 포함되지 않았습니다. 이 명령은 대상 저장소의 checkout과 index를 변경하지 않습니다.
