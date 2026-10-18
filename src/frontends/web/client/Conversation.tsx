/**
 * A conversation as a tree: the chat and each of its forks in a
 * column of its own, each with its own input, and retry and fork on every answer.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { api, type SessionRecord } from "./api.ts";
import { useShowError } from "./error-toast.tsx";
import type { LiveState } from "./live-state.ts";
import { runningCount, TasksDialog, tasksOf } from "./ChatPanel.tsx";
import { StepRow } from "./TurnSteps.tsx";
import { toWebHtml } from "./web-format.ts";
import { splitSteps, storedSteps, type TurnStep } from "../../../shared/turn-steps.ts";

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
  const branches = chatTree(root, sessions);
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
  const liveSteps = live.steps[session.id];
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
            <AnswerBody steps={turn.steps} omitted={turn.omittedSteps} wholeAnswer={turn.answerText} />
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
      {liveSteps !== undefined && (
        <div className="message answer">
          <LiveAnswerBody steps={liveSteps} />
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
        {(liveSteps !== undefined || pending !== null) && (
          <button onClick={() => runAction(() => api.stop(session.id))}>Stop</button>
        )}
        <button className="primary" disabled={busy || text.trim() === ""} onClick={() => void send()}>
          Send
        </button>
      </div>
    </section>
  );
}

/**
 * The badges of the steps before the last message, the last message in full, then the badges
 * of the steps after it. A new message in a running turn replaces the shown one, and the older
 * one becomes a badge. A turn stored before steps existed has none, so it shows its whole answer text.
 */
function AnswerBody({
  steps,
  omitted,
  wholeAnswer,
  live = false,
}: {
  readonly steps: readonly TurnStep[];
  readonly omitted: number;
  /** Every message in full. A badge keeps only 200 characters, so this is the way to read an earlier message. */
  readonly wholeAnswer: string;
  readonly live?: boolean;
}): ReactElement {
  const [showWhole, setShowWhole] = useState(false);
  const { before, lastMessage, after } = splitSteps(steps);
  const canShowWhole = lastMessage !== undefined && wholeAnswer !== lastMessage.text;
  const body = lastMessage === undefined || (canShowWhole && showWhole) ? wholeAnswer : lastMessage.text;
  // The steps not kept came first. With no badge before the message, the later row says how many there were.
  const omittedBefore = before.length > 0 ? omitted : 0;
  return (
    <>
      <StepRow steps={before} omitted={omittedBefore} noun={after.length > 0 ? "earlier step" : "step"} />
      {/* toWebHtml escapes all text and adds only its own tags, so the HTML is safe. */}
      <div
        className="answer-body"
        aria-live={live ? "polite" : undefined}
        dangerouslySetInnerHTML={{ __html: toWebHtml(body) }}
      />
      {canShowWhole && (
        <button className="whole-answer" onClick={() => setShowWhole((shown) => !shown)}>
          {showWhole ? "Show the last message only" : "Show the whole answer"}
        </button>
      )}
      <StepRow steps={after} omitted={omitted - omittedBefore} noun="later step" />
    </>
  );
}

/** A running turn keeps the same window of steps as a stored one, so both show the same badges. */
function LiveAnswerBody({ steps }: { readonly steps: readonly TurnStep[] }): ReactElement {
  // A keystroke in the composer renders the branch again, so compute this only when a step arrives.
  const shown = useMemo(() => storedSteps(steps), [steps]);
  const wholeAnswer = useMemo(
    () =>
      steps
        .filter((step) => step.kind === "message")
        .map((step) => step.text)
        .join("\n\n"),
    [steps],
  );
  return <AnswerBody steps={shown.steps} omitted={shown.omittedSteps} wholeAnswer={wholeAnswer} live />;
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

/** A chat and each of its forks, the chat first. */
export function chatTree(root: SessionRecord, sessions: readonly SessionRecord[]): SessionRecord[] {
  return [root, ...descendantsOf(root.id, sessions)];
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
