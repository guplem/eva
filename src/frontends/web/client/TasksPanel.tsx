/**
 * The background tasks of the chats in view, such as subagents and background commands.
 * Both modes show them: in a side panel on a wide screen, and in a dialog from the task chip.
 */
import { useEffect, useRef, type ReactElement } from "react";
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

export function TasksPanel({ tasks }: { readonly tasks: Tasks }): ReactElement {
  return (
    <aside className="tasks" aria-label="Background tasks">
      <h2 style={{ fontSize: 13, marginTop: 0 }}>Background tasks</h2>
      <TaskList tasks={tasks} empty="Nothing runs in the background." />
    </aside>
  );
}

export function TasksDialog({ tasks, onClose }: { readonly tasks: Tasks; readonly onClose: () => void }): ReactElement {
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
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Background tasks">
        <strong>Background tasks of this chat</strong>
        {/* The tasks live in this page only, so a count from before a reload can have no list. */}
        <TaskList tasks={tasks} empty="This page has no news of these tasks. They ran before it opened." />
        <div className="message-actions">
          <button ref={close} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
