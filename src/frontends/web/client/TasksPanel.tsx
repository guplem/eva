/**
 * The background tasks of the chats in view, such as subagents and background commands.
 * Both modes show them: in a side panel on a wide screen, and in a dialog from the task chip.
 */
import type { ReactElement } from "react";
import type { LiveState } from "./live-state.ts";

type Tasks = LiveState["tasks"];

/** The tasks of these sessions only, so another chat's work stays out of view. */
export function tasksOf(tasks: Tasks, sessionIds: readonly string[]): Tasks {
  return Object.fromEntries(Object.entries(tasks).filter(([, task]) => sessionIds.includes(task.sessionId)));
}

export function TaskList({ tasks }: { readonly tasks: Tasks }): ReactElement {
  const entries = Object.entries(tasks);
  if (entries.length === 0) return <span className="chip">Nothing runs in the background.</span>;
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
      <TaskList tasks={tasks} />
    </aside>
  );
}

export function TasksDialog({ tasks, onClose }: { readonly tasks: Tasks; readonly onClose: () => void }): ReactElement {
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-label="Background tasks">
        <strong>Background tasks</strong>
        <TaskList tasks={tasks} />
        <div className="message-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
