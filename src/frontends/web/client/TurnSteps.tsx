/**
 * A row of small badges, one for each message, command, tool and task of an answer. A badge
 * shows its text on hover. A phone has no hover, so a tap on the row opens the list of steps.
 */
import { useId, useState, type ReactElement } from "react";
import type { StepKind, TurnStep } from "../../../shared/turn-steps.ts";

const kindLabels: Readonly<Record<StepKind, string>> = {
  message: "Message",
  command: "Command",
  tool: "Tool",
  task: "Task",
};

function stepLabel(step: TurnStep): string {
  return `${kindLabels[step.kind]}${step.isError ? " (failed)" : ""}: ${step.text}`;
}

/** In the open list, the row text says the same, so a screen reader skips the badge there. */
function Badge({ step, hidden = false }: { readonly step: TurnStep; readonly hidden?: boolean }): ReactElement {
  const className = `step-badge step-${step.kind}${step.isError ? " failed" : ""}`;
  if (hidden) return <span className={className} aria-hidden="true" />;
  return <span className={className} role="img" aria-label={stepLabel(step)} title={stepLabel(step)} />;
}

function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

export function StepRow({
  steps,
  omitted = 0,
  noun = "step",
}: {
  readonly steps: readonly TurnStep[];
  readonly omitted?: number;
  /** Names the row: "earlier step" or "later step" when the answer has a row on each side of its last message. */
  readonly noun?: string;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (steps.length === 0 && omitted === 0) return null;
  return (
    <div className="steps">
      <button
        className="steps-toggle"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${open ? "Hide" : "Show"} ${counted(steps.length + omitted, noun)}`}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        {steps.map((step, index) => (
          <Badge key={`${step.id ?? ""}-${String(index)}`} step={step} />
        ))}
      </button>
      {open && (
        <ol className="step-list" id={listId} aria-label={`${noun.charAt(0).toUpperCase()}${noun.slice(1)}s`}>
          {omitted > 0 && <li className="muted">{counted(omitted, "step")} not kept.</li>}
          {steps.map((step, index) => (
            <li key={`${step.id ?? ""}-${String(index)}`}>
              <Badge step={step} hidden />
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
