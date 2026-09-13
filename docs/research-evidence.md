# 관계·의도·근거 강화 리서치

- 조사일: 2026-09-13
- 대상: Git·로컬 소스만 사용하는 v0.3 설계.
- 방법: 공식 문서·프로토콜·원 논문 확인. 실제 제품·대상 저장소 성능 실험은 수행하지 않았다.
- 본문의 '설계 적용'은 출처를 참고한 우리 제품의 제안이며 출처가 보장한 결과가 아니다.

## 1. 구문 검색과 의미 분석을 구분해야 한다

TypeScript Compiler API는 Program·CompilerHost·SourceFile과 타입 검사기를 통해 심벌·타입 정보를 제공한다. 문서는 API 버전 차이도 경고한다. [공식 Compiler API 문서](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)

설계 적용: 단순 문자열 검색을 기본 근거로 삼지 않고 스냅샷에 고정한 타입 분석을 우선한다. 해석 실패 시 구문 분석으로 낮춰 제공하고 그 상태를 표시한다. 저장소의 TypeScript 코드를 로딩하지 않으며 제품이 고정한 분석기 버전과 대상 버전 호환성을 기록한다.

## 2. 심벌과 소스 위치를 함께 저장한다

SCIP은 심벌과 소스 위치의 occurrence를 표현하며 선언·참조를 구분하는 정보를 담는다. 위치 인코딩과 0 기반 범위가 명시돼 있다. [SCIP 스키마](https://github.com/scip-code/scip/blob/main/scip.proto)

설계 적용: 파일·라인만 저장하지 않고 심벌·원문 해시·위치 인코딩·스냅샷을 묶는다. SCIP은 참고 데이터 모델이며 초기 필수 서비스나 추가 수집 채널로 도입하지 않는다.

Sourcegraph도 검색 기반과 컴파일 정보 기반 코드 탐색을 구분한다. [공식 코드 탐색 설명](https://sourcegraph.com/docs/code-navigation)

설계 적용: '정확한 정적 참조'와 '검색으로 찾은 후보'를 UI와 데이터에서 구분한다. 정적 참조 정확성과 런타임 호출 완전성은 다르다.

## 3. Next.js 관계에는 프레임워크 규칙이 필요하다

Next.js는 파일 규약에 라우트·레이아웃·그룹·병렬 경로 등을 정의한다. Server Function은 파일 또는 함수의 use server 선언으로 표시될 수 있다. rewrites에는 조건과 적용 순서가 있다. [파일 규약](https://nextjs.org/docs/app/api-reference/file-conventions), [use server](https://nextjs.org/docs/app/api-reference/directives/use-server), [rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites)

설계 적용: import 그래프 외에 버전별 규약 분석기를 둔다. 동적 설정을 실행해 완성하려 하지 않고 해석하지 못한 라우팅 관계를 기록한다. 호출 그래프와 파일 규약 그래프를 같은 종류의 확정 실행 경로로 합치지 않는다.

## 4. Git 변경은 전후 양쪽과 탐지 설정을 보존한다

Git의 rename 판별은 유사도 임계값에 영향을 받는다. git log의 -S는 문자열 출현 횟수가 달라진 변경을 찾는 데 사용할 수 있다. [git diff](https://git-scm.com/docs/git-diff), [git log](https://git-scm.com/docs/git-log)

설계 적용: 이름 변경을 사실상 동일 기능이라고 단정하지 않는다. 삭제된 코드와 이전 참조도 분석한다. 관련 이력 조회는 의도 후보의 맥락 보완으로 쓰며 작성자의 실제 동기를 증명하는 도구로 취급하지 않는다.

## 5. 인용 존재와 인용 품질은 다르다

ALCE는 생성된 답변의 인용이 주장을 지지하는지와 불필요한 인용이 있는지를 별도로 평가한다. 자동 평가와 사람 평가를 비교한다. [논문과 평가 방법](https://aclanthology.org/2023.emnlp-main.398/), [본문 §3.3](https://aclanthology.org/2023.emnlp-main.398.pdf)

설계 적용: 근거 ID 유효성 외에 주장 전체의 지지 여부를 검사한다. 코드 분석 분야에 논문 수치가 그대로 적용된다고 가정하지 않는다. 독립 검사 호출은 판정 보조이며 고정 코드 표본에 대한 사람 검토로 오판을 측정한다.

## 6. 선택한 방향과 보류한 대안

| 방향 | 판단 |
|---|---|
| 전체 소스를 LLM에 넣고 설명 생성 | 변경·근거 누락을 계수하기 어려워 기본 방식에서 제외 |
| import 그래프만 활용 | 파일 규약과 심벌 연결을 놓쳐 단독 사용 제외 |
| GraphDB부터 도입 | 저장 기술은 추출 누락을 해결하지 않으므로 보류 |
| 타입·규약 분석 + 변경 장부 + 주장 검사 | v0.3의 기본 구조로 채택 |
| 정적 분석만으로 실행·의도 완전 복원 | 입력의 한계 때문에 목표로 삼지 않음 |

## 7. 확인하지 못한 사항

대상 저장소를 아직 분석하지 않았으므로 Next.js·TypeScript 버전, 의존성 확보 상태, ORM·AI 호출 패턴, 실제 정확도·비용은 미측정이다. 공식 문서가 바뀔 수 있으므로 구현 시 분석기 호환 버전과 문서 기준을 고정한다. 외부 API·인계·테스트·배포 기록을 다시 도입하지 않는다.
