'use client';

import { useEffect, useMemo, useState } from 'react';

type PullRequest = { id: number | string | null; number: number | null; title: string; description: string; status: string; source: string | null; target: string | null; author: { name: string }; createdAt: string | null; updatedAt: string | null };
type PullRequestDetail = { pullRequest: PullRequest; changes: any[]; reviews: any[]; comments: any[]; updates: any[]; builds: any[]; gitRefs?: { base: { available: boolean; oid: string | null }; head: { available: boolean; oid: string | null }; merge: { available: boolean; oid: string | null } } };

function date(value: string | null) { if (!value) return '날짜 없음'; try { return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(new Date(value)); } catch { return value; } }
function label(status: string) { return ({ open: '검토 필요', merged: '병합됨', discarded: '닫힘', closed: '닫힘' } as Record<string, string>)[status] ?? status; }
function changePath(change: any) { return change.path ?? change.newPath ?? change.oldPath ?? change.filePath ?? change.blobPath ?? '변경 파일'; }
function activityText(value: any) { return typeof value === 'string' ? value : value?.body ?? value?.message ?? value?.comment ?? value?.content ?? ''; }

export default function PullRequestInbox({ repositoryId, onAnalyze }: { repositoryId: string; onAnalyze?: (pullRequest: PullRequest) => void }) {
  const [items, setItems] = useState<PullRequest[]>([]);
  const [selected, setSelected] = useState<PullRequestDetail | null>(null);
  const [filter, setFilter] = useState('all');
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/repositories/${repositoryId}/pull-requests?count=100`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) { setConfigured(body.error?.code !== 'ONEDEV_NOT_CONFIGURED'); throw new Error(body.error?.message ?? 'PR 목록을 읽지 못했습니다.'); }
      setConfigured(true); setItems(body.items ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'PR 목록을 읽지 못했습니다.'); }
    finally { setBusy(false); }
  }

  useEffect(() => { load(); }, [repositoryId]);

  async function open(item: PullRequest) {
    setSelected({ pullRequest: item, changes: [], reviews: [], comments: [], updates: [], builds: [] });
    const key = item.id ?? item.number;
    if (key == null) return;
    try {
      const response = await fetch(`/api/repositories/${repositoryId}/pull-requests/${encodeURIComponent(String(key))}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'PR 상세를 읽지 못했습니다.');
      setSelected(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'PR 상세를 읽지 못했습니다.'); }
  }

  const filtered = useMemo(() => filter === 'all' ? items : items.filter((item) => item.status === filter), [filter, items]);
  if (!configured && !busy) return <div className="integration-empty"><span className="index-mark">ONEDEV CONNECTOR</span><h2>PR 작업 공간을 연결하세요.</h2><p>서버의 `.env.local`에 <code>ONEDEV_SERVER_URL</code>과 <code>ONEDEV_ACCESS_TOKEN</code>을 설정하면 읽기 전용 PR 목록을 사용할 수 있습니다.</p><button onClick={load}>다시 확인</button></div>;

  return <div className="pr-workspace">
    <div className="workspace-intro"><div><span className="section-label">PULL REQUEST INBOX</span><h2>리뷰가 필요한 변경</h2><p>OneDev의 PR 메타데이터와 변경 파일을 확인합니다. 판단의 근거는 연결된 Git ref와 PR 응답으로 구분합니다.</p></div><button className="quiet-button" onClick={load} disabled={busy}>{busy ? '동기화 중…' : '새로고침'}</button></div>
    {error && <div className="error-strip" role="alert">{error}</div>}
    <div className="pr-filters">{[['all', '전체'], ['open', '검토 필요'], ['merged', '병합됨'], ['discarded', '닫힘']].map(([key, text]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{text}<span>{key === 'all' ? items.length : items.filter((item) => item.status === key).length}</span></button>)}</div>
    <div className="pr-layout"><div className="pr-list">{filtered.length === 0 && <div className="empty-panel"><strong>표시할 PR이 없습니다.</strong><span>OneDev에서 PR이 생성되면 이곳에 나타납니다.</span></div>}{filtered.map((item) => <button key={String(item.id ?? item.number)} className={`pr-item ${selected?.pullRequest.id === item.id ? 'selected' : ''}`} onClick={() => open(item)}><div className="pr-item-top"><span className={`status-badge status-${item.status}`}>{label(item.status)}</span><span>#{item.number ?? item.id} · {date(item.updatedAt ?? item.createdAt)}</span></div><strong>{item.title}</strong><p>{item.source ?? 'source 없음'} <b>→</b> {item.target ?? 'target 없음'}</p><small>{item.author.name}</small></button>)}</div>
      <aside className="pr-detail panel">{!selected ? <div className="detail-placeholder"><span className="index-mark">SELECT A PR</span><strong>PR을 선택하면<br />변경·리뷰·업데이트를 한곳에서 봅니다.</strong></div> : <><div className="panel-head"><div><span className={`status-badge status-${selected.pullRequest.status}`}>{label(selected.pullRequest.status)}</span><h3>#{selected.pullRequest.number ?? selected.pullRequest.id} {selected.pullRequest.title}</h3></div></div><div className="detail-body"><p className="detail-byline">{selected.pullRequest.author.name} · {selected.pullRequest.source ?? 'source 없음'} → {selected.pullRequest.target ?? 'target 없음'}</p>{selected.pullRequest.description && <p className="commit-body">{selected.pullRequest.description}</p>}<button className="analyze-selection" onClick={() => onAnalyze?.(selected.pullRequest)} disabled={!onAnalyze || (selected.pullRequest.number == null && selected.pullRequest.id == null)}>이 PR을 코드와 함께 분석하고 질문하기</button><div className="pr-stat-row"><span><b>{selected.changes.length}</b> 변경</span><span><b>{selected.reviews.length}</b> 리뷰</span><span><b>{selected.comments.length}</b> 댓글</span><span><b>{selected.builds.length}</b> 빌드 정보</span></div><span className="detail-label">변경 파일</span><div className="detail-files">{selected.changes.slice(0, 40).map((change, index) => <div key={`${changePath(change)}-${index}`}><b>·</b><code>{changePath(change)}</code></div>)}</div><span className="detail-label">기록된 의견</span><div className="activity-list">{[...selected.comments.slice(0, 3).map((value) => ({ kind: '댓글', text: activityText(value) })), ...selected.reviews.slice(0, 3).map((value) => ({ kind: '리뷰', text: activityText(value) }))].filter((item) => item.text).map((item, index) => <div key={`${item.kind}-${index}`}><b>{item.kind}</b><span>{item.text}</span></div>)}{selected.comments.length === 0 && selected.reviews.length === 0 && <p className="empty-copy">아직 댓글이나 리뷰 기록이 없습니다.</p>}</div>{selected.gitRefs && <><span className="detail-label">로컬 Git ref</span><div className="ref-pills">{(['base', 'head', 'merge'] as const).map((key) => <span key={key} className={selected.gitRefs?.[key].available ? 'ref-available' : 'ref-missing'}>{key} {selected.gitRefs?.[key].available ? selected.gitRefs?.[key].oid?.slice(0, 9) : '없음'}</span>)}</div></>}<span className="detail-label">확인 경계</span><p className="boundary-copy">PR 상태·리뷰·댓글은 OneDev 기록입니다. 테스트 통과나 업무 의도는 이 화면에서 추정하지 않습니다.</p></div></>}</aside></div>
  </div>;
}
