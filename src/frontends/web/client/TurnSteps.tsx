/**
 * The steps of an answer, folded into one line: the count, the last step and an arrow. A tap
 * opens the list, one line for each message, command, tool and task: a pill says what the step
 * did, and plain text says what it did it to, such as the file that it read.
 */
import { useId, useState, type ReactElement } from "react";
import type { TurnStep } from "../../../shared/turn-steps.ts";
import { stepIcon, stepParts } from "./conversation-parts.ts";
import { Icon } from "./icons.tsx";

function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** The pill and the text of one step. The pill is a word, so a failed step shows by more than colour. */
function StepParts({ step }: { readonly step: TurnStep }): ReactElement {
  const { action, detail } = stepParts(step);
  return (
    <>
      <span className={`pill step-pill${step.isError ? " failed" : ""}`}>
        {action}
        {step.isError && <span className="visually-hidden"> (failed)</span>}
      </span>{" "}
      {detail !== "" && <span className="step-text">{detail}</span>}
    </>
  );
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
        {last !== undefined && (
          <span className="steps-last">
            <StepParts step={last} />
          </span>
        )}
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
              <StepParts step={step} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
