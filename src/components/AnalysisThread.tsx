import QuestionComposer from './QuestionComposer';
import type { TimelineEvent } from './workspace-types';

type AnalysisThreadProps = {
  events: TimelineEvent[];
  subject: string;
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
  const citationIds = [...new Set([...(answer.citations ?? []), ...sections.flatMap((section) => section.citations ?? [])])];
  return (
    <article className={`atlas-event atlas-answer-event answer-${answer.support}`} aria-live="polite">
      <div className="atlas-event-marker answer-marker">A</div>
      <div className="atlas-event-body">
        <div className="atlas-event-meta"><span>{event.title}</span><b>{supportLabel(answer.support)}</b><small>{modeLabel(answer.mode)}</small></div>
        <div className="atlas-answer-copy">
          <p>{answer.answer}</p>
          <EvidenceLinks ids={citationIds} onSelect={onEvidenceSelect} />
        </div>
      </div>
    </article>
  );
}

export default function AnalysisThread({ events, subject, scopeLabel, question, busy, onQuestionChange, onAsk, onEvidenceSelect }: AnalysisThreadProps) {
  return (
    <section className="atlas-thread" aria-label={`${subject} 분석 대화`}>
      <div className="atlas-thread-intro"><span className="atlas-eyebrow">ANALYSIS THREAD</span><p>커밋과 PR에 대해 질문하고, 필요한 근거만 옆에서 확인하세요.</p></div>
      <div className="atlas-conversation">
        <article className="atlas-welcome-message">
          <div className="atlas-welcome-avatar">A</div>
          <div className="atlas-welcome-body">
            <div className="atlas-event-meta"><span>Code Atlas</span><small>분석 도우미</small></div>
            <h2>이 변경에 대해 무엇이 궁금한가요?</h2>
            <p>변경을 만든 이유, 실제로 바뀐 코드, 프로젝트에 미칠 영향을 질문해 주세요. 답변은 Git·PR 기록과 코드 근거를 구분해 설명합니다.</p>
            <div className="atlas-welcome-context"><span>{scopeLabel}</span><span>근거는 오른쪽 검사기에서 확인</span></div>
          </div>
        </article>
        {events.length > 0 && <div className="atlas-conversation-history">
          {events.map((event) => {
            if (event.kind === 'question') return <article className="atlas-event atlas-question-event" key={event.id}>
              <div className="atlas-event-marker question-marker">Q</div>
              <div className="atlas-event-body"><div className="atlas-event-meta"><span>질문</span><small>{event.createdAt ? new Date(event.createdAt).toLocaleString('ko-KR') : ''}</small></div><p className="atlas-question-text">{event.question}</p></div>
            </article>;
            if (event.kind === 'answer') return <AnswerEvent key={event.id} event={event} onEvidenceSelect={onEvidenceSelect} />;
            return null;
          })}
        </div>}
        {events.length === 0 && <p className="atlas-conversation-empty">아래 입력창에 첫 질문을 남기면 이곳에서 대화를 이어갑니다.</p>}
      </div>
      <QuestionComposer question={question} busy={busy} scopeLabel={scopeLabel} onChange={onQuestionChange} onSubmit={onAsk} />
    </section>
  );
}
