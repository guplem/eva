/**
 * A conversation as a tree: the chat and each of its forks in a column of its own, each with
 * its own composer. Eva's answers are cards with her visor beside them, with the steps folded
 * into one line, and Retry, Fork and Copy under each answer.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { api, type SessionRecord } from "./api.ts";
import { tasksOfTurn } from "./chat-details.ts";
import { Composer } from "./Composer.tsx";
import { elapsedText, foldSteps, liveFace } from "./conversation-parts.ts";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import type { LiveState } from "./live-state.ts";
import { runningCount, TasksDialog, tasksOf } from "./ChatPanel.tsx";
import { StepFold } from "./TurnSteps.tsx";
import { Visor } from "./Visor.tsx";
import { stateFaces, type Face } from "./visor-faces.ts";
import { toWebHtml } from "./web-format.ts";
import { storedSteps, type TurnStep } from "../../../shared/turn-steps.ts";
import { describeUsageLimit, hasReset } from "../../../shared/usage-limit.ts";

/** Closer to the bottom than this counts as "at the bottom", so a new message scrolls into view. */
const stickToBottomPx = 80;
/** How long a Copy button says "Copied". */
const copiedMs = 2_000;

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
  const [pending, setPending] = useState<string | null>(null);
  /** The answer whose tasks the dialog shows, or "running" for the tasks of the running turn. */
  const [shownTasks, setShownTasks] = useState<number | "running" | null>(null);
  const closeTasks = useCallback(() => setShownTasks(null), []);
  const tasks = tasksOf(live.tasks, [session.id]);
  // The side panel hides on a phone, so a running task also shows here.
  const running = runningCount(tasks);
  const showError = useShowError();
  const turnCount = session.turns.length;
  const liveSteps = live.steps[session.id];
  /**
   * True once this send's turn sent a step. Its end removes the live steps before the list
   * brings the stored answer, so the working card must not come back in that gap.
   */
  const [sawLiveSteps, setSawLiveSteps] = useState(false);
  const working = liveSteps !== undefined || (pending !== null && !sawLiveSteps);
  const startedAt = useStartTime(working);

  useEffect(() => {
    setPending(null);
  }, [turnCount]);
  useEffect(() => {
    if (liveSteps !== undefined) setSawLiveSteps(true);
  }, [liveSteps]);
  const usageLimit = live.usageLimits[session.id];
  const notes = live.notes[session.id] ?? [];
  const forkTurn = parent?.turns.findIndex((turn) => turn.lastMessageId === session.forkAtMessageId) ?? -1;

  const send = async (message: string): Promise<boolean> => {
    setPending(message);
    setSawLiveSteps(false);
    try {
      await api.send(session.id, message);
      return true;
    } catch (caught) {
      setPending(null);
      showError(caught);
      return false;
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
          <Icon name="fork" />
          Branch after answer {forkTurn + 1} of “{parent.title}”
        </div>
      )}
      {session.turns.map((turn, index) => (
        <div key={`${session.id}-${String(index)}`} style={{ display: "contents" }}>
          <UserMessage text={turn.userText} />
          <EvaMessage face={stateFaces.idle}>
            <AnswerBody
              steps={turn.steps}
              omitted={turn.omittedSteps}
              wholeAnswer={turn.answerText}
              summary={activityOf(turn)}
              actions={(shown) => (
                <div className="answer-actions">
                  {turn.taskCount > 0 && (
                    <button className="ghost" onClick={() => setShownTasks(index)}>
                      <Icon name="sync" />
                      {counted(turn.taskCount, "background task")}
                    </button>
                  )}
                  <button className="ghost" onClick={() => runAction(() => api.retry(session.id, index))}>
                    <Icon name="restart" />
                    Retry
                  </button>
                  {turn.lastMessageId !== null && turn.failure === null && (
                    <button
                      className="ghost"
                      onClick={() => runAction(() => api.fork(session.id, turn.lastMessageId ?? ""))}
                    >
                      <Icon name="fork" />
                      Fork
                    </button>
                  )}
                  {shown !== "" && <CopyButton text={shown} />}
                </div>
              )}
              failure={turn.failure}
            />
          </EvaMessage>
        </div>
      ))}
      {pending !== null && <UserMessage text={pending} />}
      {working && <LiveAnswer steps={liveSteps ?? []} mode={session.mode} startedAt={startedAt} />}
      {running > 0 && (
        <button className="running-tasks ghost" onClick={() => setShownTasks("running")}>
          <Icon name="sync" />
          {counted(running, "background task")} running
        </button>
      )}
      {shownTasks === "running" && <TasksDialog tasks={tasks} empty="No task runs now." onClose={closeTasks} />}
      {typeof shownTasks === "number" && (
        <TasksDialog
          tasks={tasksOfTurn(session.turns[shownTasks]?.steps ?? [], session.id)}
          total={session.turns[shownTasks]?.taskCount ?? 0}
          // An older answer comes with no steps, to keep the session list small.
          empty="Eva no longer keeps the details of these tasks."
          onClose={closeTasks}
        />
      )}
      {notes.map((note, index) => (
        <div key={`note-${String(index)}`} className="turn-note" role="status">
          {note}
        </div>
      ))}
      {usageLimit !== undefined && !hasReset(usageLimit, new Date()) && (
        <div className={`usage-limit ${usageLimit.status}`} role="status">
          {describeUsageLimit(usageLimit, new Date())}
        </div>
      )}
      <Composer
        session={session}
        running={working}
        onSend={send}
        onStop={() => runAction(() => api.stop(session.id))}
        onChanged={onChanged}
      />
    </section>
  );
}

