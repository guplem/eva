/**
 * A permission request in the chat that asks: an amber card with Eva's firm face beside it.
 * A request with the model's questions shows them as a form in the same card (issue #544).
 * On a phone, the cards form a bottom sheet at the end of the chat, above the composer, with full-width buttons.
 */
import { useLayoutEffect, useState, type ReactElement } from "react";
import type { ApprovalQuestion, QuestionAnswers } from "../../../shared/events.ts";
import type { PendingApproval } from "./api.ts";
import { pickOption } from "../../../shared/questions.ts";
import { approvalTitle, questionAnswers, type QuestionDraft } from "./approvals.ts";
import { Icon } from "./icons.tsx";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";

export type ApprovalAnswer = "allow" | "deny";

/** The pending approvals, and what the views do with them. */
export interface ChatApprovals {
  readonly pending: readonly PendingApproval[];
  /** The answers go with "allow" for a request with questions. */
  readonly onAnswer: (requestId: string, answer: ApprovalAnswer, answers?: QuestionAnswers) => Promise<void>;
  /** A view names the sessions it shows, so the page gives the other approvals a notice. */
  readonly onShowChat: (sessionIds: readonly string[]) => void;
}

/** Tells the page which sessions are on screen, and that none are once the view goes. */
export function useShownChat(onShowChat: ChatApprovals["onShowChat"], sessionIds: readonly string[]): void {
  // A string key: the array is new at each render, and its content is what counts.
  // A layout effect, so the first frame of a chat never shows its request as a card and as a notice.
  const key = sessionIds.join("\n");
  useLayoutEffect(() => {
    onShowChat(key === "" ? [] : key.split("\n"));
    return () => onShowChat([]);
  }, [key, onShowChat]);
}

/** Every request of one branch, oldest first. */
export function ApprovalRequests({
  approvals,
  place,
  onAnswer,
}: {
  readonly approvals: readonly PendingApproval[];
  /** The clone or the chat that asks. */
  readonly place: string;
  readonly onAnswer: ChatApprovals["onAnswer"];
}): ReactElement {
  return (
    <div className="approval-requests">
      {approvals.map((approval) => (
        <ApprovalCard key={approval.requestId} approval={approval} place={place} onAnswer={onAnswer} />
      ))}
    </div>
  );
}

function ApprovalCard({
  approval,
  place,
  onAnswer,
}: {
  readonly approval: PendingApproval;
  readonly place: string;
  readonly onAnswer: ChatApprovals["onAnswer"];
}): ReactElement {
  // A second tap while the answer travels must not send it again.
  const [answering, setAnswering] = useState(false);
  const answer = (choice: ApprovalAnswer, answers?: QuestionAnswers): void => {
    setAnswering(true);
    void onAnswer(approval.requestId, choice, answers).finally(() => setAnswering(false));
  };
  const questions = approval.questions;
  return (
    <div className="msg">
      <Visor size={28} face={stateFaces.asksPermission} />
      <section
        className="approval-card"
        aria-label={questions === undefined ? "Eva asks for permission" : "Eva asks you a question"}
      >
        <div className="approval-head">
          <span className="status-pill needs-you">Needs you</span>
          <span className="approval-place">{place}</span>
        </div>
        <h2>{approvalTitle(approval.toolName, questions)}</h2>
        {questions === undefined ? (
          <PermissionBody summary={approval.summary} answering={answering} onAnswer={answer} />
        ) : (
          <QuestionForm requestId={approval.requestId} questions={questions} answering={answering} onAnswer={answer} />
        )}
      </section>
    </div>
  );
}

function PermissionBody({
  summary,
  answering,
  onAnswer: answer,
}: {
  readonly summary: string;
  readonly answering: boolean;
  readonly onAnswer: (choice: ApprovalAnswer) => void;
}): ReactElement {
  return (
    <>
      <pre className="approval-input">
        <code>{summary}</code>
      </pre>
      <div className="approval-actions">
        <button className="primary" disabled={answering} onClick={() => answer("allow")}>
          <Icon name="check" /> Allow once
        </button>
        <button className="danger" disabled={answering} onClick={() => answer("deny")}>
          Deny
        </button>
      </div>
    </>
  );
}

