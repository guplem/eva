/**
 * A conversation as a tree: the chat and each of its forks in a
 * column of its own, each with its own input, and retry and fork on every answer.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { api, type SessionRecord } from "./api.ts";
import { useShowError } from "./error-toast.tsx";
import type { LiveState } from "./live-state.ts";
import { runningCount, TasksDialog, tasksOf } from "./TasksPanel.tsx";
import { toWebHtml } from "./web-format.ts";

/** Closer to the bottom than this counts as "at the bottom", so a new message scrolls into view. */
const stickToBottomPx = 80;

interface ConversationProps {
  readonly root: SessionRecord;
  readonly sessions: readonly SessionRecord[];
  readonly live: LiveState;
  readonly onChanged: () => Promise<void>;
}

/** Deletes the chat and its forks in every front end, after a confirm. */
export function DeleteChatButton({
  chat,
  onChanged,
}: {
  readonly chat: SessionRecord;
  readonly onChanged: () => Promise<void>;
}): ReactElement {
  const showError = useShowError();
  const remove = async (): Promise<void> => {
    if (!window.confirm(`Delete “${chat.title}” and its forks everywhere?`)) return;
    try {
      await api.deleteChat(chat.id);
      await onChanged();
    } catch (caught) {
      showError(caught);
    }
  };
  return (
    <button className="danger" onClick={() => void remove()}>
      Delete chat
    </button>
  );
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
  const [showTasks, setShowTasks] = useState(false);
  const closeTasks = useCallback(() => setShowTasks(false), []);
  const tasks = tasksOf(live.tasks, [session.id]);
  // The side panel hides on a phone, so a running task also shows here.
  const running = runningCount(tasks);
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
            {/* toWebHtml escapes all text and adds only its own tags, so the HTML is safe. */}
            <div className="answer-body" dangerouslySetInnerHTML={{ __html: toWebHtml(turn.answerText) }} />
            {turn.failure !== null && <div className="failed">The turn failed: {turn.failure}</div>}
            <div className="message-actions">
              {activityOf(turn) !== "" && <span className="chip">{activityOf(turn)}</span>}
              {turn.taskCount > 0 && (
                <button onClick={() => setShowTasks(true)}>{counted(turn.taskCount, "background task")}</button>
              )}
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
          <div className="answer-body" dangerouslySetInnerHTML={{ __html: toWebHtml(streaming) }} />
        </div>
      )}
      {running > 0 && (
        <button className="running-tasks" onClick={() => setShowTasks(true)}>
          {counted(running, "background task")} running
        </button>
      )}
      {showTasks && <TasksDialog tasks={tasks} onClose={closeTasks} />}
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

/** "3 commands, 1 tool": what a turn did, with each zero part left out. */
function activityOf(turn: SessionRecord["turns"][number]): string {
  const tools = turn.toolCount - turn.commandCount;
  return [
    ...(turn.commandCount > 0 ? [counted(turn.commandCount, "command")] : []),
    ...(tools > 0 ? [counted(tools, "tool")] : []),
  ].join(", ");
}

function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** The ids of a chat and of each of its forks. */
export function chatTreeIds(root: SessionRecord, sessions: readonly SessionRecord[]): string[] {
  return [root, ...descendantsOf(root.id, sessions)].map((session) => session.id);
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
