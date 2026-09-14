'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import GraphView from './GraphView';

type Scan = {
  id: string;
  kind: 'commit' | 'working_tree';
  targetOid: string | null;
  baseOid: string | null;
  createdAt: string;
  summary: { title: string; overview: string; mode: string; cautions?: string[]; relationCount?: number };
  report: {
    changes: Array<{ status: string; oldPath: string | null; newPath: string | null }>;
    files: Array<{ path: string; state?: string; reason?: string | null }>;
    coverage?: { totalFiles: number; indexedFiles: number; excludedFiles: number };
    evidence?: Array<{ id: string; text: string; path?: string }>;
  };
  graph: {
    nodes: Array<{ id: string; kind: string; label: string; path?: string }>;
    edges: Array<{ id: string; source: string; target: string; kind: string }>;
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

export default function Dashboard({ suggestedPath }: { suggestedPath: string }) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [path, setPath] = useState(suggestedPath);
  const [mode, setMode] = useState<'working_tree' | 'commit'>('working_tree');
  const [question, setQuestion] = useState('이 변경에서 함께 확인해야 할 코드는 어디야?');
  const [answer, setAnswer] = useState<{ answer: string; citations: string[]; support: string; mode: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selected = useMemo(
    () => repositories.find((repository) => repository.id === selectedId) ?? null,
    [repositories, selectedId],
  );

  async function refresh(preferredId?: string) {
    const body = await readJson(await fetch('/api/repositories', { cache: 'no-store' }));
    setRepositories(body.repositories);
    const nextId = preferredId ?? selectedId ?? body.repositories[0]?.id ?? null;
    setSelectedId(nextId);
    setScan(body.repositories.find((repository: Repository) => repository.id === nextId)?.latestScan ?? null);
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
      const body = await readJson(await fetch(`/api/repositories/${selected.id}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: mode, ref: selected.defaultRef }),
      }));
      setScan(body.scan);
      await refresh(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '분석하지 못했습니다.');
    } finally {
      setBusy(false);
    }
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
    setAnswer(null);
  }

  const coverage = scan?.graph.coverage;

  return (
    <main className="workbench">
      <header className="masthead">
        <div>
          <span className="eyebrow">LOCAL CODE INTELLIGENCE</span>
          <h1>Code <i>Atlas</i></h1>
          <p>Git과 지금의 소스를 한 장의 근거 지도로 읽습니다.</p>
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
          {!scan ? (
            <div className="welcome-panel">
              <span className="index-mark">A—Z</span>
              <h2>코드의 현재 상태부터<br />정확히 고정합니다.</h2>
              <p>저장소를 등록하면 변경 파일, 정적 관계, 해석하지 못한 영역을 함께 보여줍니다.</p>
            </div>
          ) : (
            <>
              <div className="snapshot-banner">
                <div>
                  <span>{scan.kind === 'working_tree' ? 'WORKING TREE' : 'COMMIT'}</span>
                  <strong>{shortOid(scan.targetOid)}</strong>
                </div>
                <button onClick={rescan} disabled={busy}>다시 분석</button>
              </div>

              <article className="summary-card">
                <div className="summary-copy">
                  <span className="section-label">변경 해설 · {scan.summary.mode}</span>
                  <h2>{scan.summary.title}</h2>
                  <p>{scan.summary.overview}</p>
                </div>
                <div className="metric-row">
                  <div><strong>{scan.report.changes.length}</strong><span>변경 파일</span></div>
                  <div><strong>{coverage?.indexedFiles ?? 0}</strong><span>분석 파일</span></div>
                  <div><strong>{scan.graph.edges.length}</strong><span>정적 관계</span></div>
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
                        <span>{change.newPath ?? change.oldPath}</span>
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

              <article className="panel graph-panel">
                <div className="panel-head"><h3>소스 관계 지도</h3><span>최대 80개 노드</span></div>
                <GraphView graph={scan.graph} />
              </article>

              <article className="evidence-desk">
                <div>
                  <span className="section-label">EVIDENCE DESK</span>
                  <h3>이 코드에 질문하기</h3>
                  <p>답변은 이 스냅샷에 연결된 Git 변경과 정적 관계만 인용합니다.</p>
                </div>
                <form onSubmit={ask}>
                  <textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
                  <button disabled={busy || question.trim().length < 2}>근거로 답변</button>
                </form>
                {answer && (
                  <div className="answer-card">
                    <div><b>{answer.support}</b><span>{answer.mode}</span></div>
                    <p>{answer.answer}</p>
                    <small>근거: {answer.citations.length ? answer.citations.join(', ') : '확인된 인용 없음'}</small>
                  </div>
                )}
              </article>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
