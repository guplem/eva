/**
 * The chat in view: its model, engine and mode, how full its context is, and its background
 * tasks, such as subagents and background commands. A wide screen shows them in a side panel.
 * A phone shows them in a dialog from the "Chat info" button, and the tasks also from the task chip.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { SessionRecord } from "./api.ts";
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

/** "25.4k tokens": short enough for the panel. */
function formatTokens(count: number): string {
  if (count < 1000) return `${String(count)} tokens`;
  return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k tokens`;
}

/** The context after the newest answer of the chat and its branches, or null when no engine said. */
function latestContext(branches: readonly SessionRecord[]): number | null {
  const turns = branches
    .flatMap((branch) => branch.turns)
    .filter((turn) => turn.contextTokens !== null)
    .sort((first, second) => second.at.localeCompare(first.at));
  return turns[0]?.contextTokens ?? null;
}

function TaskList({ tasks, empty }: { readonly tasks: Tasks; readonly empty: string }): ReactElement {
  const entries = Object.entries(tasks);
  if (entries.length === 0) return <span className="chip">{empty}</span>;
  return (
    <>
      {entries.map(([taskId, task]) => (
        <div key={taskId} className="task">
          {task.description}
          <div className="state">{task.state}</div>
        </div>
      ))}
    </>
  );
}

interface ChatProps {
  /** The chat first, then each of its branches. Empty when no chat is open. */
  readonly branches: readonly SessionRecord[];
  readonly tasks: Tasks;
}

function ChatDetails({ branches, tasks }: ChatProps): ReactElement {
  const root = branches[0];
  const context = latestContext(branches);
  return (
    <>
      {root !== undefined && (
        <dl className="chat-details">
          <dt>Model</dt>
          <dd>{root.modelAlias}</dd>
          <dt>Engine</dt>
          <dd>{root.engine}</dd>
          <dt>Mode</dt>
          <dd>{root.mode}</dd>
          <dt>Answers</dt>
          <dd>
            {branches.reduce((sum, branch) => sum + branch.turns.length, 0)}
            {branches.length > 1 ? ` in ${String(branches.length)} branches` : ""}
          </dd>
          <dt>Context</dt>
          <dd>{context === null ? "Not known yet" : formatTokens(context)}</dd>
        </dl>
      )}
      <h3>Background tasks</h3>
      <TaskList
        tasks={tasks}
        empty={root?.engine === "pi" ? "pi does not report background tasks." : "Nothing runs in the background."}
      />
    </>
  );
}

export function ChatPanel(props: ChatProps): ReactElement {
  return (
    <aside className="tasks" aria-label="This chat">
      <h2>This chat</h2>
      <ChatDetails {...props} />
    </aside>
  );
}

/** A phone hides the side panel, so this button opens the same details in a dialog. */
export function ChatInfoButton(props: ChatProps): ReactElement {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button className="chat-info-button" onClick={() => setOpen(true)}>
        Chat info
      </button>
      {open && (
        <Dialog label="This chat" onClose={close}>
          <ChatDetails {...props} />
        </Dialog>
      )}
    </>
  );
}

export function TasksDialog({ tasks, onClose }: { readonly tasks: Tasks; readonly onClose: () => void }): ReactElement {
  return (
    <Dialog label="Background tasks" onClose={onClose}>
      <strong>Background tasks of this chat</strong>
      {/* The tasks live in this page only, so a count from before a reload can have no list. */}
      <TaskList tasks={tasks} empty="This page has no news of these tasks. They ran before it opened." />
    </Dialog>
  );
}

function Dialog({
  label,
  onClose,
  children,
}: {
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactElement {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={label}>
        {children}
        <div className="message-actions">
          <button ref={close} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
