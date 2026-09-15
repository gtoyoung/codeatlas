type EvidenceItem = {
  id: string;
  label: string;
  text: string;
  path?: string | null;
  line?: number | null;
  diff?: { status: string; patch: string | null; additions: number; deletions: number } | null;
};

type EvidenceGroup = { key: string; label: string; items: EvidenceItem[] };

type EvidenceInspectorProps = {
  groups: EvidenceGroup[];
  selectedId: string | null;
  open: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
};

export default function EvidenceInspector({ groups, selectedId, open, onSelect, onClose }: EvidenceInspectorProps) {
  const selected = groups.flatMap((group) => group.items).find((item) => item.id === selectedId) ?? null;
  return (
    <aside className={open ? 'atlas-inspector open' : 'atlas-inspector'} aria-label="근거 검사기">
      <div className="atlas-inspector-head"><div><span className="atlas-eyebrow">EVIDENCE INSPECTOR</span><h2>근거 검사기</h2></div><button type="button" className="atlas-icon-button" onClick={onClose} aria-label="근거 검사기 닫기">×</button></div>
      <p className="atlas-inspector-intro">설명에 사용된 근거를 종류별로 확인합니다.</p>
      <div className="atlas-inspector-groups">
        {groups.map((group) => <section key={group.key} className={`atlas-inspector-group group-${group.key}`}>
          <div className="atlas-inspector-group-head"><h3>{group.label}</h3><span>{group.items.length}</span></div>
          {group.items.length === 0 ? <p className="atlas-inspector-empty">확인된 항목이 없습니다.</p> : <div className="atlas-inspector-items">
            {group.items.slice(0, 20).map((item) => <button type="button" key={item.id} className={item.id === selectedId ? 'atlas-inspector-item active' : 'atlas-inspector-item'} onClick={() => onSelect(item.id)}><strong>{item.text}</strong><small>{item.path ?? '기록 항목'}{item.line ? `:${item.line}` : ''}</small></button>)}
          </div>}
        </section>)}
      </div>
      {selected && <section className="atlas-inspector-detail">
        <div className="atlas-inspector-detail-head"><span>{selected.label}</span><button type="button" onClick={() => onSelect('')}>닫기</button></div>
        <p>{selected.text}</p>
        {selected.path && <code>{selected.path}{selected.line ? `:${selected.line}` : ''}</code>}
        {selected.diff?.patch && <details open><summary>실제 코드 변경</summary><pre>{selected.diff.patch}</pre></details>}
      </section>}
    </aside>
  );
}
