import { FormEvent } from 'react';

type QuestionComposerProps = {
  question: string;
  busy: boolean;
  scopeLabel: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
};

export default function QuestionComposer({ question, busy, scopeLabel, onChange, onSubmit }: QuestionComposerProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(question);
  }

  return (
    <form className="atlas-composer" onSubmit={submit}>
      <div className="atlas-composer-scope"><span>분석 범위</span><strong>{scopeLabel}</strong></div>
      <textarea value={question} onChange={(event) => onChange(event.target.value)} placeholder="커밋이나 PR에 대해 질문하세요…" aria-label="분석 질문" />
      <div className="atlas-composer-footer">
        <div className="atlas-composer-hints">
          <button type="button" onClick={() => onChange('이 변경은 왜 만들어졌나? 기록과 코드 근거를 나눠 설명해줘.')} disabled={busy}>왜 만들었나</button>
          <button type="button" onClick={() => onChange('이 변경이 프로젝트의 어떤 흐름에 영향을 주나?')} disabled={busy}>영향 범위</button>
          <button type="button" onClick={() => onChange('이 변경에서 실행으로 확인해야 할 부분은 무엇인가?')} disabled={busy}>확인 필요</button>
        </div>
        <button type="submit" className="atlas-send-button" disabled={busy || question.trim().length < 2} aria-label="근거로 답변 받기">{busy ? '…' : '↑'}</button>
      </div>
    </form>
  );
}
