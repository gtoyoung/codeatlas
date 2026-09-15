import QuestionComposer from './QuestionComposer';
import type { TimelineEvent } from './workspace-types';

type AnalysisThreadProps = {
  events: TimelineEvent[];
  scopeLabel: string;
  question: string;
  busy: boolean;
  onQuestionChange: (value: string) => void;
  onAsk: (value: string) => void;
  onEvidenceSelect: (id: string) => void;
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

function EvidenceLinks({ ids, onSelect }: { ids?: string[]; onSelect: (id: string) => void }) {
  if (!ids?.length) return null;
  return <div className="atlas-evidence-links">{ids.slice(0, 6).map((id) => <button type="button" key={id} onClick={() => onSelect(id)}>근거 확인</button>)}</div>;
}

function AnswerEvent({ event, onEvidenceSelect }: { event: TimelineEvent; onEvidenceSelect: (id: string) => void }) {
  const answer = event.answer;
  if (!answer) return null;
  const sections = answer.sections?.length ? answer.sections : [{ key: 'answer', label: '답변', text: answer.answer, citations: answer.citations }];
  return (
    <article className={`atlas-event atlas-answer-event answer-${answer.support}`} aria-live="polite">
      <div className="atlas-event-marker answer-marker">A</div>
      <div className="atlas-event-body">
        <div className="atlas-event-meta"><span>{event.title}</span><b>{supportLabel(answer.support)}</b><small>{modeLabel(answer.mode)}</small></div>
        <div className="atlas-answer-sections">
          {sections.map((section, index) => <section className="atlas-answer-section" data-kind={section.key} key={`${section.key}-${index}`}>
            <h4>{section.label}</h4>
            {section.items?.length ? <ul>{section.items.map((item, itemIndex) => <li key={`${section.key}-${itemIndex}`}>{item}</li>)}</ul> : <p>{section.text}</p>}
            <EvidenceLinks ids={section.citations} onSelect={onEvidenceSelect} />
          </section>)}
        </div>
      </div>
    </article>
  );
}

export default function AnalysisThread({ events, scopeLabel, question, busy, onQuestionChange, onAsk, onEvidenceSelect }: AnalysisThreadProps) {
  return (
    <section className="atlas-thread" aria-label="분석 대화">
      <div className="atlas-thread-intro"><span className="atlas-eyebrow">ANALYSIS THREAD</span><p>변경의 이유부터 영향과 확인할 부분까지 시간 순서로 읽습니다.</p></div>
      <div className="atlas-timeline">
        {events.map((event) => {
          if (event.kind === 'snapshot') return <article className="atlas-event" key={event.id}>
            <div className="atlas-event-marker">G</div>
            <div className="atlas-event-body">
              <div className="atlas-event-meta"><span>{event.title}</span><small>Git 기록</small></div>
              <p className="atlas-event-lead">{event.text}</p>
              {event.metrics && <div className="atlas-metrics"><span><b>{event.metrics.files}</b>변경 파일</span><span><b>+{event.metrics.additions}</b>추가</span><span><b>−{event.metrics.deletions}</b>삭제</span></div>}
              <EvidenceLinks ids={event.evidenceIds} onSelect={onEvidenceSelect} />
            </div>
          </article>;
          if (event.kind === 'narrative') return <article className="atlas-event" key={event.id}>
            <div className="atlas-event-marker narrative-marker">A</div>
            <div className="atlas-event-body">
              <div className="atlas-event-meta"><span>{event.title}</span><small>Git · 코드 근거</small></div>
              <div className="atlas-story-card">
                <h2>{event.narrative?.why}</h2>
                <div className="atlas-story-grid"><section><span>무엇을 바꿨나</span><p>{event.narrative?.what}</p></section><section><span>프로젝트에 어떤 변화인가</span><p>{event.narrative?.impact}</p></section></div>
                <div className="atlas-story-boundary"><span>확인 경계</span><p>{event.narrative?.confidence}</p></div>
              </div>
              <EvidenceLinks ids={event.evidenceIds} onSelect={onEvidenceSelect} />
            </div>
          </article>;
          if (event.kind === 'impact') return <article className="atlas-event" key={event.id}>
            <div className="atlas-event-marker impact-marker">↳</div>
            <div className="atlas-event-body">
              <div className="atlas-event-meta"><span>{event.title}</span><small>정적 관계</small></div>
              <p className="atlas-event-lead">변경 파일과 연결된 코드를 확인하세요. 동적 연결은 실행 검증이 필요합니다.</p>
              <div className="atlas-impact-events">{event.items?.slice(0, 8).map((item) => <button type="button" className="atlas-impact-item" key={item.id} onClick={() => onEvidenceSelect(item.id)}><span>{item.label}</span><strong>{item.text}</strong><small>{item.path ?? '위치 정보 없음'}{item.line ? `:${item.line}` : ''}</small></button>)}</div>
            </div>
          </article>;
          if (event.kind === 'question') return <article className="atlas-event atlas-question-event" key={event.id}>
            <div className="atlas-event-marker question-marker">Q</div>
            <div className="atlas-event-body"><div className="atlas-event-meta"><span>질문</span><small>{event.createdAt ? new Date(event.createdAt).toLocaleString('ko-KR') : ''}</small></div><p className="atlas-question-text">{event.question}</p></div>
          </article>;
          if (event.kind === 'answer') return <AnswerEvent key={event.id} event={event} onEvidenceSelect={onEvidenceSelect} />;
          return null;
        })}
      </div>
      <QuestionComposer question={question} busy={busy} scopeLabel={scopeLabel} onChange={onQuestionChange} onSubmit={onAsk} />
    </section>
  );
}
