'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

import { buildConversationTimeline, buildEvidenceGroups } from '@/modules/workspace/model.mjs';
import CommitTimeline from './CommitTimeline';
import PullRequestInbox from './PullRequestInbox';
import AnalysisThread from './AnalysisThread';
import EvidenceInspector from './EvidenceInspector';
import RepositorySidebar from './RepositorySidebar';
import type { Answer, QuestionRecord, Repository, Scan, TimelineEvent } from './workspace-types';

type Workspace = 'overview' | 'commits' | 'pulls';

async function readJson(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? '요청을 처리하지 못했습니다.');
  return body;
}

function shortOid(value: string | null) {
  return value ? value.slice(0, 9) : 'WORKTREE';
}

function scanKindLabel(scan: Scan) {
  if (scan.kind === 'pull_request') return 'PULL REQUEST';
  if (scan.kind === 'commit') return 'COMMIT';
  return 'WORKING TREE';
}

type CommitSelection = { oid: string };
type PullRequestSelection = { id: number | string | null; number: number | null };

export default function AtlasWorkspace({ suggestedPath }: { suggestedPath: string }) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [questions, setQuestions] = useState<QuestionRecord[]>([]);
  const [liveQuestions, setLiveQuestions] = useState<QuestionRecord[]>([]);
  const [path, setPath] = useState(suggestedPath);
  const [mode, setMode] = useState<'working_tree' | 'commit'>('working_tree');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [workspace, setWorkspace] = useState<Workspace>('overview');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);

  const selected = useMemo(
    () => repositories.find((repository) => repository.id === selectedId) ?? null,
    [repositories, selectedId],
  );
  const timeline = useMemo(
    () => scan ? buildConversationTimeline(scan, [...questions, ...liveQuestions]) as TimelineEvent[] : [],
    [liveQuestions, questions, scan],
  );
  const evidenceGroups = useMemo(() => scan ? buildEvidenceGroups(scan) : [], [scan]);

  async function refresh(preferredId?: string) {
    const body = await readJson(await fetch('/api/repositories', { cache: 'no-store' }));
    setRepositories(body.repositories);
    const nextId = preferredId ?? selectedId ?? body.repositories[0]?.id ?? null;
    const nextScan = body.repositories.find((repository: Repository) => repository.id === nextId)?.latestScan ?? null;
    setSelectedId(nextId);
    setScan(nextScan);
    setQuestions([]);
    setLiveQuestions([]);
    if (nextScan && nextScan.kind !== 'pull_request') setMode(nextScan.kind);
  }

  useEffect(() => {
    refresh().catch((cause) => setError(cause.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!scan) {
      setQuestions([]);
      return () => { cancelled = true; };
    }
    fetch(`/api/scans/${scan.id}`, { cache: 'no-store' })
      .then(readJson)
      .then((body) => {
        if (!cancelled) setQuestions(Array.isArray(body.scan.questions) ? body.scan.questions : []);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '질문 이력을 읽지 못했습니다.');
      });
    return () => { cancelled = true; };
  }, [scan?.id]);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = await readJson(await fetch('/api/repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, kind: mode, defaultRef: 'HEAD' }),
      }));
      await refresh(body.repository.id);
      setScan(body.scan);
      setWorkspace('overview');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '분석하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function rescan() {
    if (!selected) return;
    setBusy(true);
    setError('');
    setLiveQuestions([]);
    try {
      const isPullRequest = scan?.kind === 'pull_request';
      const pullKey = isPullRequest ? (scan?.report.metadata?.id ?? scan?.report.metadata?.number) : null;
      const endpoint = isPullRequest && pullKey ? `/api/repositories/${selected.id}/pull-requests/${pullKey}/scan` : `/api/repositories/${selected.id}/scan`;
      const ref = scan?.kind === 'commit' && scan.targetOid ? scan.targetOid : selected.defaultRef;
      const body = await readJson(await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isPullRequest ? {} : { kind: mode, ref }),
      }));
      setScan(body.scan);
      await refresh(selected.id);
      setScan(body.scan);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '분석하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function analyzeCommit(commit: CommitSelection) {
    if (!selected) return;
    setBusy(true); setError(''); setLiveQuestions([]);
    try {
      const body = await readJson(await fetch(`/api/repositories/${selected.id}/scan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'commit', ref: commit.oid }),
      }));
      setScan(body.scan); setWorkspace('overview');
      await refresh(selected.id);
      setScan(body.scan);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '커밋을 분석하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function analyzePullRequest(pullRequest: PullRequestSelection) {
    if (!selected || (pullRequest.id == null && pullRequest.number == null)) return;
    setBusy(true); setError(''); setLiveQuestions([]);
    try {
      const key = pullRequest.id ?? pullRequest.number;
      const body = await readJson(await fetch(`/api/repositories/${selected.id}/pull-requests/${key}/scan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      }));
      setScan(body.scan); setWorkspace('overview');
      await refresh(selected.id);
      setScan(body.scan);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'PR을 분석하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  async function ask(questionText: string) {
    if (!scan || questionText.trim().length < 2) return;
    setBusy(true);
    setError('');
    try {
      const body = await readJson(await fetch(`/api/scans/${scan.id}/question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: questionText.trim() }),
      }));
      setLiveQuestions((current) => [...current, {
        id: `live-${Date.now()}`,
        scanId: scan.id,
        question: questionText.trim(),
        answer: body.answer as Answer,
        createdAt: new Date().toISOString(),
      }]);
      setQuestion('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '답변을 생성하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function chooseRepository(repository: Repository) {
    setSelectedId(repository.id);
    setScan(repository.latestScan);
    setQuestions([]);
    setLiveQuestions([]);
    setSelectedEvidenceId(null);
    setWorkspace('overview');
    if (repository.latestScan && repository.latestScan.kind !== 'pull_request') setMode(repository.latestScan.kind);
  }

  const scanTitle = scan?.summary.title ?? selected?.name ?? '분석 작업';
  const scopeLabel = scan ? `${scanKindLabel(scan)} · ${shortOid(scan.targetOid)}` : '분석 범위를 선택하세요';

  return (
    <main className="atlas-shell">
      <RepositorySidebar
        repositories={repositories}
        selectedId={selectedId}
        selectedScan={scan}
        workspace={workspace}
        path={path}
        mode={mode}
        busy={busy}
        onPathChange={setPath}
        onModeChange={setMode}
        onRegister={register}
        onRepositorySelect={chooseRepository}
        onWorkspaceChange={setWorkspace}
      />

      <section className="atlas-main">
        <header className="atlas-topbar">
          <div className="atlas-topbar-title">
            <span className="atlas-breadcrumb">{selected?.name ?? 'Code Atlas'}{selected ? ` / ${scan?.kind === 'pull_request' ? 'PR' : scan?.kind === 'commit' ? '커밋' : '현재 분석'}` : ''}</span>
            <h1>{scanTitle}</h1>
            <span className="atlas-ref-line">{scopeLabel}{selected?.path ? ` · ${selected.path}` : ''}</span>
          </div>
          <div className="atlas-topbar-actions">
            {scan && workspace === 'overview' && <button type="button" className="atlas-secondary-button" onClick={() => setInspectorOpen((value) => !value)}>{inspectorOpen ? '검사기 닫기' : '근거 검사기'}</button>}
            {scan && workspace === 'overview' && <button type="button" className="atlas-primary-button" onClick={rescan} disabled={busy}>{busy ? '분석 중…' : '다시 분석'}</button>}
          </div>
        </header>

        {error && <div className="atlas-error" role="alert">{error}</div>}

        <div className="atlas-content">
          {workspace === 'commits' && selected ? <CommitTimeline repositoryId={selected.id} onAnalyze={analyzeCommit} /> : workspace === 'pulls' && selected ? <PullRequestInbox repositoryId={selected.id} onAnalyze={analyzePullRequest} /> : !scan ? (
            <div className="atlas-empty-state">
              <span className="atlas-empty-mark">A—Z</span>
              <h2>분석할 작업을 선택하세요.</h2>
              <p>왼쪽에서 저장소를 고르거나 새 분석을 시작하면 Git 변경과 근거가 대화 흐름으로 정리됩니다.</p>
            </div>
          ) : (
            <div className={inspectorOpen ? 'atlas-analysis-layout inspector-visible' : 'atlas-analysis-layout'}>
              <AnalysisThread
                events={timeline}
                subject={scanTitle}
                scopeLabel={scopeLabel}
                question={question}
                busy={busy}
                onQuestionChange={setQuestion}
                onAsk={ask}
                onEvidenceSelect={(id) => { setSelectedEvidenceId(id); setInspectorOpen(true); }}
              />
              <EvidenceInspector
                groups={evidenceGroups}
                selectedId={selectedEvidenceId}
                open={inspectorOpen}
                onSelect={setSelectedEvidenceId}
                onClose={() => setInspectorOpen(false)}
              />
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
