/**
 * The chat in view: how full its context is, its engine, model and mode, its background tasks,
 * such as subagents and background commands, and a way to fork it. A computer shows them in the
 * inspector column. A phone shows the same content in a bottom sheet from the chat header.
 */
import { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from "react";
import type { ContextPart } from "../../../shared/chat-context.ts";
import { takesEffort } from "../../../shared/engine-port.ts";
import { chatKind, chatKindName } from "../../../shared/chat-kind.ts";
import { BranchChoiceDialog, useFinishBranch, type BranchRequest } from "./BranchChoiceDialog.tsx";
import { CopyButton } from "./CopyButton.tsx";
import { Dialog } from "./Dialog.tsx";
import { ListSkeleton } from "./Loading.tsx";
import { api, type SessionRecord } from "./api.ts";
import {
  contextFigure,
  contextSections,
  partIcon,
  contextShare,
  engineLabel,
  branchForkPoint,
  chatLinks,
  latestContext,
  modelNames,
  taskStatus,
} from "./chat-details.ts";
import { effortName } from "./conversation-parts.ts";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import type { LiveState } from "./live-state.ts";

type Tasks = LiveState["tasks"];

/** The tasks of these sessions only, so another chat's work stays out of view. */
export function tasksOf(tasks: Tasks, sessionIds: readonly string[]): Tasks {
  return Object.fromEntries(Object.entries(tasks).filter(([, task]) => sessionIds.includes(task.sessionId)));
}

/** The number of tasks that still run. */
export function runningCount(tasks: Tasks): number {
  return Object.values(tasks).filter((task) => task.state === "running").length;
}

/** One card for each task: its description and a status pill with one word and one colour. */
function TaskList({ tasks, empty }: { readonly tasks: Tasks; readonly empty: string }): ReactElement {
  const entries = Object.entries(tasks);
  if (entries.length === 0) return <p className="task-empty">{empty}</p>;
  return (
    <ul className="task-list">
      {entries.map(([taskId, task]) => {
        const status = taskStatus(task.state);
        return (
          <li key={taskId} className="task-card">
            <Icon name={status.icon} />
            <span className="task-description">{task.description}</span>
            <span className={`status-pill ${status.tone}`}>{status.label}</span>
            {task.chatId !== undefined && (
              <a className="task-chat-link" href={`#/chat/${encodeURIComponent(task.chatId)}`}>
                Open chat
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface ChatProps {
  /** The chat first, then each of its forks. Empty when no chat is open. */
  readonly tree: readonly SessionRecord[];
  readonly tasks: Tasks;
  /** Reloads the chat list, so a new fork shows in it. */
  readonly onChanged: () => Promise<void>;
  /** The branch that the page shows. "Fork this chat" forks it. */
  readonly shownId?: string | null;
  /** Every chat, so the details can link the chats that one continues from a summary. */
  readonly sessions: readonly SessionRecord[];
}

/** A conic gradient fills the ring with the share. Only a known window gives a share, so the ring is never a guess. */
function ContextUse({ tree }: { readonly tree: readonly SessionRecord[] }): ReactElement {
  const context = latestContext(tree);
  const share = context === null ? null : contextShare(context);
  return (
    <div className="context-use">
      {share !== null && (
        <div
          className="context-ring"
          style={{ "--share": share } as CSSProperties}
          role="img"
          aria-label={`${String(share)}% of the context window in use`}
        >
          <b aria-hidden="true">{share}%</b>
        </div>
      )}
      <div className="context-text">
        <span className="muted">Context used</span>
        {context === null ? (
          <span>Not known</span>
        ) : (
          <span>
            <strong>{contextFigure(context)}</strong> tokens
          </span>
        )}
      </div>
    </div>
  );
}

function ForkButton({
  tree,
  onChanged,
  shownId = null,
}: Pick<ChatProps, "tree" | "onChanged" | "shownId">): ReactElement | null {
  const showError = useShowError();
  const [forking, setForking] = useState(false);
  /** The fork of a Project chat whose choices the dialog shows (issue 523). */
  const [choosing, setChoosing] = useState<BranchRequest | null>(null);
  const closeChoices = useCallback(() => setChoosing(null), []);
  const finishBranch = useFinishBranch(onChanged);
  const point = branchForkPoint(tree, shownId);
  if (point === null) return null;
  const owner = tree.find((session) => session.id === point.sessionId);
  const turn = owner?.turns.find((candidate) => candidate.lastMessageId === point.messageId);
  const fork = async (): Promise<void> => {
    // A specialist has no clone, so its fork is a branch of the chat (#703).
    if (owner !== undefined && chatKind(owner) === "project" && turn !== undefined) {
      setChoosing({ kind: "fork", sessionId: point.sessionId, atMessageId: point.messageId, turn });
      return;
    }
    setForking(true);
    try {
      await api.fork(point.sessionId, point.messageId);
      await onChanged();
    } catch (caught) {
      showError(caught);
    } finally {
      setForking(false);
    }
  };
  return (
    <>
      <button className="fork-chat" disabled={forking} onClick={() => void fork()}>
        <Icon name="fork" /> Fork this chat
      </button>
      {choosing !== null && <BranchChoiceDialog request={choosing} onClose={closeChoices} onDone={finishBranch} />}
    </>
  );
}

/** One part's whole text. A part that only the engine can read shows why instead. */
function ContextPartDialog({
  part,
  onClose,
}: {
  readonly part: ContextPart;
  readonly onClose: () => void;
}): ReactElement {
  return (
    <Dialog label={part.title} onClose={onClose} scrimCloses>
      <strong>{part.title}</strong>
      {part.source !== null && <p className="context-source">{part.source}</p>}
      {part.note !== null && <p className="task-note">{part.note}</p>}
      {part.text !== null && (
        <>
          <pre className="context-full-text">{part.text}</pre>
          <CopyButton text={part.text} />
        </>
      )}
    </Dialog>
  );
}

/**
 * Each part of the chat's context that the agent reads before the conversation, by group, such as
 * the prompt and the instruction files. Eva reads them again after each answer. A tap shows a part's text.
 */
function ChatContext({ sessionId, answers }: { readonly sessionId: string; readonly answers: number }): ReactElement {
  const [parts, setParts] = useState<readonly ContextPart[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<ContextPart | null>(null);
  const close = useCallback(() => setOpen(null), []);
  useEffect(() => {
    let current = true;
    api.chatContext(sessionId).then(
      (found) => {
        if (!current) return;
        setParts(found);
        setFailed(false);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [sessionId, answers]);
  return (
    <>
      <h3>Context</h3>
      {failed ? (
        <p className="task-empty">Eva could not read the context of this chat.</p>
      ) : parts === null ? (
        <ListSkeleton label="Reading the context…" rows={3} />
      ) : (
        <>
          {/* Claude Code keeps the prompt of a chat's first request until it compacts the chat (lesson 115). */}
          <p className="task-note">Eva shows each part as it is now. A running chat can still use an older copy.</p>
          {contextSections(parts).map((section) => (
            <section key={section.label} className="context-group" aria-label={section.label}>
              <span className="context-group-label">{section.label}</span>
              <ul className="context-list">
                {section.parts.map((part, index) => (
                  <li key={`${part.title}-${String(index)}`}>
                    <button className="context-part" onClick={() => setOpen(part)}>
                      <Icon name={partIcon(part)} />
                      <span className="context-part-title">{part.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
      {open !== null && <ContextPartDialog part={open} onClose={close} />}
    </>
  );
}

/** The address of a chat opens it in its own view, whatever its mode. */
function ChatLink({ chat }: { readonly chat: SessionRecord }): ReactElement {
  return <a href={`#/chat/${encodeURIComponent(chat.id)}`}>{chat.title}</a>;
}

function ChatDetails({ tree, tasks, onChanged, shownId = null, sessions }: ChatProps): ReactElement {
  const root = tree[0];
  const shown = tree.find((session) => session.id === shownId) ?? root;
  const links = chatLinks(tree, sessions);
  return (
    <>
      {root !== undefined && (
        <>
          <ContextUse tree={tree} />
          <dl className="chat-facts">
            {/* The composer's chip changes the model, so these are text, not chips. An open chat keeps its engine. */}
            <dt>Engine</dt>
            <dd>{engineLabel(root.engine)}</dd>
            <dt>Model</dt>
            <dd>{modelNames(tree)}</dd>
            {/* A model with no effort level, such as Claude Code's Fast, shows none (#550). */}
            {tree.some((session) => takesEffort(session.engine, session.modelAlias)) && (
              <>
                <dt>Effort</dt>
                {/* Each branch has its own composer, so a fork can have its own effort. */}
                <dd>{[...new Set(tree.map((session) => effortName(session.effort)))].join(", ")}</dd>
              </>
            )}
            <dt>Mode</dt>
            <dd>{chatKindName(chatKind(root))}</dd>
            <dt>Answers</dt>
            <dd>
              {tree.reduce((sum, session) => sum + session.turns.length, 0)}
              {tree.length > 1 ? `, with ${String(tree.length - 1)} fork${tree.length === 2 ? "" : "s"}` : ""}
            </dd>
            {links.from !== null && (
              <>
                <dt>Continues</dt>
                <dd>
                  <ChatLink chat={links.from} />
                </dd>
              </>
            )}
            {links.next.length > 0 && (
              <>
                <dt>Continued in</dt>
                {links.next.map((next) => (
                  <dd key={next.id}>
                    <ChatLink chat={next} />
                  </dd>
                ))}
              </>
            )}
          </dl>
        </>
      )}
      <h3>Background tasks</h3>
      <TaskList
        tasks={tasks}
        // The panel shows only the tasks that run now. An answer's own tasks show under the answer.
        empty={root?.engine === "pi" ? "pi does not report background tasks." : "No background task runs now."}
      />
      <ForkButton tree={tree} onChanged={onChanged} shownId={shownId} />
      {/* A fork can run on another engine, so the branch in view gives the context. */}
      {/* The key starts each chat with no parts, so another chat's parts never show while Eva reads. */}
      {shown !== undefined && <ChatContext key={shown.id} sessionId={shown.id} answers={shown.turns.length} />}
    </>
  );
}

const panelStorageKey = "eva.chat-panel";

/** The header's hide and show button controls the column with this id. */
export const chatPanelId = "chat-panel";

/** The choice of this browser, so the first load of a chat shows the column too. */
export function chatPanelKeptShown(): boolean {
  try {
    return localStorage.getItem(panelStorageKey) !== "hidden";
  } catch {
    return true;
  }
}

/**
 * Whether a computer shows the inspector column. A person can hide it for a wider chat.
 * Each browser keeps its own choice, as with the appearance. Blocked storage gives the default: shown.
 */
export function useChatPanelShown(): readonly [boolean, () => void] {
  const [shown, setShown] = useState(chatPanelKeptShown);
  const toggle = useCallback(() => {
    setShown((current) => {
      try {
        localStorage.setItem(panelStorageKey, current ? "hidden" : "shown");
      } catch {
        // The choice still applies until the page reloads.
      }
      return !current;
    });
  }, []);
  return [shown, toggle];
}

type PanelMotion = "open" | "opening" | "closing" | "gone";

/**
 * The column slides in and out at the edge of the chat. It stays in the page until its close
 * animation ends. A page load shows it at once: only a toggle animates it.
 */
export function ChatPanel({ shown, ...props }: ChatProps & { readonly shown: boolean }): ReactElement | null {
  const [motion, setMotion] = useState<PanelMotion>(shown ? "open" : "gone");
  if (shown && (motion === "closing" || motion === "gone")) setMotion("opening");
  if (!shown && (motion === "open" || motion === "opening")) setMotion("closing");
  if (motion === "gone") return null;
  return (
    <aside
      id={chatPanelId}
      className={`chat-panel-frame ${motion}`}
      aria-label="This chat"
      inert={motion === "closing"}
      onAnimationEnd={(event) => {
        // The column slides, not the frame. The animations of the content inside bubble up here too.
        if (event.animationName !== "chat-panel-in" && event.animationName !== "chat-panel-out") return;
        setMotion((current) => (current === "opening" ? "open" : current === "closing" ? "gone" : current));
      }}
    >
      <div className="chat-panel">
        <h2>This chat</h2>
        <ChatDetails {...props} />
      </div>
    </aside>
  );
}

/** A phone hides the inspector, so the chat header opens the same details in a bottom sheet. */
export function ChatInfoSheet({ onClose, ...props }: ChatProps & { readonly onClose: () => void }): ReactElement {
  return (
    <Dialog label="This chat" onClose={onClose} scrimCloses>
      <div className="chat-panel in-sheet">
        <h2>This chat</h2>
        <ChatDetails {...props} />
      </div>
    </Dialog>
  );
}

export function TasksDialog({
  tasks,
  empty,
  total,
  note,
  onClose,
}: {
  readonly tasks: Tasks;
  readonly empty: string;
  /** What the list shows, such as the tasks of one answer. */
  readonly note?: string;
  /** How many tasks the answer had. A long turn keeps only its last 100 steps, so some can be missing. */
  readonly total?: number;
  readonly onClose: () => void;
}): ReactElement {
  const shown = Object.keys(tasks).length;
  const missing = total === undefined ? 0 : total - shown;
  return (
    <Dialog label="Background tasks" onClose={onClose}>
      <strong>Background tasks</strong>
      {note !== undefined && <p className="task-note">{note}</p>}
      <TaskList tasks={tasks} empty={empty} />
      {shown > 0 && missing > 0 && (
        <span className="chip">
          {missing} more {missing === 1 ? "task was" : "tasks were"} not kept.
        </span>
      )}
    </Dialog>
  );
}
