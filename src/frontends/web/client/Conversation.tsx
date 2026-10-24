/**
 * A conversation as a tree, one branch at a time: the turns that the branch shares with its parents,
 * then its own, with a switcher at each answer that has a fork and a map of the tree beside them. Eva's answers are cards with her visor beside them, with the steps folded
 * into one line, and Retry, Fork and Copy under each answer.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { api, type ChatBlocker, type SessionRecord, type UndoPreview } from "./api.ts";
import { ApprovalRequests, type ChatApprovals } from "./ApprovalCard.tsx";
import { approvalPlace } from "./approvals.ts";
import {
  branchesAfter,
  branchesAtStart,
  branchNames,
  pathOf,
  stepKey,
  type BranchState,
  type PathStep,
} from "./branch-path.ts";
import { BranchMapColumn, BranchSwitcher, pickRow, useBranchStates, type ShownBranch } from "./Branches.tsx";
import { tasksOfTurn } from "./chat-details.ts";
import { Composer, storedChoices } from "./Composer.tsx";
import {
  composerPlaceholder,
  elapsedText,
  foldSteps,
  followsBottom,
  keptPending,
  snapsToBottom,
  liveFace,
  runningUntil,
  isWorking,
  sentTurnCount,
  turnEndNotice,
  undoQuestion,
  type PendingMessage,
} from "./conversation-parts.ts";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import { stepsWithDraft, type LiveState } from "./live-state.ts";
import { runningCount, TasksDialog, tasksOf } from "./ChatPanel.tsx";
import { NewChatGreeting, NewChatSetup } from "./NewChatGreeting.tsx";
import { RetryUndoDialog } from "./RetryUndoDialog.tsx";
import { StepFold } from "./TurnSteps.tsx";
import { Visor } from "./Visor.tsx";
import { stateFaces, type Face } from "./visor-faces.ts";
import { RecordingShelf } from "./voice-notes.ts";
import { toWebHtml } from "./web-format.ts";
import { storedSteps, type TurnStep } from "../../../shared/turn-steps.ts";
import { describeUsageLimit, hasReset } from "../../../shared/usage-limit.ts";

/** How long a Copy button says "Copied". */
const copiedMs = 2_000;
/** The voice notes of this tab, so a sent message can play what the person said. */
const recordings = new RecordingShelf((url) => URL.revokeObjectURL(url));

interface ConversationProps {
  readonly root: SessionRecord;
  readonly sessions: readonly SessionRecord[];
  /** The branch of the chat that the page shows, from `useShownBranch`. */
  readonly shown: ShownBranch;
  readonly live: LiveState;
  readonly onChanged: () => Promise<void>;
  /** The shown branch shows its own requests. The page gives a request of a hidden branch a notice. */
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
  shown,
  live,
  onChanged,
  approvals,
  blocker,
  voiceNotes,
  firstMessage = null,
  projectTitle = null,
}: ConversationProps): ReactElement {
  const tree = chatTree(root, sessions);
  const branch = tree.find((session) => session.id === shown.id) ?? root;
  const states = useBranchStates(tree, branch.id, approvals.pending, live);
  const scroller = useRef<HTMLDivElement>(null);
  // The view follows the newest message, until the person scrolls up to read.
  const isAtBottom = useRef(true);
  // Each render scrolls down while the view follows, so only a move up tells that the person reads.
  const lastScroll = useRef({ top: 0, height: 0 });
  // True while a finger is on the chat, so a render does not pull back its drag.
  const fingerDown = useRef(false);

  // A layout effect, so it runs before the scroll to a picked turn in the same commit.
  useLayoutEffect(() => {
    isAtBottom.current = true;
  }, [root.id, branch.id]);

  /**
   * Snaps a view that follows to the newest message, and keeps the place as the base of the next
   * scroll event. Shorter content pulls the view up, and its scroll event can come only after the
   * content grew again. The base must hold the pulled place, or that event looks like the person's.
   */
  const settle = useCallback((element: HTMLDivElement): void => {
    if (snapsToBottom(isAtBottom.current, fingerDown.current)) element.scrollTop = element.scrollHeight;
    lastScroll.current = { top: element.scrollTop, height: element.scrollHeight };
  }, []);

  useLayoutEffect(() => {
    if (scroller.current !== null) settle(scroller.current);
  });

  // A part of the chat can change its height with no render of this view, such as the message box.
  const hasMap = tree.length > 1;
  useEffect(() => {
    const element = scroller.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => settle(element));
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
  }, [settle, branch.id, hasMap]);

  // A pick brings its turn into view, after the branch of the pick renders. A pick from before
  // this view opened, such as on another page, is done.
  const handledFocus = useRef(shown.focus?.count ?? 0);
  useLayoutEffect(() => {
    if (shown.focus === null || shown.focus.count === handledFocus.current) return;
    handledFocus.current = shown.focus.count;
    const turn = scroller.current?.querySelector(`[data-turn="${CSS.escape(shown.focus.key)}"]`);
    if (turn === null || turn === undefined) return;
    isAtBottom.current = false;
    turn.scrollIntoView({ block: "start" });
  }, [shown.focus]);

  return (
    <div
      className="branches"
      ref={scroller}
      onScroll={(event) => {
        const element = event.currentTarget;
        isAtBottom.current = followsBottom(isAtBottom.current, lastScroll.current, {
          top: element.scrollTop,
          height: element.scrollHeight,
          visible: element.clientHeight,
        });
        lastScroll.current = { top: element.scrollTop, height: element.scrollHeight };
      }}
      onTouchStart={(event) => {
        // A drag in the message box moves no chat.
        const target = event.target;
        fingerDown.current = !(target instanceof Element && target.closest(".composer") !== null);
      }}
      onTouchEnd={() => {
        fingerDown.current = false;
      }}
      onTouchCancel={() => {
        fingerDown.current = false;
      }}
    >
      {tree.length > 1 && (
        <BranchMapColumn
          tree={tree}
          shownId={branch.id}
          states={states}
          onPick={(row) => pickRow(shown, branch.id, row)}
        />
      )}
      <Branch
        key={branch.id}
        session={branch}
        tree={tree}
        states={states}
        onShow={shown.show}
        live={live}
        onChanged={onChanged}
        approvals={approvals}
        blocker={blocker}
        voiceNotes={voiceNotes}
        firstMessage={firstMessage?.sessionId === branch.id ? firstMessage.text : null}
        projectTitle={projectTitle}
      />
    </div>
  );
}

