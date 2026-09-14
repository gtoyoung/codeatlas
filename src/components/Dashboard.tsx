'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { buildImpactList } from '@/modules/analysis/impact-list.mjs';
import CommitTimeline from './CommitTimeline';
import PullRequestInbox from './PullRequestInbox';

type ImpactRelation = {
  id: string;
  label: string;
  path: string | null;
  reason: string;
  evidencePath: string | null;
  evidenceLine: number | null;
};

type ImpactGroup = {
  status: string;
  changedPath: string | null;
  relations: ImpactRelation[];
};

type ChangeDiff = {
  status: 'available' | 'binary' | 'unavailable';
  patch: string | null;
  additions: number;
  deletions: number;
  truncated?: boolean;
};

type Scan = {
  id: string;
  kind: 'commit' | 'working_tree' | 'pull_request';
  targetOid: string | null;
  baseOid: string | null;
  createdAt: string;
  summary: { title: string; overview: string; mode: string; cautions?: string[]; relationCount?: number };
  report: {
    changes: Array<{ status: string; oldPath: string | null; newPath: string | null; diff?: ChangeDiff | null }>;
    files: Array<{ path: string; state?: string; reason?: string | null }>;
    metadata?: {
      type?: 'commit' | 'pull_request';
      id?: number | string | null;
      number?: number | null;
      title?: string;
      description?: string;
      subject?: string;
      body?: string;
      author?: { name?: string; email?: string };
      source?: string | null;
      target?: string | null;
      comments?: Array<unknown>;
      reviews?: Array<unknown>;
      updates?: Array<unknown>;
    } | null;
    coverage?: { totalFiles: number; indexedFiles: number; excludedFiles: number };
    evidence?: Array<{ id: string; text: string; path?: string }>;
  };
  graph: {
    nodes: Array<{ id: string; kind: string; label: string; path?: string }>;
    edges: Array<{ id: string; source: string; target: string; kind: string; evidence?: { path: string; startLine: number } }>;
    coverage: { totalFiles: number; indexedFiles: number; partialFiles: number; excludedFiles: number; failedFiles: number; issues: Array<{ path: string; reason: string }> };
  };
};

type Repository = {
  id: string;
  name: string;
  path: string;
  defaultRef: string;
  latestScan: Scan | null;
};

async function readJson(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? '요청을 처리하지 못했습니다.');
  return body;
}

function shortOid(value: string | null) {
  return value ? value.slice(0, 9) : 'WORKTREE';
}

type CommitSelection = { oid: string };
type PullRequestSelection = { id: number | string | null; number: number | null };

type AnswerSection = {
  key: string;
  label: string;
  text: string;
  citations: string[];
  items?: string[];
};

type Answer = {
  answer: string;
  citations: string[];
  support: string;
  mode: string;
  sections?: AnswerSection[];
};

function supportLabel(value: string) {
  if (value === 'supported') return '근거 확인됨';
  if (value === 'partial') return '일부 근거 확인';
  return '검증 필요';
}

function modeLabel(value: string) {
  if (value === 'openai-compatible') return 'OpenAI 호환 모델';
  if (value === 'openai') return 'OpenAI';
  if (value === 'anthropic') return 'Anthropic';
  return '로컬 정형 답변';
}

