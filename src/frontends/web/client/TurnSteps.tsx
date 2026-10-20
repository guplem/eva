/**
 * The steps of an answer, folded into one line: the count, the last step and an arrow. A tap
 * opens the list, one monospace line for each message, command, tool and task.
 */
import { useId, useState, type ReactElement } from "react";
import type { StepKind, TurnStep } from "../../../shared/turn-steps.ts";
import { stepIcon } from "./conversation-parts.ts";
import { Icon } from "./icons.tsx";

/** The icon shows the kind to the eye; this word says it to a screen reader. */
const kindLabels: Readonly<Record<StepKind, string>> = {
  message: "Message",
  command: "Command",
  tool: "Tool",
  task: "Task",
};

function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

export function StepFold({
  steps,
  omitted = 0,
  live = false,
  summary,
}: {
  readonly steps: readonly TurnStep[];
  readonly omitted?: number;
  /** A running turn shows its list open, so the person sees each step arrive. */
  readonly live?: boolean;
  /** What the turn did, such as "1 command, 1 tool", as the line's hover text. */
  readonly summary?: string;
}): ReactElement | null {
  const [open, setOpen] = useState(live);
  const listId = useId();
  const total = steps.length + omitted;
  if (total === 0) return null;
  const last = steps.at(-1);
  const failed = steps.some((step) => step.isError);
  return (
    <div className="step-fold">
      <button
        className="steps-line"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${open ? "Hide" : "Show"} ${counted(total, "step")}`}
        data-tooltip={summary}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span className={failed ? "failed" : undefined}>
          <Icon name={failed ? "alert" : live ? "sync" : "check"} />
        </span>
        <span className="steps-count">{counted(total, "step")}</span>
        {last !== undefined && <span className="steps-last">{last.text}</span>}
        <span className={`steps-arrow${open ? " open" : ""}`}>
          <Icon name="down" />
        </span>
      </button>
      {open && (
        <ol className="step-list" id={listId} aria-label="Steps">
          {omitted > 0 && <li className="muted">{counted(omitted, "step")} not kept.</li>}
          {steps.map((step, index) => (
            <li key={`${step.id ?? ""}-${String(index)}`} className={step.isError ? "failed" : undefined}>
              <Icon name={stepIcon(step)} />
              <span className="visually-hidden">
                {kindLabels[step.kind]}
                {step.isError ? " (failed)" : ""}{" "}
              </span>
              <span className="step-text">{step.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
