/**
 * The steps of one answer: a row of small badges, one for each message, command, tool and
 * task before the answer's last message. A badge shows its text on hover. A phone has no
 * hover, so a tap on the row opens the list of steps.
 */
import { useState, type ReactElement } from "react";
import type { StepKind, TurnStep } from "../../../shared/turn-steps.ts";

const kindLabels: Readonly<Record<StepKind, string>> = {
  message: "Message",
  command: "Command",
  tool: "Tool",
  task: "Task",
};

/** The last message shows in full as the answer; every other step is a badge before it. */
export function splitSteps(steps: readonly TurnStep[]): {
  earlier: readonly TurnStep[];
  lastMessage: TurnStep | undefined;
} {
  const last = steps.findLastIndex((step) => step.kind === "message");
  return { earlier: steps.filter((_, index) => index !== last), lastMessage: steps[last] };
}

function stepLabel(step: TurnStep): string {
  return `${kindLabels[step.kind]}${step.isError ? " (failed)" : ""}: ${step.text}`;
}

function Badge({ step }: { readonly step: TurnStep }): ReactElement {
  return (
    <span
      className={`step-badge ${step.kind}${step.isError ? " failed" : ""}`}
      role="img"
      aria-label={stepLabel(step)}
      title={stepLabel(step)}
    />
  );
}

export function StepRow({
  steps,
  omitted,
}: {
  readonly steps: readonly TurnStep[];
  readonly omitted: number;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  const count = steps.length + omitted;
  return (
    <div className="steps">
      <button
        className="steps-toggle"
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} ${String(count)} step${count === 1 ? "" : "s"}`}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        {steps.map((step, index) => (
          <Badge key={`${step.id ?? ""}-${String(index)}`} step={step} />
        ))}
      </button>
      {open && (
        <ol className="step-list" aria-label="Steps">
          {omitted > 0 && <li className="muted">{omitted} earlier steps are not kept.</li>}
          {steps.map((step, index) => (
            <li key={`${step.id ?? ""}-${String(index)}`}>
              <Badge step={step} />
              <span>
                <strong>{kindLabels[step.kind]}</strong>
                {step.isError ? " (failed)" : ""} {step.text}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
