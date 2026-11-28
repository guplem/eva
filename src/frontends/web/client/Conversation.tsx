/**
 * A conversation as a tree, one branch at a time: the turns that the branch shares with its parents,
 * then its own, with a switcher at each answer that has a fork and a map of the tree beside them. Eva's answers are cards with her visor beside them, with the steps folded
 * into one line, and Retry, Fork and Copy under each answer.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { api, type ChatBlocker, type OpenedSession, type SessionRecord } from "./api.ts";
import { answerActions } from "./answer-actions.ts";
import { useAnswerActions, type AnswerActions } from "./AnswerActions.tsx";
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
import { forkedFromText, historyNotice } from "./branch-choices.ts";
import { BranchMapColumn, BranchSwitcher, pickRow, useBranchStates, type ShownBranch } from "./Branches.tsx";
import { endedProjectWork, tasksOfTurn, tasksStillRun } from "./chat-details.ts";
import { Composer, storedChoices, unsentTexts } from "./Composer.tsx";
import { FullChatNotice } from "./FullChatNotice.tsx";
import { isGliding, markFollowing } from "./send-glide.ts";
import { answerKey, noteShown, sentKey, takeShown } from "./shown-messages.ts";
import {
  answerFiles,
  wholeMessages,
  composerPlaceholder,
  elapsedText,
  foldSteps,
  followsBottom,
  keptPending,
  newMessageId,
  notInTurn,
  runningMessages,
  snapsToBottom,
  liveFace,
  runningUntil,
  isWorking,
  heldSteps,
  senderName,
  sentTurnCount,
  turnEndNotice,
  deliveryWords,
  shownOutbox,
  type PendingMessage,
} from "./conversation-parts.ts";
import type { OutboxState } from "./outbox.ts";
import { outbox, useOutbox } from "./page-outbox.ts";
import { CopyButton } from "./CopyButton.tsx";
import { DownloadButton } from "./DownloadButton.tsx";
import { PageFrame } from "./PageFrame.tsx";
import { answerPages } from "./page-frames.ts";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import { MarkdownBody } from "./MarkdownBody.tsx";
import type { ContextMenuProps } from "./Menu.tsx";
import { useMessageMenu } from "./MessageMenu.tsx";
import { stepsWithDraft, type LiveState } from "./live-state.ts";
import { runningCount, TasksDialog, tasksOf } from "./ChatPanel.tsx";
import { NewChatGreeting, NewChatSetup } from "./NewChatGreeting.tsx";
import { StepFold } from "./TurnSteps.tsx";
import { Visor } from "./Visor.tsx";
import { stateFaces, type Face } from "./visor-faces.ts";
import { toWebHtml } from "./web-format.ts";
import { shownAnswerText } from "../../../shared/file-markers.ts";
import {
  personWords,
  reportHasMore,
  reportHeadline,
  reportPlace,
  reportPreview,
  reportResultText,
  type ProjectReport,
  type TurnWords,
} from "../../../shared/project-report.ts";
import { storedSteps, type TurnStep } from "../../../shared/turn-steps.ts";
import { describeUsageLimit, hasReset } from "../../../shared/usage-limit.ts";
import { displayFormat } from "./display-format.ts";

interface ConversationProps {
  readonly root: OpenedSession;
  /** The chat and its forks with their turns, from `useOpenedTree`, the chat first. */
  readonly tree: readonly OpenedSession[];
  /** The chat list, which names the chat that this chat came from. */
  readonly sessions: readonly Pick<SessionRecord, "id" | "title">[];
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
}