function Branch({
  session,
  tree,
  states,
  onShow,
  live,
  onChanged,
  approvals,
  blocker,
  voiceNotes,
  firstMessage,
  projectTitle,
}: {
  session: SessionRecord;
  /** The chat and its forks, the chat first. */
  tree: readonly SessionRecord[];
  states: ReadonlyMap<string, BranchState>;
  onShow: ShownBranch["show"];
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
  const [sent, setSent] = useState<readonly PendingMessage[]>(
    firstMessage === null ? [] : [{ text: firstMessage, turnCount: 0 }],
  );
  /** The answer whose tasks the dialog shows, or "running" for the tasks of the running turn. */
  const [shownTasks, setShownTasks] = useState<PathStep<SessionRecord> | "running" | null>(null);
  /** The question before a retry that would undo file changes (#525), or null. */
  const [undoAsk, setUndoAsk] = useState<{
    readonly sessionId: string;
    readonly index: number;
    readonly title: string;
    readonly preview: UndoPreview;
  } | null>(null);
  const closeUndoAsk = useCallback(() => setUndoAsk(null), []);
  const path = pathOf(session, tree);
  const names = branchNames(tree);
  const start = branchesAtStart(session, tree);
  const closeTasks = useCallback(() => setShownTasks(null), []);
  const tasks = tasksOf(live.tasks, [session.id]);
  // The side panel hides on a phone, so a running task also shows here.
  const running = runningCount(tasks);
  const showError = useShowError();
  const pending = keptPending(sent, turnCount);
  const liveSteps = live.steps[session.id];
  const turnRuns = useTurnRuns(liveSteps !== undefined, turnCount);
  const working = isWorking({ live: liveSteps !== undefined, turnRuns, pending, turnCount });
  const startedAt = useStartTime(working);

  // Only the stored turn of a message clears it. A message sent during a turn outlives that turn.
  useEffect(() => {
    setSent((current) => {
      const kept = keptPending(current, turnCount);
      return kept.length === current.length ? current : kept;
    });
  }, [turnCount]);
  // The stored turn shows the answer, or why the turn failed, so the notice waits for it.
  const turnEnd = useTurnEndNotice(turnRuns);
  const usageLimit = live.usageLimits[session.id];
  const notes = live.notes[session.id] ?? [];

  const send = async (message: string, recording?: string): Promise<boolean> => {
    if (recording !== undefined) recordings.keep(session.id, message, recording);
    const entry = { text: message, turnCount: sentTurnCount(turnCount, turnRuns) };
    setSent((current) => [...current, entry]);
    try {
      await api.send(session.id, message);
      return true;
    } catch (caught) {
      setSent((current) => current.filter((candidate) => candidate !== entry));
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

  /**
   * A retry of an Assistant answer that changed files asks first whether to undo them (#525).
   * A Project chat runs in its own clone, so its retry never asks.
   */
  const retryAnswer = (owner: SessionRecord, index: number): void => {
    runAction(async () => {
      const preview = owner.mode === "assistant" ? await api.retryUndo(owner.id, index) : null;
      const title = preview === null ? null : undoQuestion(preview);
      if (preview === null || title === null) await api.retry(owner.id, index);
      else setUndoAsk({ sessionId: owner.id, index, title, preview });
    });
  };

  const retryAfterQuestion = async (undo: boolean): Promise<void> => {
    if (undoAsk === null) return;
    try {
      await api.retry(undoAsk.sessionId, undoAsk.index, undo);
      setUndoAsk(null);
      await onChanged();
    } catch (caught) {
      // A failed undo starts no retry. The question closes, so the person sees why.
      setUndoAsk(null);
      showError(caught);
    }
  };

  return (
    <section className="branch" aria-label={`Branch ${session.title}`}>
      {start !== null && (
        <BranchSwitcher point={start} names={names} states={states} label="Branches from the start" onShow={onShow} />
      )}
      {path.map((step, position) => {
        const { turn, index } = step;
        const owner = step.session;
        const point = branchesAfter(path, position, session, tree);
        return (
          <div key={stepKey(owner.id, index)} style={{ display: "contents" }}>
            <UserMessage
              text={turn.userText}
              recording={recordings.find(owner.id, turn.userText)}
              turnKey={stepKey(owner.id, index)}
            />
            <EvaMessage face={stateFaces.idle}>
              <AnswerBody
                steps={turn.steps}
                sessionId={owner.id}
                omitted={turn.omittedSteps}
                wholeAnswer={turn.answerText}
                summary={activityOf(turn)}
                actions={(shown) => (
                  <div className="answer-actions">
                    {turn.taskCount > 0 && (
                      <button className="ghost" onClick={() => setShownTasks(step)}>
                        <Icon name="sync" />
                        {counted(turn.taskCount, "background task")}
                      </button>
                    )}
                    {/* A closed chat takes no new turn, so it offers no way to start one. */}
                    {!owner.closed && (
                      <button className="ghost" onClick={() => retryAnswer(owner, index)}>
                        <Icon name="restart" />
                        Retry
                      </button>
                    )}
                    {!owner.closed && turn.lastMessageId !== null && turn.failure === null && (
                      <button
                        className="ghost"
                        onClick={() => runAction(() => api.fork(owner.id, turn.lastMessageId ?? ""))}
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
            <TurnNotes notes={turn.notes} />
            {point !== null && (
              <BranchSwitcher
                point={point}
                names={names}
                states={states}
                label={`Branches after answer ${String(position + 1)}`}
                // The page keeps the fork point in view, so the person sees what changed below it.
                onShow={(id) => onShow(id, stepKey(owner.id, index))}
              />
            )}
          </div>
        );
      })}
      {pending
        .filter((message) => message.turnCount === turnCount)
        .map((message, index) => (
          <UserMessage
            key={`sent-${String(index)}`}
            text={message.text}
            recording={recordings.find(session.id, message.text)}
          />
        ))}
      {/* A live region on the streaming text would read the whole answer again at each token. */}
      <span className="visually-hidden" role="status">
        {turnEnd}
      </span>
      {working && (
        <LiveAnswer steps={liveSteps ?? []} draft={live.drafts[session.id]} mode={session.mode} startedAt={startedAt} />
      )}
      {/* A message sent during a turn waits for that turn to end, so it shows below the running answer. */}
      {pending
        .filter((message) => message.turnCount > turnCount)
        .map((message, index) => (
          <UserMessage
            key={`queued-${String(index)}`}
            text={message.text}
            recording={recordings.find(session.id, message.text)}
          />
        ))}
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
      {shownTasks !== null && shownTasks !== "running" && (
        <TasksDialog
          tasks={tasksOfTurn(shownTasks.turn.steps, shownTasks.session.id)}
          total={shownTasks.turn.taskCount}
          // An older answer comes with no steps, to keep the session list small.
          empty="Eva no longer keeps the details of these tasks."
          onClose={closeTasks}
        />
      )}
      {undoAsk !== null && (
        <RetryUndoDialog
          title={undoAsk.title}
          preview={undoAsk.preview}
          onRetry={retryAfterQuestion}
          onClose={closeUndoAsk}
        />
      )}
      <TurnNotes notes={notes} live />
      {usageLimit !== undefined && !hasReset(usageLimit, new Date()) && (
        <div className={`usage-limit ${usageLimit.status}`} role="status">
          {describeUsageLimit(usageLimit, new Date())}
        </div>
      )}
      {session.parentId === null &&
        turnCount === 0 &&
        pending.length === 0 &&
        !working &&
        (blocker !== null ? (
          // A project chat needs the engine and the vault too.
          <NewChatSetup blocker={blocker} />
        ) : (
          // The suggestions are Assistant work; a project chat stays a plain harness (AGENTS.md).
          session.mode === "assistant" && <NewChatGreeting onPick={(text) => void send(text)} />
        ))}
      {session.closed ? (
        // Eva reused the clone of this chat for a new chat (issue 521), so a message here would run on other work.
        <div className="callout" role="status">
          Eva closed this chat to reuse its clone. You can read it, but it takes no new message. Start a new chat in the
          project to go on.
        </div>
      ) : (
        <Composer
          session={session}
          draftKey={session.id}
          choices={storedChoices(session.id)}
          running={working}
          onSend={send}
          onStop={() => runAction(() => api.stop(session.id))}
          onChanged={onChanged}
          blocker={blocker}
          voiceNotes={voiceNotes}
          placeholder={composerPlaceholder(projectTitle)}
        />
      )}
    </section>
  );
}

/**
 * The person's message. A voice note shows what Eva heard, since that is what she answers.
 * While this tab still holds the recording, a switch plays what the person said.
 */
function UserMessage({
  text,
  recording,
  turnKey,
}: {
  readonly text: string;
  readonly recording: string | null;
  /** The key of its turn, so a pick in the branch map can scroll to it. */
  readonly turnKey?: string;
}): ReactElement {
  const [showRecording, setShowRecording] = useState(false);
  return (
    <div className="msg me" data-turn={turnKey}>
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

/**
 * The notes of a turn, such as an MCP server that did not start, apart from its answer (issue 157).
 * Only a running turn's notes are a live region, so a reload does not read out every old note.
 */
function TurnNotes({
  notes,
  live = false,
}: {
  readonly notes: readonly string[];
  readonly live?: boolean;
}): ReactElement {
  return (
    <>
      {notes.map((note, index) => (
        <div key={`note-${String(index)}`} className="turn-note" {...(live ? { role: "status" } : {})}>
          {note}
        </div>
      ))}
    </>
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
  sessionId,
  omitted,
  wholeAnswer,
  summary,
  live = false,
  actions,
  failure = null,
}: {
  readonly steps: readonly TurnStep[];
  readonly omitted: number;
  /** The chat of a stored answer, so a step's dialog can fetch its details. */
  readonly sessionId?: string;
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
  // Each streamed token and each clock tick render every answer, so parse only a changed text.
  const html = useMemo(() => toWebHtml(body), [body]);
  return (
    <>
      <StepFold
        steps={listed}
        omitted={omitted}
        live={live}
        {...(summary === undefined ? {} : { summary })}
        {...(sessionId === undefined ? {} : { sessionId })}
      />
      {body !== "" && (
        // toWebHtml escapes all text and adds only its own tags, so the HTML is safe.
        <div className="answer-body" dangerouslySetInnerHTML={{ __html: html }} />
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

/** The words that a screen reader says once when a turn ends, or "". */
function useTurnEndNotice(turnRunning: boolean): string {
  const [notice, setNotice] = useState("");
  const wasRunning = useRef(turnRunning);
  useEffect(() => {
    const was = wasRunning.current;
    wasRunning.current = turnRunning;
    setNotice((current) => turnEndNotice(was, turnRunning, current));
  }, [turnRunning]);
  return notice;
}

/** True from the start of a turn until its stored turn arrives. */
function useTurnRuns(liveRunning: boolean, turnCount: number): boolean {
  const [state, setState] = useState(() => ({
    until: runningUntil(null, false, liveRunning, turnCount),
    wasLive: liveRunning,
  }));
  const until = runningUntil(state.until, state.wasLive, liveRunning, turnCount);
  // Set during the render, so a send in this frame already sees the new state.
  if (until !== state.until || liveRunning !== state.wasLive) setState({ until, wasLive: liveRunning });
  return until !== null;
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

/** The first chat of a fork's line, found through the parents that the list still has. */
export function rootIdOf(chat: SessionRecord, sessions: readonly SessionRecord[]): string {
  let current = chat;
  const seen = new Set<string>();
  while (current.parentId !== null && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = sessions.find((candidate) => candidate.id === current.parentId);
    if (parent === undefined) break;
    current = parent;
  }
  return current.id;
}

/** The chats that start a tree: no parent, newest first. */
export function rootChats(sessions: readonly SessionRecord[]): SessionRecord[] {
  return sessions
    .filter((session) => session.parentId === null)
    .sort((first, second) =>
      (second.lastTurnAt ?? second.createdAt).localeCompare(first.lastTurnAt ?? first.createdAt),
    );
}
