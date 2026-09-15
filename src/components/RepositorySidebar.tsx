import { FormEvent, useMemo, useState } from 'react';

import type { Repository, Scan } from './workspace-types';

type Workspace = 'overview' | 'commits' | 'pulls';

type RepositorySidebarProps = {
  repositories: Repository[];
  selectedId: string | null;
  selectedScan: Scan | null;
  workspace: Workspace;
  path: string;
  mode: 'working_tree' | 'commit';
  busy: boolean;
  onPathChange: (value: string) => void;
  onModeChange: (value: 'working_tree' | 'commit') => void;
  onRegister: (event: FormEvent<HTMLFormElement>) => void;
  onRepositorySelect: (repository: Repository) => void;
  onWorkspaceChange: (workspace: Workspace) => void;
};

function shortOid(value: string | null) {
  return value ? value.slice(0, 9) : 'WORKTREE';
}

function scanTitle(scan: Scan | null) {
  if (!scan) return '분석 없음';
  if (scan.report.metadata?.type === 'pull_request') return scan.report.metadata.title ?? `PR #${scan.report.metadata.number ?? '?'}`;
  return scan.report.metadata?.subject ?? (scan.kind === 'working_tree' ? '현재 작업 트리' : '최근 커밋');
}

export default function RepositorySidebar({
  repositories,
  selectedId,
  selectedScan,
  workspace,
  path,
  mode,
  busy,
  onPathChange,
  onModeChange,
  onRegister,
  onRepositorySelect,
  onWorkspaceChange,
}: RepositorySidebarProps) {
  const [search, setSearch] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return repositories;
    return repositories.filter((repository) => `${repository.name} ${repository.path}`.toLowerCase().includes(query));
  }, [repositories, search]);

  function submitRegister(event: FormEvent<HTMLFormElement>) {
    onRegister(event);
    setShowRegister(false);
  }

  return (
    <aside className="atlas-sidebar" aria-label="저장소 탐색">
      <div className="atlas-sidebar-head">
        <div className="atlas-brand"><span className="atlas-brand-mark">A</span><strong>Code Atlas</strong><span className="atlas-chevron">⌄</span></div>
        <span className="atlas-connection-dot" aria-label="로컬 연결됨" />
      </div>

      <button type="button" className="atlas-new-analysis" onClick={() => setShowRegister((value) => !value)}>
        <span>＋</span> 새 분석
      </button>

      {showRegister && <form className="atlas-register-form" onSubmit={submitRegister}>
        <label>
          <span>저장소 경로</span>
          <input value={path} onChange={(event) => onPathChange(event.target.value)} placeholder="C:\\projects\\my-app" />
        </label>
        <label>
          <span>분석 기준</span>
          <select value={mode} onChange={(event) => onModeChange(event.target.value as 'working_tree' | 'commit')}>
            <option value="working_tree">현재 로컬 소스</option>
            <option value="commit">HEAD 커밋</option>
          </select>
        </label>
        <button type="submit" disabled={busy}>{busy ? '읽는 중…' : '등록하고 분석'}</button>
      </form>}

      <label className="atlas-search">
        <span aria-hidden="true">⌕</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="저장소 찾기" />
      </label>

      <div className="atlas-sidebar-section">
        <span className="atlas-sidebar-label">프로젝트</span>
        <div className="atlas-repository-list">
          {filtered.length === 0 && <p className="atlas-sidebar-empty">저장소가 없습니다.</p>}
          {filtered.map((repository) => (
            <button type="button" key={repository.id} className={repository.id === selectedId ? 'atlas-repository active' : 'atlas-repository'} onClick={() => onRepositorySelect(repository)}>
              <span className="atlas-folder" aria-hidden="true">⌂</span>
              <span className="atlas-repository-copy"><strong>{repository.name}</strong><small>{repository.latestScan ? shortOid(repository.latestScan.targetOid) : '분석 없음'}</small></span>
            </button>
          ))}
        </div>
      </div>

      {selectedId && <div className="atlas-sidebar-section atlas-sidebar-nav">
        <span className="atlas-sidebar-label">작업 공간</span>
        <button type="button" className={workspace === 'overview' ? 'active' : ''} onClick={() => onWorkspaceChange('overview')}><span>◌</span> 현재 분석</button>
        <button type="button" className={workspace === 'commits' ? 'active' : ''} onClick={() => onWorkspaceChange('commits')}><span>⌘</span> 커밋 <small>Git</small></button>
        <button type="button" className={workspace === 'pulls' ? 'active' : ''} onClick={() => onWorkspaceChange('pulls')}><span>↗</span> PR <small>OneDev</small></button>
      </div>}

      <div className="atlas-sidebar-section atlas-sidebar-recent">
        <span className="atlas-sidebar-label">최근 분석</span>
        {selectedScan ? <button type="button" className="atlas-recent-item" onClick={() => onWorkspaceChange('overview')}>
          <span className="atlas-recent-dot" aria-hidden="true" />
          <span><strong>{scanTitle(selectedScan)}</strong><small>{shortOid(selectedScan.targetOid)} · {selectedScan.report.changes.length}개 파일</small></span>
        </button> : <p className="atlas-sidebar-empty">분석 결과가 여기에 표시됩니다.</p>}
      </div>

      <div className="atlas-sidebar-footer"><span className="atlas-avatar">D</span><span>로컬 작업 공간</span><span className="atlas-footer-help">?</span></div>
    </aside>
  );
}