function UserMessage({ text }: { readonly text: string }): ReactElement {
  return (
    <div className="msg me">
      <div className="message user">
        <div className="who">You</div>
        {text}
      </div>
    </div>
  );
}

/** Eva's card, with her visor at its side. A phone hides the visor to keep the width. */
function EvaMessage({
  face,
  children,
}: {
  readonly face: Face;
  readonly children: ReactElement[] | ReactElement;
}): ReactElement {
  return (
    <div className="msg">
      <Visor size={28} face={face} />
      <div className="message answer">{children}</div>
    </div>
  );
}

/**
 * The folded steps, the last message in full, and the actions. A new message in a running turn
 * replaces the shown one, and the older one becomes a line of the steps. A turn stored before
 * steps existed has none, so it shows its whole answer text.
 */
function AnswerBody({
  steps,
  omitted,
  wholeAnswer,
  summary,
  live = false,
  actions,
  failure = null,
}: {
  readonly steps: readonly TurnStep[];
  readonly omitted: number;
  /** Every message in full. A step keeps only 200 characters, so this is the way to read an earlier message. */
  readonly wholeAnswer: string;
  readonly summary?: string;
  readonly live?: boolean;
  /** The buttons under the answer, given the text that the card shows. */
  readonly actions?: (shownText: string) => ReactElement;
  /** Why the turn failed, or null. */
  readonly failure?: string | null;
}): ReactElement {
  const [showWhole, setShowWhole] = useState(false);
  const { listed, lastMessage } = foldSteps(steps);
  const canShowWhole = lastMessage !== undefined && wholeAnswer !== lastMessage.text;
  const body = lastMessage === undefined || (canShowWhole && showWhole) ? wholeAnswer : lastMessage.text;
  return (
    <>
      <StepFold steps={listed} omitted={omitted} live={live} {...(summary === undefined ? {} : { summary })} />
      {body !== "" && (
        // toWebHtml escapes all text and adds only its own tags, so the HTML is safe.
        <div
          className="answer-body"
          aria-live={live ? "polite" : undefined}
          dangerouslySetInnerHTML={{ __html: toWebHtml(body) }}
        />
      )}
      {canShowWhole && (
        <button className="whole-answer ghost" onClick={() => setShowWhole((shown) => !shown)}>
          {showWhole ? "Show the last message only" : "Show the whole answer"}
        </button>
      )}
      {failure !== null && <div className="failed">The turn failed: {failure}</div>}
      {actions?.(body)}
    </>
  );
}

/** A running turn keeps the same window of steps as a stored one, so both show the same lines. */
function LiveAnswer({
  steps,
  mode,
  startedAt,
}: {
  readonly steps: readonly TurnStep[];
  readonly mode: SessionRecord["mode"];
  readonly startedAt: number;
}): ReactElement {
  // A tick of the clock renders the branch again, so compute this only when a step arrives.
  const shown = useMemo(() => storedSteps(steps), [steps]);
  const wholeAnswer = useMemo(
    () =>
      steps
        .filter((step) => step.kind === "message")
        .map((step) => step.text)
        .join("\n\n"),
    [steps],
  );
  const hasText = steps.some((step) => step.kind === "message");
  return (
    <EvaMessage face={liveFace(hasText, mode)}>
      <AnswerBody steps={shown.steps} omitted={shown.omittedSteps} wholeAnswer={wholeAnswer} live />
      <div className="working">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        Working · {elapsedText(Date.now() - startedAt)}
      </div>
    </EvaMessage>
  );
}

/** When the page first saw the running turn, with a render each second while it runs. */
function useStartTime(running: boolean): number {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  // Set during the render, so the first frame of a turn never shows the time of an older one.
  if (running && startedAt === null) setStartedAt(Date.now());
  if (!running && startedAt !== null) setStartedAt(null);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick((tick) => tick + 1), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  return startedAt ?? Date.now();
}

function CopyButton({ text }: { readonly text: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const showError = useShowError();
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), copiedMs);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      className="ghost"
      onClick={() => {
        copyText(text)
          .then(() => setCopied(true))
          .catch((caught: unknown) => showError(caught));
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** The Clipboard API needs a secure page. A page over plain HTTP uses a hidden text box instead. */
async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && "clipboard" in navigator) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only way to copy on a page that is not secure.
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("This browser cannot copy here. Select the text and copy it.");
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
