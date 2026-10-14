/**
 * A conversation as a tree (mockups/project-mode.png): the chat and each of its forks in a
 * column of its own, each with its own input, and retry and fork on every answer (plan §4.5).
 */
import { useEffect, useState, type ReactElement } from "react";
import { toTelegramHtml } from "../../telegram/telegram-format.ts";
import { api, type SessionRecord } from "./api.ts";
import type { LiveState } from "./live-state.ts";

interface ConversationProps {
  readonly root: SessionRecord;
  readonly sessions: readonly SessionRecord[];
  readonly live: LiveState;
  readonly onChanged: () => Promise<void>;
}

export function Conversation({ root, sessions, live, onChanged }: ConversationProps): ReactElement {
  const branches = [root, ...descendantsOf(root.id, sessions)];
  return (
    <div className="branches">
      {branches.map((branch) => (
        <Branch
          key={branch.id}
          session={branch}
          parent={sessions.find((candidate) => candidate.id === branch.parentId)}
          live={live}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

function Branch({
  session,
  parent,
  live,
  onChanged,
}: {
  session: SessionRecord;
  parent: SessionRecord | undefined;
  live: LiveState;
  onChanged: () => Promise<void>;
}): ReactElement {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const turnCount = session.turns.length;

  useEffect(() => {
    setPending(null);
  }, [turnCount]);
  const streaming = live.streaming[session.id];
  const forkTurn = parent?.turns.findIndex((turn) => turn.lastMessageId === session.forkAtMessageId) ?? -1;

  const send = async (): Promise<void> => {
    if (text.trim() === "") return;
    setBusy(true);
    try {
      await api.send(session.id, text.trim());
      setPending(text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="branch" aria-label={`Branch ${session.title}`}>
      {parent !== undefined && (
        <div className="branch-title">
          Branch after answer {forkTurn + 1} of “{parent.title}”
        </div>
      )}
      {session.turns.map((turn, index) => (
        <div key={`${session.id}-${String(index)}`} style={{ display: "contents" }}>
          <div className="message user">{turn.userText}</div>
          <div className="message answer">
            {/* toTelegramHtml escapes all text and adds only its own tags, so the HTML is safe. */}
            <div dangerouslySetInnerHTML={{ __html: toTelegramHtml(turn.answerText) }} />
            <div className="message-actions">
              {turn.toolCount > 0 && <span className="chip">{turn.toolCount} tools</span>}
              <button onClick={() => void api.retry(session.id, index).then(onChanged)}>Retry</button>
              {turn.lastMessageId !== null && (
                <button onClick={() => void api.fork(session.id, turn.lastMessageId ?? "").then(onChanged)}>
                  Fork
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {pending !== null && <div className="message user">{pending}</div>}
      {streaming !== undefined && (
        <div className="message answer" aria-live="polite">
          <div dangerouslySetInnerHTML={{ __html: toTelegramHtml(streaming) }} />
        </div>
      )}
      <div className="composer">
        <textarea
          aria-label="Message"
          placeholder="Message Eva"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button className="primary" disabled={busy || text.trim() === ""} onClick={() => void send()}>
          Send
        </button>
      </div>
    </section>
  );
}

function descendantsOf(sessionId: string, sessions: readonly SessionRecord[]): SessionRecord[] {
  const children = sessions.filter((session) => session.parentId === sessionId);
  return children.flatMap((child) => [child, ...descendantsOf(child.id, sessions)]);
}

/** The chats that start a tree: no parent, newest first. */
export function rootChats(sessions: readonly SessionRecord[]): SessionRecord[] {
  return sessions
    .filter((session) => session.parentId === null)
    .sort((first, second) =>
      (second.lastTurnAt ?? second.createdAt).localeCompare(first.lastTurnAt ?? first.createdAt),
    );
}