export default function Dashboard({ suggestedPath }: { suggestedPath: string }) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [path, setPath] = useState(suggestedPath);
  const [mode, setMode] = useState<'working_tree' | 'commit'>('working_tree');
  const [question, setQuestion] = useState('작성자는 왜 이 커밋이나 PR을 만들었나? 기록과 코드 근거를 나눠 설명해줘.');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [workspace, setWorkspace] = useState<'overview' | 'commits' | 'pulls'>('overview');

  const selected = useMemo(
    () => repositories.find((repository) => repository.id === selectedId) ?? null,
    [repositories, selectedId],
  );
  const impacts = useMemo(() => (
    scan ? buildImpactList({ changes: scan.report.changes, graph: scan.graph }) as ImpactGroup[] : []
  ), [scan]);
  const impactConnections = impacts.reduce((sum, impact) => sum + impact.relations.length, 0);
  const hasDiff = Boolean(scan?.report.changes.some((change) => change.diff?.status === 'available' || change.diff?.status === 'binary'));

  async function refresh(preferredId?: string) {
    const body = await readJson(await fetch('/api/repositories', { cache: 'no-store' }));
    setRepositories(body.repositories);
    const nextId = preferredId ?? selectedId ?? body.repositories[0]?.id ?? null;
    const nextScan = body.repositories.find((repository: Repository) => repository.id === nextId)?.latestScan ?? null;
    setSelectedId(nextId);
    setScan(nextScan);
    if (nextScan && nextScan.kind !== 'pull_request') setMode(nextScan.kind);
  }

  useEffect(() => {
    refresh().catch((cause) => setError(cause.message));
  }, []);

  async function register(event: FormEvent) {
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
    setAnswer(null);
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '분석하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function analyzeCommit(commit: CommitSelection) {
    if (!selected) return;
    setBusy(true); setError(''); setAnswer(null);
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
    setBusy(true); setError(''); setAnswer(null);
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

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!scan) return;
    setBusy(true);
    setError('');
    try {
      const body = await readJson(await fetch(`/api/scans/${scan.id}/question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      }));
      setAnswer(body.answer);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '답변을 생성하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function chooseRepository(repository: Repository) {
    setSelectedId(repository.id);
    setScan(repository.latestScan);
    if (repository.latestScan && repository.latestScan.kind !== 'pull_request') setMode(repository.latestScan.kind);
    setAnswer(null);
  }

  const coverage = scan?.graph.coverage;

  return (
    <main className="workbench">
      <header className="masthead">
        <div>
          <span className="eyebrow">LOCAL CODE INTELLIGENCE</span>
          <h1>Code <i>Atlas</i></h1>
          <p>Git과 지금의 소스를 근거 중심으로 읽습니다.</p>
        </div>
        <div className="status-stamp">
          <span className={busy ? 'pulse' : ''} />
          {busy ? '분석 중' : '로컬 연결'}
        </div>
      </header>

      <section className="control-rail" aria-label="저장소 등록">
        <form onSubmit={register} className="repo-form">
          <label>
            <span>저장소 경로</span>
            <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="C:\\projects\\my-app" />
          </label>
          <label>
            <span>분석 기준</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
              <option value="working_tree">현재 로컬 소스</option>
              <option value="commit">HEAD 커밋</option>
            </select>
          </label>
          <button disabled={busy}>{busy ? '읽는 중…' : '등록하고 분석'}</button>
        </form>
        {error && <div className="error-strip" role="alert">{error}</div>}
      </section>

      <div className="workspace-grid">
        <aside className="repo-list">
          <div className="section-label">저장소</div>
          {repositories.length === 0 && <p className="empty-copy">분석할 Git 저장소를 등록하세요.</p>}
          {repositories.map((repository) => (
            <button
              key={repository.id}
              className={repository.id === selectedId ? 'repo-card active' : 'repo-card'}
              onClick={() => chooseRepository(repository)}
            >
              <strong>{repository.name}</strong>
              <span>{repository.latestScan ? shortOid(repository.latestScan.targetOid) : '분석 없음'}</span>
              <small>{repository.path}</small>
            </button>
          ))}
        </aside>

        <section className="analysis-stage">
          <nav className="workspace-tabs" aria-label="작업 공간">
            <button className={workspace === 'overview' ? 'active' : ''} onClick={() => setWorkspace('overview')}>현재 변경</button>
            <button className={workspace === 'commits' ? 'active' : ''} onClick={() => setWorkspace('commits')} disabled={!selected}>커밋 <span>Git</span></button>
            <button className={workspace === 'pulls' ? 'active' : ''} onClick={() => setWorkspace('pulls')} disabled={!selected}>PR <span>OneDev</span></button>
          </nav>
          {workspace === 'commits' && selected ? <CommitTimeline repositoryId={selected.id} onAnalyze={analyzeCommit} /> : workspace === 'pulls' && selected ? <PullRequestInbox repositoryId={selected.id} onAnalyze={analyzePullRequest} /> : workspace === 'overview' && !scan ? (
            <div className="welcome-panel">
              <span className="index-mark">A—Z</span>
              <h2>코드의 현재 상태부터<br />정확히 고정합니다.</h2>
              <p>저장소를 등록하면 변경 파일, 영향 연결, 해석하지 못한 영역을 함께 보여줍니다.</p>
            </div>
          ) : workspace === 'overview' && scan ? (
            <>
              <div className="snapshot-banner">
                <div>
                  <span>{scan.kind === 'working_tree' ? 'WORKING TREE' : scan.kind === 'pull_request' ? 'PULL REQUEST' : 'COMMIT'}</span>
                  <strong>{shortOid(scan.targetOid)}</strong>
                </div>
                <button onClick={rescan} disabled={busy}>다시 분석</button>
              </div>
              {scan.report.changes.length > 0 && !hasDiff && (
                <div className="notice-strip diff-notice" role="status">
                  이 분석 결과는 실제 코드 diff 저장 전의 기록입니다. <button onClick={rescan} disabled={busy}>다시 분석</button>하면 추가·삭제 라인과 파일별 diff를 확인할 수 있습니다.
                </div>
              )}

              {scan.report.metadata && <article className="intent-card">
                <div><span className="section-label">RECORDED CONTEXT</span><h3>{scan.report.metadata.type === 'pull_request' ? `PR #${scan.report.metadata.number ?? '?'} · ${scan.report.metadata.title ?? '제목 없음'}` : `커밋 · ${scan.report.metadata.subject ?? '메시지 없음'}`}</h3></div>
                <p>{scan.report.metadata.type === 'pull_request' ? (scan.report.metadata.description || 'PR 설명이 없습니다.') : (scan.report.metadata.body || '본문이 없는 커밋입니다.')}</p>
                <small>기록된 메시지·설명은 작성자의 표현입니다. 실제 의도는 코드 변경과 함께 질문으로 확인하세요.</small>
              </article>}

              <article className="summary-card">
                <div className="summary-copy">
                  <span className="section-label">변경 해설 · {scan.summary.mode}</span>
                  <h2>{scan.summary.title}</h2>
                  <p>{scan.summary.overview}</p>
                </div>
                <div className="metric-row">
                  <div><strong>{scan.report.changes.length}</strong><span>변경 파일</span></div>
                  <div><strong>{coverage?.indexedFiles ?? 0}</strong><span>분석 파일</span></div>
                  <div><strong>{impactConnections}</strong><span>영향 연결</span></div>
                  <div><strong>{coverage?.partialFiles ?? 0}</strong><span>부분 해석</span></div>
                </div>
              </article>

              <div className="split-row">
                <article className="panel changes-panel">
                  <div className="panel-head"><h3>변경 장부</h3><span>{scan.report.changes.length}</span></div>
                  <div className="change-list">
                    {scan.report.changes.length === 0 && <p className="empty-copy">기준 대비 변경이 없습니다.</p>}
                    {scan.report.changes.slice(0, 30).map((change, index) => (
                      <div className="change-row" key={`${change.status}-${change.newPath}-${index}`}>
                        <b data-status={change.status[0]}>{change.status}</b>
                        <span className="change-path">{change.newPath ?? change.oldPath}</span>
                        {change.diff && (
                          <details className="change-diff">
                            <summary>
                              <span>{change.diff.status === 'available' ? '실제 코드 변경 보기' : change.diff.status === 'binary' ? '바이너리 변경' : '라인 diff 없음'}</span>
                              {change.diff.status === 'available' && <small>+{change.diff.additions} · -{change.diff.deletions}</small>}
                            </summary>
                            {change.diff.patch && <pre>{change.diff.patch}</pre>}
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </article>

                <article className="panel coverage-panel">
                  <div className="panel-head"><h3>분석 범위</h3><span>{coverage?.totalFiles ?? 0}</span></div>
                  <div className="coverage-bar">
                    <span style={{ width: `${coverage?.totalFiles ? ((coverage.indexedFiles / coverage.totalFiles) * 100) : 0}%` }} />
                  </div>
                  <p>{coverage?.indexedFiles ?? 0}개 해석 · {coverage?.excludedFiles ?? 0}개 제외 · {coverage?.partialFiles ?? 0}개 확인 필요</p>
                  {(coverage?.issues ?? []).slice(0, 5).map((issue, index) => (
                    <small key={`${issue.path}-${index}`}>{issue.path} · {issue.reason}</small>
                  ))}
                </article>
              </div>

              <article className="panel impact-panel">
                <div className="panel-head">
                  <h3>영향 확인 목록</h3>
                  <span>{impactConnections}개 연결 근거</span>
                </div>
                <p className="impact-guide">변경 파일이 사용하는 코드와 이 파일을 사용하는 코드를 직접 연결해 보여줍니다.</p>
                {impacts.length === 0 ? (
                  <div className="impact-empty">
                    <strong>현재 작업 트리에 변경이 없습니다.</strong>
                    <span>분석 기준을 HEAD 커밋으로 바꾸고 다시 분석하면 마지막 커밋의 영향을 볼 수 있습니다.</span>
                  </div>
                ) : (
                  <div className="impact-list">
                    {impacts.slice(0, 30).map((impact) => (
                      <section className="impact-group" key={`${impact.status}-${impact.changedPath}`}>
                        <header>
                          <b data-status={impact.status[0]}>{impact.status}</b>
                          <strong>{impact.changedPath}</strong>
                          <span>{impact.relations.length}개 연결</span>
                        </header>
                        {impact.relations.length === 0 ? (
                          <p className="impact-unknown">분석 가능한 코드 연결을 찾지 못했습니다. 독립 파일이거나 동적 연결일 수 있어 직접 확인이 필요합니다.</p>
                        ) : (
                          <div className="relation-list">
                            {impact.relations.map((relation) => (
                              <div className="relation-row" key={relation.id}>
                                <span>{relation.reason}</span>
                                <strong>{relation.label}</strong>
                                <small>
                                  근거 {relation.evidencePath ?? impact.changedPath}
                                  {relation.evidenceLine ? `:${relation.evidenceLine}` : ''}
                                </small>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    ))}
                  </div>
                )}
              </article>

              <article className="evidence-desk">
                <div>
                  <span className="section-label">EVIDENCE DESK</span>
                  <h3>이 코드에 질문하기</h3>
                  <p>커밋 메시지·PR 대화는 기록된 맥락으로, 코드 관계는 정적 근거로 분리해 답합니다.</p>
                </div>
                <form onSubmit={ask}>
                  <textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
                  <button disabled={busy || question.trim().length < 2}>근거로 답변</button>
                </form>
                {answer && (
                  <div className={`answer-card answer-${answer.support}`}>
                    <div className="answer-card-head">
                      <div className="answer-state"><span /> <b>{supportLabel(answer.support)}</b></div>
                      <span className="answer-engine">{modeLabel(answer.mode)}</span>
                      <span className="answer-count">{answer.citations.length}개 인용</span>
                    </div>
                    <div className="answer-sections">
                      {(answer.sections?.length ? answer.sections : [{ key: 'answer', label: '답변', text: answer.answer, citations: answer.citations }]).map((section, index) => (
                        <section className="answer-section" data-kind={section.key} key={`${section.key}-${index}`}>
                          <div className="answer-section-head">
                            <h4>{section.label}</h4>
                            {section.citations.length > 0 && <span>{section.citations.length}개 근거</span>}
                          </div>
                          {section.items?.length ? (
                            <ul>{section.items.map((item, itemIndex) => <li key={`${section.key}-${itemIndex}`}>{item}</li>)}</ul>
                          ) : <p>{section.text}</p>}
                          {section.citations.length > 0 && (
                            <div className="answer-citations">
                              {section.citations.map((citation) => <code key={citation}>{citation}</code>)}
                            </div>
                          )}
                        </section>
                      ))}
                    </div>
                    <div className="answer-footer">
                      <span>검증된 인용</span>
                      {answer.citations.length > 0
                        ? answer.citations.map((citation) => <code key={citation}>{citation}</code>)
                        : <em>확인된 인용 없음 · 답변을 사실로 확정하지 마세요.</em>}
                    </div>
                  </div>
                )}
              </article>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
