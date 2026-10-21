/**
 * A conversation as a tree: the chat and each of its forks in a column of its own, each with
 * its own composer. Eva's answers are cards with her visor beside them, with the steps folded
 * into one line, and Retry, Fork and Copy under each answer.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { api, type ChatBlocker, type SessionRecord } from "./api.ts";
import { ApprovalRequests, type ChatApprovals } from "./ApprovalCard.tsx";
import { approvalPlace } from "./approvals.ts";
import { tasksOfTurn } from "./chat-details.ts";
import { Composer, storedChoices } from "./Composer.tsx";
import {
  composerPlaceholder,
  elapsedText,
  foldSteps,
  liveFace,
  shownPending,
  type PendingMessage,
} from "./conversation-parts.ts";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import { stepsWithDraft, type LiveState } from "./live-state.ts";
import { runningCount, TasksDialog, tasksOf } from "./ChatPanel.tsx";
import { NewChatGreeting, NewChatSetup } from "./NewChatGreeting.tsx";
import { StepFold } from "./TurnSteps.tsx";
import { Visor } from "./Visor.tsx";
import { stateFaces, type Face } from "./visor-faces.ts";
import { RecordingShelf } from "./voice-notes.ts";
import { toWebHtml } from "./web-format.ts";
import { storedSteps, type TurnStep } from "../../../shared/turn-steps.ts";
import { describeUsageLimit, hasReset } from "../../../shared/usage-limit.ts";

/** Closer to the bottom than this counts as "at the bottom", so a new message scrolls into view. */
const stickToBottomPx = 80;
/** How long a Copy button says "Copied". */
const copiedMs = 2_000;
/** The voice notes of this tab, so a sent message can play what the person said. */
const recordings = new RecordingShelf((url) => URL.revokeObjectURL(url));

interface ConversationProps {
  readonly root: SessionRecord;
  readonly sessions: readonly SessionRecord[];
  readonly live: LiveState;
  readonly onChanged: () => Promise<void>;
  /** A branch shows its own requests, so a fork that waits shows the card in its own column. */
  readonly approvals: Pick<ChatApprovals, "pending" | "onAnswer">;
  /** The missing setup step that stops every chat, or null. */
  readonly blocker: ChatBlocker | null;
  /** The title of the project of a project chat. The message box addresses it, not Eva. */
  readonly projectTitle?: string | null;
  /** True when Eva's machine can turn a voice note into text. */
  readonly voiceNotes: boolean;
  /** The message that made a chat on the New chat page. It shows until the chat stores its turn. */
  readonly firstMessage?: SentMessage | null;
}

/** A message that the person sent and the chat has not stored yet. */
export interface SentMessage {
  readonly sessionId: string;
  readonly text: string;
}

