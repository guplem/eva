/**
 * The steps of an answer, folded into one line: the count, the last step and an arrow. A tap
 * opens the list, one line for each message, command, tool and task. A message shows its text
 * beside the face of Eva. For every other step, a pill says what the step
 * did, and plain text says what it did it to, such as the file that it read. A tap on a step
 * opens a dialog with all of it: where the tool comes from, its description, and its whole input
 * and output, each in a fold.
 */
import { useEffect, useId, useState, type ReactElement } from "react";
import type { StepDetail, TurnStep } from "../../../shared/turn-steps.ts";
import { api } from "./api.ts";
import { Dialog } from "./Dialog.tsx";
import {
  hasToolDetails,
  inputFields,
  missingDetail,
  stepHasPill,
  stepIcon,
  stepOrigin,
  stepParts,
  stepState,
} from "./conversation-parts.ts";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import { errorText } from "./SettingsParts.tsx";

function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** The pill and the text of one step. The pill is a word, so a failed step shows by more than colour. */
function StepParts({ step }: { readonly step: TurnStep }): ReactElement {
  const { action, detail } = stepParts(step);
  if (!stepHasPill(step)) {
    return (
      <span className="step-text step-message">
        <span className="visually-hidden">{action}: </span>
        {detail}
      </span>
    );
  }
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
  sessionId,
  endedWork,
}: {
  readonly steps: readonly TurnStep[];
  readonly omitted?: number;
  /** A running turn shows its list open, so the person sees each step arrive. */
  readonly live?: boolean;
  /** What the turn did, such as "1 command, 1 tool", as the line's hover text. */
  readonly summary?: string;
  /** The chat of a stored answer. Its steps carry no details, so the dialog fetches them. */
  readonly sessionId?: string;
  /** Each Project chat whose result came back, and whether its work failed. */
  readonly endedWork?: ReadonlyMap<string, boolean>;
}): ReactElement | null {
  const [open, setOpen] = useState(live);
  const [shown, setShown] = useState<TurnStep | null>(null);
  const listId = useId();
  const total = steps.length + omitted;
  if (total === 0) return null;
  const last = steps.at(-1);
  const failed = steps.some((step) => step.isError);
  // A live step changes as its output arrives, so the dialog follows the newest copy of the shown step.
  const current = shown === null ? null : (steps.find((step) => step.id !== null && step.id === shown.id) ?? shown);
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
              <button className="step-row" aria-haspopup="dialog" onClick={() => setShown(step)}>
                <Icon name={stepIcon(step)} />
                <StepParts step={step} />
              </button>
            </li>
          ))}
        </ol>
      )}
      {current !== null && (
        <StepDialog
          // The dialog reads its details once. A new step, or the end of the turn, starts a new read.
          key={`${current.id ?? ""}-${String(live)}`}
          step={current}
          live={live}
          {...(endedWork === undefined ? {} : { endedWork })}
          {...(sessionId === undefined ? {} : { sessionId })}
          onClose={() => setShown(null)}
        />
      )}
    </div>
  );
}

type Details = StepDetail | "loading" | { readonly failed: string };

/**
 * Everything about one step. A live step carries its input and output. A stored one does not,
 * because the session list stays small, so the dialog fetches them.
 */
function StepDialog({
  step,
  live,
  sessionId,
  endedWork,
  onClose,
}: {
  readonly step: TurnStep;
  readonly live: boolean;
  readonly sessionId?: string;
  readonly endedWork?: ReadonlyMap<string, boolean>;
  readonly onClose: () => void;
}): ReactElement {
  const carried = step.input !== undefined || step.output !== undefined;
  const fetches = hasToolDetails(step) && !carried && !live && sessionId !== undefined && step.id !== null;
  const [fetched, setFetched] = useState<Details>(fetches ? "loading" : {});
  useEffect(() => {
    if (!fetches) return;
    let current = true;
    api.stepDetail(sessionId, step.id).then(
      ({ input, output }) => {
        if (current) setFetched({ ...(input === null ? {} : { input }), ...(output === null ? {} : { output }) });
      },
      (error: unknown) => {
        if (current) setFetched({ failed: errorText(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [fetches, sessionId, step.id]);

  const { action, detail } = stepParts(step);
  const state = stepState(step, live, endedWork);
  const details: Details = carried ? { input: step.input, output: step.output } : fetched;
  const read = details !== "loading" && !("failed" in details) ? details : null;
  const fields = inputFields(read?.input);
  const origin = stepOrigin(step);
  const tool = origin?.tool ?? null;
  const description = fields?.description ?? null;
  return (
    <Dialog label={`Step: ${action}`} onClose={onClose} sheet>
      <div className="step-dialog-title">
        <span className={`pill step-pill${step.isError ? " failed" : ""}`}>{action}</span>
        <span
          className={`status-pill ${state === "Failed" ? "bad" : state === "Running" ? "live" : state === "Started" ? "idle" : "ok"}`}
        >
          {state}
        </span>
      </div>
      {step.chatId !== undefined && <a href={`#/chat/${encodeURIComponent(step.chatId)}`}>Open chat</a>}
      {(origin !== null || description !== null) && (
        <dl className="facts">
          {tool !== null && (
            <>
              <dt>Tool</dt>
              <dd className="step-dialog-text">{tool}</dd>
            </>
          )}
          {origin !== null && (
            <>
              <dt>From</dt>
              <dd>{origin.from}</dd>
            </>
          )}
          {description !== null && (
            <>
              <dt>Description</dt>
              <dd>{description}</dd>
            </>
          )}
        </dl>
      )}
      {/* The text is a short copy of the input, so it shows only when the input cannot. */}
      {detail !== "" && fields === null && <p className="step-dialog-text">{detail}</p>}
      {hasToolDetails(step) &&
        (details === "loading" ? (
          <ProgressBar label="Eva reads the details of the step." />
        ) : "failed" in details ? (
          <div role="status" className="callout warning">
            Eva could not read the details: {details.failed}
          </div>
        ) : (
          <>
            {fields === null ? (
              <DetailFold title="Input" text={details.input} missing={missingDetail("input", live)} />
            ) : (
              <details className="step-detail" open>
                <summary>Input</summary>
                {fields.fields.length === 0 ? (
                  <p className="muted">Empty.</p>
                ) : (
                  <dl className="step-fields">
                    {fields.fields.map(({ key, value }) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>
                          <pre>{value}</pre>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </details>
            )}
            <DetailFold title="Output" text={details.output} missing={missingDetail("output", live)} open />
          </>
        ))}
    </Dialog>
  );
}

function DetailFold({
  title,
  text,
  missing,
  open = false,
}: {
  readonly title: string;
  readonly text: string | undefined;
  /** Why the part has no text. */
  readonly missing: string;
  readonly open?: boolean;
}): ReactElement {
  return (
    <details className="step-detail" open={open}>
      <summary>{title}</summary>
      {text === undefined || text === "" ? (
        <p className="muted">{text === "" ? "Empty." : missing}</p>
      ) : (
        <pre>{text}</pre>
      )}
    </details>
  );
}