/** Each question with its options, and a field for the person's own answer. Send waits for every answer. */
function QuestionForm({
  requestId,
  questions,
  answering,
  onAnswer: answer,
}: {
  readonly requestId: string;
  readonly questions: readonly ApprovalQuestion[];
  readonly answering: boolean;
  readonly onAnswer: (choice: ApprovalAnswer, answers?: QuestionAnswers) => void;
}): ReactElement {
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() => questions.map(() => ({ selected: [], other: "" })));
  const change = (index: number, next: Partial<QuestionDraft>): void => {
    setDrafts((current) => current.map((draft, at) => (at === index ? { ...draft, ...next } : draft)));
  };
  const answers = questionAnswers(questions, drafts);
  // A form, so Enter in an own-answer field sends the answers.
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (answers !== null && !answering) answer("allow", answers);
      }}
    >
      {questions.map((question, index) => {
        const draft = drafts[index] ?? { selected: [], other: "" };
        // The request id keeps two cards of one page from sharing a radio group.
        const group = `question-${requestId}-${String(index)}`;
        return (
          <fieldset key={group} className="question">
            <legend>
              {question.header !== "" && <span className="pill">{question.header}</span>}
              <span className="question-text">{question.question}</span>
            </legend>
            {question.options.map((option, optionIndex) => (
              <label key={optionIndex} className="question-option">
                <input
                  type={question.multiSelect ? "checkbox" : "radio"}
                  name={group}
                  checked={draft.selected.includes(optionIndex)}
                  disabled={answering}
                  // A choice and own text never both show: only one of them would reach the model.
                  onChange={() =>
                    change(index, {
                      selected: pickOption(draft.selected, optionIndex, question.multiSelect),
                      other: "",
                    })
                  }
                />
                <span className="question-option-text">
                  <span>{option.label}</span>
                  {option.description !== "" && <span className="field-hint">{option.description}</span>}
                </span>
              </label>
            ))}
            <label className="field">
              <span className="field-hint">Or write your own answer in place of a choice.</span>
              <input
                type="text"
                value={draft.other}
                disabled={answering}
                onChange={(event) => {
                  const other = event.target.value;
                  change(index, other.trim() === "" ? { other } : { other, selected: [] });
                }}
              />
            </label>
          </fieldset>
        );
      })}
      <div className="approval-actions">
        <button type="submit" className="primary" disabled={answering || answers === null} aria-busy={answering}>
          {answering ? <ButtonSpinner /> : <Icon name="check" />} Send answers
        </button>
        <button type="button" className="ghost" disabled={answering} onClick={() => answer("deny")}>
          Skip
        </button>
      </div>
      {answering && <ProgressBar label="Eva sends your answers." />}
    </form>
  );
}

/** One line for each request of a chat that is not on screen. It names the chat and opens it. */
export function ApprovalNotice({
  entries,
}: {
  readonly entries: readonly {
    readonly requestId: string;
    /** The words before the place, such as "Eva has a question in". */
    readonly words: string;
    readonly place: string;
    readonly open: () => void;
  }[];
}): ReactElement | null {
  if (entries.length === 0) return null;
  return (
    <section className="approval-notice" aria-label="Chats that wait for you" aria-live="polite">
      {entries.map((entry) => (
        <div key={entry.requestId} className="approval-notice-item">
          <span className="status-pill needs-you">Needs you</span>
          <span className="approval-notice-text">
            {entry.words} <strong>{entry.place}</strong>
          </span>
          <button className="ghost" aria-label={`Open ${entry.place}`} onClick={entry.open}>
            Open
          </button>
        </div>
      ))}
    </section>
  );
}
