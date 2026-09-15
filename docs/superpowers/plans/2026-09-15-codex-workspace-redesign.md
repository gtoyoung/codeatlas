# Codex형 Code Atlas 작업 공간 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Code Atlas를 저장소 탐색·분석 대화·근거 검사기가 함께 있는 Codex형 작업 공간으로 전환하고 질문 이력을 복원한다.

**Architecture:** 기존 Git/소스/LLM 분석 API는 유지하고, `Scan` 응답을 중앙 이벤트 흐름과 오른쪽 근거 그룹으로 변환하는 순수 화면 모델을 추가한다. 화면은 `AtlasWorkspace` 셸 아래 `RepositorySidebar`, `AnalysisThread`, `EvidenceInspector`, `QuestionComposer`로 나누며 질문 이력은 기존 `questions` 테이블을 조회한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, ESM JavaScript, PGlite/PostgreSQL-compatible SQL, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-15-codex-workspace-redesign-design.md`

## Global Constraints

- Git·소스·OneDev·LLM 분석 의미와 API 계약은 유지한다.
- 기록, 코드 사실, 정적 관계, 확인 필요 내용을 섞어 표시하지 않는다.
- 내부 UUID와 분석기 노드 ID는 UI에 표시하지 않고 경로와 줄 번호를 사용한다.
- LLM 없이도 전체 흐름이 동작해야 한다.
- 320px 폭에서 내용이 겹치거나 잘리지 않아야 한다.
- 분석 대상 소스를 실행하지 않으며 LLM 키를 브라우저·DB·로그에 저장하지 않는다.

---

### Task 1: 질문 이력 조회 계약

**Files:**
- Modify: `src/modules/store/database.mjs`
- Modify: `src/app/api/scans/[id]/route.ts`
- Test: `tests/store.test.mjs`
- Test: `tests/http-api.test.mjs` (create if missing)

**Interfaces:**
- Produces `store.listQuestions(scanId)` returning `{ id, scanId, question, answer, createdAt }[]` in ascending creation order.
- `GET /api/scans/[id]` returns `{ scan: { ...scan, questions } }`.

- [ ] **Step 1: Write the failing store test**

```js
const saved = await store.saveQuestion({ scanId: scan.id, question: '왜 바뀌었나?', answer: { answer: '기록을 확인했습니다.' } });
const questions = await store.listQuestions(scan.id);
assert.deepEqual(questions[0], { id: saved.id, scanId: scan.id, question: '왜 바뀌었나?', answer: { answer: '기록을 확인했습니다.' }, createdAt: questions[0].createdAt });
```

- [ ] **Step 2: Run `node --test tests/store.test.mjs` and confirm it fails with `store.listQuestions is not a function`.**
- [ ] **Step 3: Add `listQuestions` with `SELECT id, scan_id, question, answer, created_at FROM questions WHERE scan_id = $1 ORDER BY created_at ASC`.**
- [ ] **Step 4: Update the scan route to read the list and attach it without changing existing scan fields.**
- [ ] **Step 5: Run `node --test tests/store.test.mjs` and the API test; confirm both pass.**
- [ ] **Step 6: Commit with `feat: expose persisted scan questions`.**

### Task 2: Workspace 화면 모델

**Files:**
- Create: `src/modules/workspace/model.mjs`
- Test: `tests/workspace-model.test.mjs`

**Interfaces:**
- `buildWorkspaceTimeline(scan, questions)` returns `TimelineEvent[]` ordered as snapshot, narrative, impact, then persisted question/answer pairs.
- `buildEvidenceGroups(scan)` returns `{ recorded, changes, relations, uncertainty }` with user-facing `label`, `text`, `path`, and `line` fields.

- [ ] **Step 1: Write failing tests for event order, recorded-vs-code grouping, and internal ID removal.**
- [ ] **Step 2: Run `node --test tests/workspace-model.test.mjs`; confirm missing module/function failure.**
- [ ] **Step 3: Implement pure normalization helpers using `scan.summary.narrative`, `report.evidence`, `report.changes`, `graph.nodes`, `graph.edges`, and question history.**
- [ ] **Step 4: Resolve graph node IDs through `graph.nodes`; fallback to a readable path suffix and never emit snapshot UUIDs.**
- [ ] **Step 5: Run the focused test and confirm it passes.**
- [ ] **Step 6: Commit with `feat: build analysis workspace timeline`.**

### Task 3: Codex형 셸과 탐색 영역

**Files:**
- Create: `src/components/AtlasWorkspace.tsx`
- Create: `src/components/RepositorySidebar.tsx`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/workspace-model.test.mjs` (state/selection cases)