export function Conversation({
  root,
  sessions,
  live,
  onChanged,
  approvals,
  blocker,
  voiceNotes,
  firstMessage = null,
  projectTitle = null,
}: ConversationProps): ReactElement {
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
          approvals={approvals}
          blocker={blocker}
          voiceNotes={voiceNotes}
          firstMessage={firstMessage?.sessionId === branch.id ? firstMessage.text : null}
          projectTitle={projectTitle}
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
  approvals,
  blocker,
  voiceNotes,
  firstMessage,
  projectTitle,
}: {
  session: SessionRecord;
  parent: SessionRecord | undefined;
  live: LiveState;
  onChanged: () => Promise<void>;
  approvals: ConversationProps["approvals"];
  blocker: ChatBlocker | null;
  voiceNotes: boolean;
  firstMessage: string | null;
  projectTitle: string | null;
}): ReactElement {
  const waiting = approvals.pending.filter((approval) => approval.sessionId === session.id);
  const turnCount = session.turns.length;
  // The New chat page sent this message before the chat opened here, so the chat starts with it.
  const [sent, setSent] = useState<PendingMessage | null>(
    firstMessage === null ? null : { text: firstMessage, turnCount: 0 },
  );
  /** The answer whose tasks the dialog shows, or "running" for the tasks of the running turn. */
  const [shownTasks, setShownTasks] = useState<number | "running" | null>(null);
  const closeTasks = useCallback(() => setShownTasks(null), []);
  const tasks = tasksOf(live.tasks, [session.id]);
  // The side panel hides on a phone, so a running task also shows here.
  const running = runningCount(tasks);
  const showError = useShowError();
  const pending = shownPending(sent, turnCount);
  const liveSteps = live.steps[session.id];
  /**
   * True once this send's turn sent a step. Its end removes the live steps before the list
   * brings the stored answer, so the working card must not come back in that gap.
   */
  const [sawLiveSteps, setSawLiveSteps] = useState(false);
  const working = liveSteps !== undefined || (pending !== null && !sawLiveSteps);
  const startedAt = useStartTime(working);

  // Only a new stored turn clears the message. The first render must keep the message of the New chat page.
  const storedTurns = useRef(turnCount);
  useEffect(() => {
    if (storedTurns.current === turnCount) return;
    storedTurns.current = turnCount;
    setSent(null);
  }, [turnCount]);
  useEffect(() => {
    if (liveSteps !== undefined) setSawLiveSteps(true);
  }, [liveSteps]);
  const usageLimit = live.usageLimits[session.id];
  const notes = live.notes[session.id] ?? [];
  const forkTurn = parent?.turns.findIndex((turn) => turn.lastMessageId === session.forkAtMessageId) ?? -1;

  const send = async (message: string, recording?: string): Promise<boolean> => {
    if (recording !== undefined) recordings.keep(session.id, message, recording);
    setSent({ text: message, turnCount });
    setSawLiveSteps(false);
    try {
      await api.send(session.id, message);
      return true;
    } catch (caught) {
      setSent(null);
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
          <UserMessage text={turn.userText} recording={recordings.find(session.id, turn.userText)} />
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
      {pending !== null && <UserMessage text={pending} recording={recordings.find(session.id, pending)} />}
      {working && (
        <LiveAnswer steps={liveSteps ?? []} draft={live.drafts[session.id]} mode={session.mode} startedAt={startedAt} />
      )}
      {waiting.length > 0 && (
        <ApprovalRequests approvals={waiting} place={approvalPlace(session)} onAnswer={approvals.onAnswer} />
      )}
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
      {parent === undefined &&
        turnCount === 0 &&
        pending === null &&
        !working &&
        (blocker !== null ? (
          // A project chat needs the engine and the vault too.
          <NewChatSetup blocker={blocker} />
        ) : (
          // The suggestions are Assistant work; a project chat stays a plain harness (AGENTS.md).
          session.mode === "assistant" && <NewChatGreeting onPick={(text) => void send(text)} />
        ))}
      <Composer
        session={session}
        choices={storedChoices(session.id)}
        running={working}
        onSend={send}
        onStop={() => runAction(() => api.stop(session.id))}
        onChanged={onChanged}
        blocker={blocker}
        voiceNotes={voiceNotes}
        placeholder={composerPlaceholder(projectTitle)}
      />
    </section>
  );
}

/**
 * The person's message. A voice note shows what Eva heard, since that is what she answers.
 * While this tab still holds the recording, a switch plays what the person said.
 */
function UserMessage({ text, recording }: { readonly text: string; readonly recording: string | null }): ReactElement {
  const [showRecording, setShowRecording] = useState(false);
  return (
    <div className="msg me">
      <div className="message user">
        <div className="who">You</div>
        {recording !== null && showRecording ? <audio className="voice-note" controls src={recording} /> : text}
        {recording !== null && (
          <div className="voice-switch" role="group" aria-label="Voice note">
            <button
              className={showRecording ? "" : "on"}
              aria-pressed={!showRecording}
              onClick={() => setShowRecording(false)}
            >
              Heard
            </button>
            <button
              className={showRecording ? "on" : ""}
              aria-pressed={showRecording}
              onClick={() => setShowRecording(true)}
            >
              <Icon name="mic" />
              Recording
            </button>
          </div>
        )}
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
  steps: liveSteps,
  draft,
  mode,
  startedAt,
}: {
  readonly steps: readonly TurnStep[];
  /** The block that the engine writes now. It shows as the last message until its final text comes. */
  readonly draft: string | undefined;
  readonly mode: SessionRecord["mode"];
  readonly startedAt: number;
}): ReactElement {
  const steps = useMemo(() => stepsWithDraft(liveSteps, draft), [liveSteps, draft]);
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