export function Conversation({
  root,
  tree,
  sessions,
  shown,
  live,
  onChanged,
  approvals,
  blocker,
  voiceNotes,
  projectTitle = null,
}: ConversationProps): ReactElement {
  const branch = tree.find((session) => session.id === shown.id) ?? root;
  const states = useBranchStates(tree, branch.id, approvals.pending, live);
  const answers = useAnswerActions(onChanged, `${root.id} ${branch.id}`);
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
    // A send's glide takes the chat down smoothly, so a snap here would undo it.
    if (snapsToBottom(isAtBottom.current, fingerDown.current) && !isGliding(element)) {
      element.scrollTop = element.scrollHeight;
    }
    lastScroll.current = { top: element.scrollTop, height: element.scrollHeight };
    markFollowing(element, isAtBottom.current);
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
        markFollowing(element, isAtBottom.current);
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
          answers={answers}
        />
      )}
      {answers.parts}
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
        projectTitle={projectTitle}
        forkedFrom={forkedFromNote(root, sessions)}
        answers={answers}
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
  projectTitle,
  forkedFrom,
  answers,
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
  projectTitle: string | null;
  /** The note of a chat that came from another clone, with the chat to link, or null. */
  forkedFrom: { readonly text: string; readonly chatId: string | null } | null;
  /** Retry and Fork of an answer. The branch map shares them, so the view draws their questions. */
  answers: AnswerActions;
}): ReactElement {
  const waiting = approvals.pending.filter((approval) => approval.sessionId === session.id);
  const turnCount = session.turns.length;
  // A task of project work ends when its result comes back to this chat or a fork of it.
  const endedWork = useMemo(() => endedProjectWork(tree.flatMap((chat) => chat.turns)), [tree]);
  // The page's outbox keeps each sent message, also the first one of the New chat page (#945).
  const sent = useOutbox(session.id);
  /** The answer whose tasks the dialog shows, or "running" for the tasks of the running turn. */
  const [shownTasks, setShownTasks] = useState<PathStep<SessionRecord> | "running" | null>(null);
  const path = pathOf(session, tree);
  const names = branchNames(tree);
  const start = branchesAtStart(session, tree);
  const closeTasks = useCallback(() => setShownTasks(null), []);
  const historyNote = historyNotice(session);
  const tasks = tasksOf(live.tasks, [session.id]);
  // The side panel hides on a phone, so a running task also shows here.
  const running = runningCount(tasks);
  const showError = useShowError();
  const liveSteps = live.steps[session.id];
  const turnRuns = useTurnRuns(liveSteps !== undefined, turnCount);
  const nextTurnCount = sentTurnCount(turnCount, turnRuns);
  const pending = keptPending(shownOutbox(sent, nextTurnCount), turnCount);
  const working = isWorking({ live: liveSteps !== undefined, turnRuns, pending, turnCount });
  const draft = live.drafts[session.id];
  const ended = live.endedSteps[session.id] ?? null;
  // Each tick of the clock renders the branch again, so join the draft only when a step or a piece arrives.
  const answerSteps = useMemo(
    () => heldSteps(ended, liveSteps === undefined ? undefined : stepsWithDraft(liveSteps, draft), turnRuns),
    [ended, liveSteps, draft, turnRuns],
  );
  // The core says what the running turn shows, so a message that another sender sent shows too (#804).
  const turnMessages = runningMessages(live.messages[session.id], turnCount, {
    live: liveSteps !== undefined,
    turnRuns,
  });
  const ownPending = notInTurn(pending, turnMessages);
  const startedAt = useStartTime(working);

  // Only the stored turn of a message clears it. A message sent during a turn outlives that turn.
  useEffect(() => {
    outbox.forget(session.id, turnCount);
  }, [session.id, turnCount]);
  // A message that Eva took when the network came back waits beyond the turns that ended meanwhile.
  useEffect(() => {
    outbox.noteTurnCount(session.id, nextTurnCount);
  }, [session.id, nextTurnCount]);
  // A turn that holds a message's id confirms it, even when the answer of its send got lost.
  const startedTurns = live.messages[session.id];
  useEffect(() => {
    if (startedTurns !== undefined) outbox.confirm(session.id, startedTurns);
  }, [session.id, startedTurns]);
  // The stored turn shows the answer, or why the turn failed, so the notice waits for it.
  const turnEnd = useTurnEndNotice(turnRuns);
  const usageLimit = live.usageLimits[session.id];
  const notes = live.notes[session.id] ?? [];

  // The outbox sends the message, and tries again on a bad connection. So the box clears at once.
  const send = (message: string): Promise<boolean> => {
    outbox.add({ sessionId: session.id, text: message, id: newMessageId(), turnCount: nextTurnCount });
    return Promise.resolve(true);
  };

  /** Puts the text of an unsent message back in the box, so the person changes it. */
  const editUnsent = (id: string): void => {
    const removed = outbox.remove(id);
    if (removed !== undefined) unsentTexts.restore(session.id, removed.text);
  };

  /** Runs an action on the branch, and shows its failure. */
  const runAction = (action: () => Promise<unknown>): void => {
    action()
      .then(onChanged)
      .catch((caught: unknown) => {
        showError(caught);
      });
  };

  return (
    <section className="branch" aria-label={`Branch ${session.title}`}>
      {forkedFrom !== null && (
        // A chat from another clone shows none of its parent's turns, so the note says where they are.
        <p className="field-hint forked-from">
          {forkedFrom.chatId === null ? (
            forkedFrom.text
          ) : (
            <a href={`#/chat/${encodeURIComponent(forkedFrom.chatId)}`}>{forkedFrom.text}</a>
          )}
        </p>
      )}
      {historyNote !== null && (
        <div className="callout" role="status">
          {historyNote}
        </div>
      )}
      {start !== null && (
        <BranchSwitcher point={start} names={names} states={states} label="Branches from the start" onShow={onShow} />
      )}
      {path.map((step, position) => {
        const { turn, index } = step;
        const owner = step.session;
        const point = branchesAfter(path, position, session, tree);
        return (
          <div key={stepKey(owner.id, index)} style={{ display: "contents" }}>
            <TurnWordsView turn={turn} turnKey={stepKey(owner.id, index)} />
            <StoredAnswer
              owner={owner}
              turn={turn}
              endedWork={endedWork}
              onShowTasks={() => setShownTasks(step)}
              onRetry={() => answers.retry(owner, index)}
              onFork={() => answers.fork(owner, index)}
            />
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
      {ownPending
        .filter((message) => message.turnCount === turnCount)
        .map((message, index) => (
          <UserMessage
            key={message.id ?? `sent-${String(index)}`}
            text={message.text}
            delivery={deliveryOf(message, editUnsent)}
          />
        ))}
      {/* As its stored turn will show it, so nothing changes at the turn end. */}
      {turnMessages.map((message) => (
        <TurnWordsView key={`running-${String(message.turnIndex)}`} turn={message} turnKey={undefined} />
      ))}
      {/* A live region on the streaming text would read the whole answer again at each token. */}
      <span className="visually-hidden" role="status">
        {turnEnd}
      </span>
      {/* After the turn ends, its answer stays without the clock until the stored turn takes its place. */}
      {(working || answerSteps !== null) && (
        <LiveAnswer
          sessionId={session.id}
          turnCount={turnCount}
          steps={answerSteps ?? []}
          mode={session.mode}
          startedAt={working ? startedAt : null}
        />
      )}
      {/* A message sent during a turn waits for that turn to end, so it shows below the running answer. */}
      {ownPending
        .filter((message) => message.turnCount > turnCount)
        .map((message, index) => (
          <UserMessage
            key={message.id ?? `queued-${String(index)}`}
            text={message.text}
            delivery={deliveryOf(message, editUnsent)}
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
          tasks={tasksOfTurn(shownTasks.turn.steps, shownTasks.session.id, endedWork)}
          total={shownTasks.turn.taskCount}
          // The chat details show only the tasks that run now, so this list says why its tasks ended.
          note="This answer started these tasks, such as a subagent, a long command or a Project chat. Only a Project chat keeps running after the answer."
          // An older answer comes with no steps, to keep the session list small.
          empty="Eva no longer keeps the details of these tasks."
          onClose={closeTasks}
        />
      )}
      <TurnNotes notes={notes} live />
      {usageLimit !== undefined && !hasReset(usageLimit, new Date()) && (
        <div className={`usage-limit ${usageLimit.status}`} role="status">
          {describeUsageLimit(usageLimit, new Date(), undefined, displayFormat().clock)}
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
      {/* A closed chat takes no message, and its own callout already says what to do. */}
      {!session.closed && (
        <FullChatNotice sessionId={session.id} turns={path.map((step) => step.turn)} onChanged={onChanged} />
      )}
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
 * Who wrote the message of a turn, and what: a card for each project work result, and the person's
 * words. A running turn shows its message with it too. Without `turnKey`, the branch map cannot scroll to it.
 */
function TurnWordsView({
  turn,
  turnKey,
}: {
  readonly turn: TurnWords;
  readonly turnKey: string | undefined;
}): ReactElement {
  const words = personWords(turn);
  return (
    <>
      {/* A project work result shows as a card of the Project side, not as a message of the person. */}
      {turn.projectReports?.map((report) => (
        <ProjectReportCard
          key={report.projectSessionId}
          report={report}
          turnKey={words === null ? turnKey : undefined}
        />
      ))}
      {words !== null && <UserMessage text={words} fromEva={turn.fromEva === true} turnKey={turnKey} />}
    </>
  );
}

/** Where a sent message is on its way to Eva, with the person's actions on an unsent one (#945). */
interface Delivery {
  readonly state: Exclude<OutboxState, "sent">;
  readonly reason: string | null;
  /** True once a try failed. A first try shows its state only when it is slow. */
  readonly retried: boolean;
  readonly onRetry: () => void;
  readonly onEdit: () => void;
}

function deliveryOf(message: PendingMessage, onEdit: (id: string) => void): Delivery | null {
  const { id, state } = message;
  if (id === undefined || state === undefined || state === "sent") return null;
  return {
    state,
    reason: message.reason ?? null,
    retried: message.retried ?? false,
    onRetry: () => outbox.retry(id),
    onEdit: () => onEdit(id),
  };
}

/** The person's message. A voice note is text too: the person read and fixed it in the box. */
export function UserMessage({
  text,
  fromEva = false,
  turnKey,
  delivery = null,
}: {
  readonly text: string;
  /** Eva sent it, such as a project work result. */
  readonly fromEva?: boolean;
  /** The key of its turn, so a pick in the branch map can scroll to it. */
  readonly turnKey?: string | undefined;
  /** The state of a message that Eva does not have yet, or null. */
  readonly delivery?: Delivery | null;
}): ReactElement {
  const { props, parts } = useMessageMenu(text, fromEva ? "Actions of Eva's message" : "Actions of your message");
  // A sent message gets a new bubble up to three times: on the chat's own page, in the running turn, and in the stored
  // turn. The person saw it already, so each new bubble takes the place of the last one with no fade (#1053).
  const [settled] = useState(() => takeShown(sentKey(text)));
  // Only a stored turn has a key. A bubble without one waits for the bubble that takes its place.
  const waits = turnKey === undefined;
  useEffect(() => {
    if (waits) noteShown(sentKey(text));
  }, [waits, text]);
  return (
    <div className={`msg me${delivery === null ? "" : ` ${delivery.state}`}`} data-turn={turnKey}>
      {parts}
      {/* The menu key and Shift+F10 open the menu, so a keyboard reaches Copy too. */}
      <div className={`message user${settled ? " settled" : ""}`} tabIndex={0} {...props}>
        <div className="who">{senderName(fromEva)}</div>
        {text}
      </div>
      {delivery !== null && <DeliveryLine delivery={delivery} />}
    </div>
  );
}

/** The state line under an unsent message. The state shows with an icon and a word, not with colour alone. */
function DeliveryLine({ delivery }: { readonly delivery: Delivery }): ReactElement {
  const { state, reason } = delivery;
  return (
    <div className={`delivery ${state}${delivery.retried ? "" : " first-try"}`} role="status">
      <Icon name={state === "sending" ? "clock" : "alert"} />
      <span>{deliveryWords(state, reason)}</span>
      {state === "failed" && (
        <span className="delivery-actions">
          <button className="ghost" onClick={delivery.onRetry}>
            <Icon name="restart" />
            Try again
          </button>
          <button className="ghost" onClick={delivery.onEdit}>
            <Icon name="pen" />
            Edit
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * The result of project work, sent back to the Assistant chat that gave the work. It speaks for the
 * Project side, so its visor has the Project eyes. A phone hides the visor, so the chip shows the mode too.
 */
function ProjectReportCard({
  report,
  turnKey,
}: {
  readonly report: ProjectReport;
  readonly turnKey: string | undefined;
}): ReactElement {
  const [showWhole, setShowWhole] = useState(false);
  const html = useMemo(
    () => toWebHtml(showWhole ? reportResultText(report) : reportPreview(report)),
    [showWhole, report],
  );
  return (
    <EvaMessage face={report.failed ? stateFaces.failed : stateFaces.greeting} mode="project" turnKey={turnKey}>
      <div className="project-report-head">
        <span className="mode-chip soft">
          <Icon name="briefcase" /> <span className="mode-chip-label">Project mode</span>
        </span>
        <strong>{reportHeadline(report)}</strong>
      </div>
      <p className="field-hint">{reportPlace(report)}</p>
      {showWhole && <p className="field-hint">Request: {report.request}</p>}
      {showWhole && report.resultCut && (
        <p className="field-hint">This is the end of a longer answer. The Project chat has all of it.</p>
      )}
      {/* toWebHtml escapes all text and adds only its own tags, so the HTML is safe. */}
      <div className="answer-body project-report-result" dangerouslySetInnerHTML={{ __html: html }} />
      {reportHasMore(report) && (
        <button className="whole-answer ghost" onClick={() => setShowWhole((shown) => !shown)}>
          {showWhole ? "Show the summary only" : "Show the whole result"}
        </button>
      )}
      <div className="project-report-actions">
        <a className="button-link plain" href={`#/chat/${encodeURIComponent(report.projectSessionId)}`}>
          <Icon name="briefcase" />
          Open the Project chat
        </a>
      </div>
    </EvaMessage>
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

/**
 * Eva's card, with her visor at its side. A phone hides the visor to keep the width.
 * In a Project chat, the eyes take the Project colour, so the mode shows at a glance.
 */
function EvaMessage({
  face,
  mode,
  turnKey,
  menu,
  settled = false,
  children,
}: {
  readonly face: Face;
  readonly mode: SessionRecord["mode"];
  /** The key of its turn, so a pick in the branch map can scroll to it. */
  readonly turnKey?: string | undefined;
  /** The context menu of a stored answer. A running answer has none. */
  readonly menu?: ContextMenuProps;
  /** The page showed this answer already, so it does not fade in. */
  readonly settled?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="msg" data-turn={turnKey}>
      <Visor size={28} face={face} projectEyes={mode === "project"} />
      <div className={`message answer${settled ? " settled" : ""}`} {...menu}>
        {children}
      </div>
    </div>
  );
}

/** A stored answer of Eva, with its actions under it and in its context menu (#863). */
function StoredAnswer({
  owner,
  turn,
  endedWork,
  onShowTasks,
  onRetry,
  onFork,
}: {
  readonly owner: SessionRecord;
  readonly turn: SessionRecord["turns"][number];
  readonly endedWork: ReadonlyMap<string, boolean>;
  readonly onShowTasks: () => void;
  readonly onRetry: () => void;
  readonly onFork: () => void;
}): ReactElement {
  const shown = useShownAnswer(turn.steps, turn.answerText, false);
  // The answer that ran in this page takes this place at the turn end. It does not fade in again (#1053).
  const [settled] = useState(() => takeShown(answerKey(owner.id)));
  // A closed chat takes no new turn, so it offers no way to start one.
  const { retry: canRetry, fork: canFork } = answerActions(owner, turn);
  const { props, parts } = useMessageMenu(shown.body, "Actions of Eva's answer", [
    ...(canRetry ? [{ label: "Retry", icon: "restart" as const, onChoose: onRetry }] : []),
    ...(canFork ? [{ label: "Fork", icon: "fork" as const, onChoose: onFork }] : []),
  ]);
  return (
    <>
      {parts}
      <EvaMessage face={stateFaces.idle} mode={owner.mode} menu={props} settled={settled}>
        <AnswerBody
          shown={shown}
          sessionId={owner.id}
          omitted={turn.omittedSteps}
          wholeAnswer={turn.answerText}
          summary={activityOf(turn)}
          endedWork={endedWork}
          vaultLinks={owner.mode === "assistant"}
          actions={
            <div className="answer-actions">
              {canRetry && (
                <button className="ghost" onClick={onRetry} data-tooltip={retryHint}>
                  <Icon name="restart" />
                  Retry
                </button>
              )}
              {canFork && (
                <button className="ghost" onClick={onFork} data-tooltip={forkHint}>
                  <Icon name="fork" />
                  Fork
                </button>
              )}
              {shown.body !== "" && <CopyButton text={shown.body} />}
              {/* Information, not an action on the message, so it stands apart at the right (#864). */}
              {turn.taskCount > 0 && (
                <button className="ghost answer-tasks" onClick={onShowTasks}>
                  <Icon name={tasksStillRun(tasksOfTurn(turn.steps, owner.id, endedWork)) ? "sync" : "check"} />
                  {counted(turn.taskCount, "background task")}
                </button>
              )}
            </div>
          }
          failure={turn.failure}
        />
      </EvaMessage>
    </>
  );
}

// The first line of a tooltip shows in bold (see `Tooltip.tsx`).
const retryHint =
  "Retry\nAsk again for a different answer to the message above. The new answer goes in a new branch, and this answer stays.";
const forkHint =
  "Fork\nStart a new branch from this answer. Write a different message there. The messages above stay as they are.";

/** What an answer card shows: its folded steps, and the last message or, on request, the whole answer. */
interface ShownAnswer {
  readonly listed: readonly TurnStep[];
  readonly lastMessage: TurnStep | undefined;
  /** The text of the card, which Copy copies. */
  readonly body: string;
}

/** The card's owner keeps this, so its context menu copies the same text as its Copy button (#863). */
function useShownAnswer(steps: readonly TurnStep[], wholeAnswer: string, live: boolean): ShownAnswer {
  // The step list shows each earlier message whole, so it is the way to read one. The last message
  // marks where the one before it ends, so the steps keep it until the fold.
  const whole = useMemo(() => wholeMessages(steps, wholeAnswer), [steps, wholeAnswer]);
  const { listed, lastMessage } = foldSteps(whole);
  const fullBody = lastMessage === undefined ? wholeAnswer : lastMessage.text;
  // Each streamed token and each clock tick render every answer, so parse only a changed text.
  const body = useMemo(() => shownAnswerText(fullBody, live), [fullBody, live]);
  return { listed, lastMessage, body };
}

/**
 * The folded steps, the last message in full, and the actions. A new message in a running turn
 * replaces the shown one, and the older one becomes a line of the steps. A turn stored before
 * steps existed has none, so it shows its whole answer text.
 */
function AnswerBody({
  shown,
  sessionId,
  omitted,
  wholeAnswer,
  summary,
  live = false,
  actions,
  failure = null,
  endedWork,
  vaultLinks = false,
}: {
  readonly shown: ShownAnswer;
  readonly omitted: number;
  /** The chat of a stored answer, so a step's dialog can fetch its details. */
  readonly sessionId?: string;
  /** Every message in full. A step keeps only 200 characters, so the step list takes each earlier message from here. */
  readonly wholeAnswer: string;
  readonly summary?: string;
  readonly live?: boolean;
  /** The buttons under the answer. */
  readonly actions?: ReactElement;
  /** Why the turn failed, or null. */
  readonly failure?: string | null;
  /** Each Project chat whose result came back, and whether its work failed, for the step dialog. */
  readonly endedWork?: ReadonlyMap<string, boolean>;
  /** True in an Assistant chat: its agent works in the vault root, so a path in a code span opens the Files page. */
  readonly vaultLinks?: boolean;
}): ReactElement {
  const { listed, lastMessage, body } = shown;
  const html = useMemo(() => toWebHtml(body, { vaultLinks }), [body, vaultLinks]);
  // A running turn can still change its files, so the buttons come with the stored turn, as in Telegram.
  const files = useMemo(() => (live ? [] : answerFiles(wholeAnswer)), [live, wholeAnswer]);
  // A page comes with the stored turn too: a running turn may still write its file (#1129).
  const pages = useMemo(() => (live ? [] : answerPages(wholeAnswer)), [live, wholeAnswer]);
  return (
    <>
      <StepFold
        steps={listed}
        omitted={omitted}
        live={live}
        {...(summary === undefined ? {} : { summary })}
        {...(sessionId === undefined ? {} : { sessionId })}
        {...(endedWork === undefined ? {} : { endedWork })}
        vaultLinks={vaultLinks}
        {...(lastMessage === undefined ? {} : { bubble: lastMessage })}
      />
      {body !== "" && <MarkdownBody html={html} className="answer-body" copy={!live} />}
      {pages.map((path) => (
        <PageFrame key={path} path={path} />
      ))}
      {files.length > 0 && (
        <div className="answer-files">
          {files.map((file) => (
            <DownloadButton key={file.path} path={file.path} folder={false} label={file.name} />
          ))}
        </div>
      )}
      {failure !== null && <div className="turn-failure">The turn failed: {failure}</div>}
      {actions}
    </>
  );
}

/** A running turn keeps the same window of steps as a stored one, so both show the same lines. */
function LiveAnswer({
  sessionId,
  turnCount,
  steps,
  mode,
  startedAt,
}: {
  readonly sessionId: string;
  /** The stored turns. A queued message starts the next turn in the same element, so each turn notes its answer. */
  readonly turnCount: number;
  /** The steps so far, with the block that the engine writes now as the last message. */
  readonly steps: readonly TurnStep[];
  readonly mode: SessionRecord["mode"];
  /** When the turn started, or null after its end, while the stored turn has not come yet. */
  readonly startedAt: number | null;
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
  const answer = useShownAnswer(shown.steps, wholeAnswer, true);
  // The stored answer takes its place at the turn end.
  useEffect(() => {
    noteShown(answerKey(sessionId));
  }, [sessionId, turnCount]);
  return (
    <EvaMessage face={liveFace(hasText, mode)} mode={mode}>
      <AnswerBody
        shown={answer}
        omitted={shown.omittedSteps}
        wholeAnswer={wholeAnswer}
        live
        vaultLinks={mode === "assistant"}
      />
      {startedAt !== null && (
        <div className="working">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Working · {elapsedText(Date.now() - startedAt)}
        </div>
      )}
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

/** The facts that link a chat to its forks. */
type ChatLink = Pick<SessionRecord, "id" | "parentId">;

/** A chat and each of its forks, the chat first. */
export function chatTree<S extends ChatLink>(root: S, sessions: readonly S[]): S[] {
  return [root, ...descendantsOf(root.id, sessions)];
}

function descendantsOf<S extends ChatLink>(sessionId: string, sessions: readonly S[]): S[] {
  const children = sessions.filter((session) => session.parentId === sessionId);
  return children.flatMap((child) => [child, ...descendantsOf(child.id, sessions)]);
}

/** The first chat of a fork's line, found through the parents that the list still has. */
export function rootIdOf(chat: ChatLink, sessions: readonly ChatLink[]): string {
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
export function rootChats<S extends ChatLink & Pick<SessionRecord, "lastTurnAt" | "createdAt">>(
  sessions: readonly S[],
): S[] {
  return sessions
    .filter((session) => session.parentId === null)
    .sort((first, second) =>
      (second.lastTurnAt ?? second.createdAt).localeCompare(first.lastTurnAt ?? first.createdAt),
    );
}

/** The note of a chat that came from another clone (issue 523). A deleted parent gets no link. */
function forkedFromNote(
  root: SessionRecord,
  sessions: readonly Pick<SessionRecord, "id" | "title">[],
): { readonly text: string; readonly chatId: string | null } | null {
  const parent = sessions.find((session) => session.id === root.forkedFrom?.sessionId);
  const text = forkedFromText(root, parent?.title ?? null);
  return text === null ? null : { text, chatId: parent?.id ?? null };
}
