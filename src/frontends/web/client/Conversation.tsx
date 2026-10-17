/**
 * A conversation as a tree (mockups/project-mode.png): the chat and each of its forks in a
 * column of its own, each with its own input, and retry and fork on every answer.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { toTelegramHtml } from "../../telegram/telegram-format.ts";
import { api, type SessionRecord } from "./api.ts";
import { useShowError } from "./error-toast.tsx";
import type { LiveState } from "./live-state.ts";

/** Closer to the bottom than this counts as "at the bottom", so a new message scrolls into view. */
const stickToBottomPx = 80;

interface ConversationProps {
  readonly root: SessionRecord;
  readonly sessions: readonly SessionRecord[];
  readonly live: LiveState;
  readonly onChanged: () => Promise<void>;
}

export function Conversation({ root, sessions, live, onChanged }: ConversationProps): ReactElement {
  const branches = [root, ...descendantsOf(root.id, sessions)];
  const scroller = useRef<HTMLDivElement>(null);
  // The view follows the newest message, until the person scrolls up to read.
  const isAtBottom = useRef(true);

  useEffect(() => {
    isAtBottom.current = true;
  }, [root.id]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element !== null && isAtBottom.current) element.scrollTop = element.scrollHeight;
  });

  return (
    <div
      className="branches"
      ref={scroller}
      onScroll={(event) => {
        const element = event.currentTarget;
        isAtBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < stickToBottomPx;
      }}
    >
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
  const showError = useShowError();
  const turnCount = session.turns.length;

  useEffect(() => {
    setPending(null);
  }, [turnCount]);
  const streaming = live.streaming[session.id];
  const forkTurn = parent?.turns.findIndex((turn) => turn.lastMessageId === session.forkAtMessageId) ?? -1;

  const send = async (): Promise<void> => {
    const message = text.trim();
    if (message === "") return;
    setBusy(true);
    setPending(message);
    setText("");
    try {
      await api.send(session.id, message);
    } catch (caught) {
      // The person must not type the message again.
      setPending(null);
      setText(text);
      showError(caught);
    } finally {
      setBusy(false);
    }
  };

  /** Runs an action on an answer, and shows its failure. */
  const runAction = (action: () => Promise<unknown>): void => {
    action()
      .then(onChanged)
      .catch((caught: unknown) => {
        showError(caught);
      });
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
            {turn.failure !== null && <div className="failed">The turn failed: {turn.failure}</div>}
            <div className="message-actions">
              {turn.toolCount > 0 && <span className="chip">{turn.toolCount} tools</span>}
              <button onClick={() => runAction(() => api.retry(session.id, index))}>Retry</button>
              {turn.lastMessageId !== null && turn.failure === null && (
                <button onClick={() => runAction(() => api.fork(session.id, turn.lastMessageId ?? ""))}>Fork</button>
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
            // On a touch screen, Enter starts a new line; the Send button sends.
            if (event.key === "Enter" && !event.shiftKey && !isTouchScreen()) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {(streaming !== undefined || pending !== null) && (
          <button onClick={() => runAction(() => api.stop(session.id))}>Stop</button>
        )}
        <button className="primary" disabled={busy || text.trim() === ""} onClick={() => void send()}>
          Send
        </button>
      </div>
    </section>
  );
}

function isTouchScreen(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
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