**Interfaces:**
- `AtlasWorkspace` owns selected repository, scan, workspace tab, inspector open/closed state, selected evidence, and question state.
- `RepositorySidebar` receives repository list, selected ID, current workspace, and callbacks; it renders repository search, `새 분석`, `현재 변경`, `커밋`, `PR`, and recent scan entries.

- [ ] **Step 1: Add failing model assertions for repository navigation labels and selected scan metadata.**
- [ ] **Step 2: Run focused tests and confirm failure.**
- [ ] **Step 3: Move repository list and existing commit/PR navigation into `RepositorySidebar`; keep current fetch and analyze callbacks behaviorally identical.**
- [ ] **Step 4: Replace the old two-column dashboard shell with `AtlasWorkspace` while preserving empty, error, loading, and rescan states.**
- [ ] **Step 5: Add Codex-like light sidebar, 56px workspace header, central reading column, and responsive drawer controls.**
- [ ] **Step 6: Run `npm run typecheck` and `npm run build`; fix all type/layout compilation errors.**
- [ ] **Step 7: Commit with `feat: add codex workspace shell`.**

### Task 4: 분석 이벤트와 질문 입력

**Files:**
- Create: `src/components/AnalysisThread.tsx`
- Create: `src/components/QuestionComposer.tsx`
- Modify: `src/components/AtlasWorkspace.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- `AnalysisThread` receives `TimelineEvent[]`, `onEvidenceSelect`, and `onQuestion`; renders snapshot, narrative, impact, question, answer, and error events.
- `QuestionComposer` receives `question`, `busy`, `scopeLabel`, `onChange`, and `onSubmit`.

- [ ] **Step 1: Add a failing component-level model test that an answer follows its question and displays section labels.**
- [ ] **Step 2: Run the focused test and confirm failure.**
- [ ] **Step 3: Implement event rendering with important narrative text open and raw diff/body in native `<details>`.**
- [ ] **Step 4: Move existing `/api/scans/[id]/question` call into `QuestionComposer` flow and append the returned answer event immediately.**
- [ ] **Step 5: Fetch `GET /api/scans/[id]` when a scan is selected and seed persisted questions into the timeline.**
- [ ] **Step 6: Add accessible form labels, `aria-live="polite"` for new answers, and disabled submission while busy.**
- [ ] **Step 7: Run `npm test` and `npm run typecheck`; confirm all pass.**
- [ ] **Step 8: Commit with `feat: show analysis as conversation thread`.**

### Task 5: 근거 검사기

**Files:**
- Create: `src/components/EvidenceInspector.tsx`
- Modify: `src/components/AnalysisThread.tsx`
- Modify: `src/components/AtlasWorkspace.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/workspace-model.test.mjs`

**Interfaces:**
- `EvidenceInspector` receives grouped evidence, selected evidence ID, `open`, `onSelect`, and `onClose`.
- Selected evidence exposes category, user-facing text, path, line, and diff preview; internal graph IDs remain hidden.

- [ ] **Step 1: Add failing tests for four group labels and path/line normalization.**
- [ ] **Step 2: Run focused tests and confirm failure.**
- [ ] **Step 3: Implement the right inspector with recorded reason, code change, impact relation, and uncertainty groups.**
- [ ] **Step 4: Wire evidence IDs and file references from thread events to inspector selection.**
- [ ] **Step 5: Add desktop collapse, tablet toggle, mobile drawer, focus-visible states, and reduced-motion styles.**
- [ ] **Step 6: Run `npm test`, `npm run typecheck`, and `npm run build`; confirm all pass.**
- [ ] **Step 7: Commit with `feat: add evidence inspector`.**

### Task 6: 최종 검증과 전달

**Files:**
- Modify: `README.md` if the run instructions or screenshots need updated wording.
- Modify: `docs/implementation-design.md` if the final component names or API contract changed.

- [ ] **Step 1: Run `npm test`.**
- [ ] **Step 2: Run `npm run typecheck`.**
- [ ] **Step 3: Run `npm run build`.**
- [ ] **Step 4: Start `npm start -- -p 3117` and inspect desktop and 320px behavior in the browser.**
- [ ] **Step 5: Check `git diff --check` and `git status --short`.**
- [ ] **Step 6: Commit documentation or copy corrections with a focused message.**
- [ ] **Step 7: Push the verified commits to `origin master`.**
