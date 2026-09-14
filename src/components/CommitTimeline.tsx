'use client';

import { FormEvent, useEffect, useState } from 'react';

type ChangedFile = { path: string | null; status: string };
type Commit = {
  oid: string;
  subject: string;
  body: string;
  parentOids: string[];
  author: { name: string; email: string };
  authoredAt: string;
  committedAt: string;
  refs: string[];
  changedFiles: ChangedFile[];
};

function short(value: string) { return value.slice(0, 9); }
function date(value: string) {
  try { return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
  catch { return value; }
}

export default function CommitTimeline({ repositoryId }: { repositoryId: string }) {
  const [query, setQuery] = useState('');
  const [commits, setCommits] = useState<Commit[]>([]);
  const [complete, setComplete] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<Commit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load(search = query) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/repositories/${repositoryId}/commits?limit=100&q=${encodeURIComponent(search)}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? '커밋 이력을 읽지 못했습니다.');
      setCommits(body.commits); setComplete(body.complete); setTruncated(body.truncated); setSelected(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '커밋 이력을 읽지 못했습니다.'); }
    finally { setBusy(false); }
  }

  useEffect(() => { load(''); }, [repositoryId]);

  function submit(event: FormEvent) { event.preventDefault(); load(query); }

  return (
    <div className="history-workspace">
      <div className="workspace-intro">
        <div><span className="section-label">COMMIT LEDGER</span><h2>팀이 남긴 변경의 순서</h2><p>로컬 `.git`의 모든 ref에서 도달 가능한 커밋을 읽습니다. 커밋의 존재는 업무 완료나 테스트 통과를 의미하지 않습니다.</p></div>
        <form className="history-search" onSubmit={submit}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="메시지·작성자 검색" /><button disabled={busy}>{busy ? '읽는 중…' : '검색'}</button></form>
      </div>
      {!complete && <div className="notice-strip">shallow clone이라 이력이 일부일 수 있습니다.</div>}
      {truncated && <div className="notice-strip">최근 100개까지 표시했습니다. 검색어로 범위를 좁힐 수 있습니다.</div>}
      {error && <div className="error-strip" role="alert">{error}</div>}
      <div className="history-layout">
        <div className="commit-feed">
          {commits.length === 0 && !busy && <div className="empty-panel"><strong>조건에 맞는 커밋이 없습니다.</strong><span>저장소의 ref와 검색어를 확인하세요.</span></div>}
          {commits.map((commit) => (
            <button key={commit.oid} className={`commit-item ${selected?.oid === commit.oid ? 'selected' : ''}`} onClick={() => setSelected(commit)}>
              <span className="commit-rail" />
              <div className="commit-main"><div className="commit-meta"><code>{short(commit.oid)}</code><span>{date(commit.committedAt)}</span></div><strong>{commit.subject}</strong><p>{commit.author.name} · {commit.changedFiles.length}개 파일</p></div>
              <div className="commit-refs">{commit.refs.slice(0, 2).map((ref) => <span key={ref}>{ref.replace('refs/heads/', '')}</span>)}</div>
            </button>
          ))}
        </div>
        <aside className="commit-detail panel">
          {!selected ? <div className="detail-placeholder"><span className="index-mark">SELECT A COMMIT</span><strong>왼쪽에서 커밋을 선택하면<br />변경 파일과 작성 근거를 봅니다.</strong></div> : <>
            <div className="panel-head"><h3>{selected.subject}</h3><code>{selected.oid}</code></div>
            <div className="detail-body"><p className="detail-byline">{selected.author.name} &lt;{selected.author.email}&gt; · {date(selected.authoredAt)}</p>{selected.body && <p className="commit-body">{selected.body}</p>}<span className="detail-label">변경 파일 {selected.changedFiles.length}</span><div className="detail-files">{selected.changedFiles.map((file, index) => <div key={`${file.path}-${index}`}><b data-status={file.status[0]}>{file.status}</b><code>{file.path}</code></div>)}</div><span className="detail-label">참조된 ref</span><div className="ref-pills">{selected.refs.map((ref) => <span key={ref}>{ref}</span>)}</div></div>
          </>}
        </aside>
      </div>
    </div>
  );
}
