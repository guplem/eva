/**
 * The chat in view: how full its context is, its engine, model and mode, its background tasks,
 * such as subagents and background commands, and a way to fork it. A computer shows them in the
 * inspector column. A phone shows the same content in a bottom sheet from the chat header.
 */
import { useCallback, useState, type CSSProperties, type ReactElement } from "react";
import { Dialog } from "./Dialog.tsx";
import { api, type SessionRecord } from "./api.ts";
import {
  contextFigure,
  contextShare,
  engineLabel,
  branchForkPoint,
  chatLinks,
  latestContext,
  taskStatus,
  titleCase,
} from "./chat-details.ts";
import { answeredModel, effortName, modelLabel } from "./conversation-parts.ts";
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
            <Icon name="sync" />
            <span className="task-description">{task.description}</span>
            <span className={`status-pill ${status.tone}`}>{status.label}</span>
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
  const point = branchForkPoint(tree, shownId);
  if (point === null) return null;
  const fork = async (): Promise<void> => {
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
    <button className="fork-chat" disabled={forking} onClick={() => void fork()}>
      <Icon name="fork" /> Fork this chat
    </button>
  );
}

/** The address of a chat opens it in its own view, whatever its mode. */
function ChatLink({ chat }: { readonly chat: SessionRecord }): ReactElement {
  return <a href={`#/chat/${encodeURIComponent(chat.id)}`}>{chat.title}</a>;
}

function ChatDetails({ tree, tasks, onChanged, shownId = null, sessions }: ChatProps): ReactElement {
  const root = tree[0];
  const links = chatLinks(tree, sessions);
  return (
    <>
      {root !== undefined && (
        <>
          <ContextUse tree={tree} />
          <dl className="chat-facts">
            {/* An open chat keeps its engine and its model (lesson 41), so they are text, not chips. */}
            <dt>Engine</dt>
            <dd>{engineLabel(root.engine)}</dd>
            <dt>Model</dt>
            <dd>{modelLabel(root.modelAlias, answeredModel(root.turns))}</dd>
            <dt>Effort</dt>
            {/* Each branch has its own composer, so a fork can have its own effort. */}
            <dd>{[...new Set(tree.map((session) => effortName(session.effort)))].join(", ")}</dd>
            <dt>Mode</dt>
            <dd>{titleCase(root.mode)}</dd>
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
        empty={root?.engine === "pi" ? "pi does not report background tasks." : "Nothing runs in the background."}
      />
      <ForkButton tree={tree} onChanged={onChanged} shownId={shownId} />
    </>
  );
}

const panelStorageKey = "eva.chat-panel";

/** The header's hide and show button controls the column with this id. */
export const chatPanelId = "chat-panel";

/**
 * Whether a computer shows the inspector column. A person can hide it for a wider chat.
 * Each browser keeps its own choice, as with the appearance. Blocked storage gives the default: shown.
 */
export function useChatPanelShown(): readonly [boolean, () => void] {
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem(panelStorageKey) !== "hidden";
    } catch {
      return true;
    }
  });
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
 * The column slides open and shut, so a hide does not jump the chat. It stays in the page until its
 * close animation ends. A page load shows it at once: only a toggle animates it.
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
        // The animations of the content inside bubble up here too.
        if (event.target !== event.currentTarget) return;
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
    <Dialog label="This chat" onClose={onClose} sheet>
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
  onClose,
}: {
  readonly tasks: Tasks;
  readonly empty: string;
  /** How many tasks the answer had. A long turn keeps only its last 100 steps, so some can be missing. */
  readonly total?: number;
  readonly onClose: () => void;
}): ReactElement {
  const shown = Object.keys(tasks).length;
  const missing = total === undefined ? 0 : total - shown;
  return (
    <Dialog label="Background tasks" onClose={onClose}>
      <strong>Background tasks</strong>
      <TaskList tasks={tasks} empty={empty} />
      {shown > 0 && missing > 0 && (
        <span className="chip">
          {missing} more {missing === 1 ? "task was" : "tasks were"} not kept.
        </span>
      )}
    </Dialog>
  );
}
