/**
 * A permission request in the chat that asks: an amber card with Eva's firm face beside it.
 * A phone shows the cards as a bottom sheet over the chat, with full-width buttons.
 */
import { useEffect, useState, type ReactElement } from "react";
import type { PendingApproval } from "./api.ts";
import { approvalTitle } from "./approvals.ts";
import { Icon } from "./icons.tsx";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";

export type ApprovalAnswer = "allow" | "deny";

/** The pending approvals, and what the views do with them. */
export interface ChatApprovals {
  readonly pending: readonly PendingApproval[];
  readonly onAnswer: (requestId: string, answer: ApprovalAnswer) => Promise<void>;
  /** A view names the sessions it shows, so the page gives the other approvals a notice. */
  readonly onShowChat: (sessionIds: readonly string[]) => void;
}

/** Tells the page which sessions are on screen, and that none are once the view goes. */
export function useShownChat(onShowChat: ChatApprovals["onShowChat"], sessionIds: readonly string[]): void {
  // A string key: the array is new at each render, and its content is what counts.
  const key = sessionIds.join("\n");
  useEffect(() => {
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
  const answer = (choice: ApprovalAnswer): void => {
    setAnswering(true);
    void onAnswer(approval.requestId, choice).finally(() => setAnswering(false));
  };
  return (
    <div className="msg">
      <Visor size={28} face={stateFaces.asksPermission} />
      <section className="approval-card" aria-label="Eva asks for permission">
        <div className="approval-head">
          <span className="status-pill needs-you">Needs you</span>
          <span className="approval-place">{place}</span>
        </div>
        <h2>{approvalTitle(approval.toolName)}</h2>
        <pre className="approval-input">
          <code>{approval.summary}</code>
        </pre>
        <div className="approval-actions">
          <button className="primary" disabled={answering} onClick={() => answer("allow")}>
            <Icon name="check" /> Allow once
          </button>
          <button className="danger" disabled={answering} onClick={() => answer("deny")}>
            Deny
          </button>
        </div>
      </section>
    </div>
  );
}

/** One line for each request of a chat that is not on screen. It names the chat and opens it. */
export function ApprovalNotice({
  entries,
}: {
  readonly entries: readonly { readonly requestId: string; readonly place: string; readonly open: () => void }[];
}): ReactElement | null {
  if (entries.length === 0) return null;
  return (
    <section className="approval-notice" aria-label="Chats that wait for you">
      {entries.map((entry) => (
        <div key={entry.requestId} className="approval-notice-item">
          <span className="status-pill needs-you">Needs you</span>
          <span className="approval-notice-text">
            Eva needs your permission in <strong>{entry.place}</strong>
          </span>
          <button className="ghost" aria-label={`Open ${entry.place}`} onClick={entry.open}>
            Open
          </button>
        </div>
      ))}
    </section>
  );
}
