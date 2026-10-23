/**
 * The Setup pages. The overview lists each step with its state, and a step page explains the step
 * in plain words, shows its controls, and leads to the next step.
 */
import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { api, type ProgressStep } from "./api.ts";
import { ClaudeCodeCard } from "./EnginesSection.tsx";
import { DevicesPanel } from "./DevicesPanel.tsx";
import { GitHubCard, TelegramCard } from "./ConnectionsSection.tsx";
import { GooglePanel } from "./GooglePanel.tsx";
import { DevicesGuide, PhoneAccess } from "./AccessSection.tsx";
import { Icon } from "./icons.tsx";
import { RichText, StatusIcon, StatusPill, TestMark, type SettingsContext } from "./SettingsParts.tsx";
import { needsYou, nextToDo, setupSummary, stepMark, type StepMark } from "./setup-summary.ts";
import { VaultFolderCard } from "./VaultSection.tsx";
import { ButtonSpinner, CardsSkeleton, ProgressBar } from "./Loading.tsx";

// A step that is left is work for the person, not an error: only a failed test is red.
const calloutTone: Readonly<Record<StepMark, string>> = {
  done: "success",
  missing: "warning",
  optional: "",
  failed: "danger",
};

/** Why each step matters, in words for a person who is new to all of this. */
const whyItMatters: Readonly<Record<ProgressStep["key"], string>> = {
  engine:
    "Eva thinks with an AI engine, such as Claude Code. She needs your own login to it. Without one, she cannot answer.",
  vault: "The vault is the folder of your notes. Eva reads it and writes to it, and keeps it safe in git.",
  remoteAccess: "Phone access lets you open Eva on your phone, also away from home. It uses Tailscale, which is free.",
  device: "Each phone or computer asks once to open Eva. You allow it, so nobody else gets in.",
  github: "Your vault and your projects may live in private GitHub repositories.",
  telegram: "With a Telegram bot, you can chat with Eva from the Telegram app.",
  google: "With Google, Eva can read your calendar, files, contacts and tasks.",
};

/** The ring of done steps, with the steps that are left. The Settings home page shows it too. */
export function SetupRing({
  steps,
  children,
}: {
  readonly steps: readonly ProgressStep[];
  /** The line under the headline. */
  readonly children?: ReactNode;
}): ReactElement {
  const summary = setupSummary(steps);
  const ring = { "--ring-fill": `${String(summary.percent)}%` } as CSSProperties;
  return (
    <div className="setup-ring-row">
      <div
        className="setup-ring"
        style={ring}
        role="img"
        aria-label={`${String(summary.done)} of ${String(summary.total)} steps done`}
      >
        <b>
          {summary.done}/{summary.total}
        </b>
      </div>
      <div className="setup-ring-text">
        <strong>{summary.headline}</strong>
        {children}
      </div>
    </div>
  );
}

function RestartCallout({ context }: { readonly context: SettingsContext }): ReactElement | null {
  if (context.setup?.restartNeeded !== true) return null;
  return (
    <div className="callout warning callout-action">
      <span>Eva uses the changes after a restart.</span>
      <button className="primary" onClick={context.askRestart}>
        Restart now
      </button>
    </div>
  );
}

export function SetupOverview({ context }: { readonly context: SettingsContext }): ReactElement {
  const setup = context.setup;
  if (setup === null) return <CardsSkeleton label="Loading the setup…" cards={2} />;
  const steps = setup.progress;
  const next = nextToDo(steps);
  return (
    <>
      <section className="card setup-hero" aria-label="Progress list">
        <SetupRing steps={steps}>
          <span className="field-hint">
            Each step has its own page with what to do. A step marked Optional adds more, but Eva works without it.
          </span>
        </SetupRing>
        {next !== undefined && (
          <div className="button-row">
            <button className="primary large" onClick={() => context.navigate({ section: "setup", item: next.key })}>
              Continue: {next.title}
              <Icon name="back" className="flip" />
            </button>
          </div>
        )}
        <RestartCallout context={context} />
        <ol className="setup-step-list">
          {steps.map((step, index) => (
            <li key={step.key}>
              <StepLink step={step} number={index + 1} isNext={step === next} context={context} />
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function StepLink({
  step,
  number,
  isNext,
  context,
}: {
  readonly step: ProgressStep;
  readonly number: number;
  /** The first step to do. It shows the main action, as in the EVE capture. */
  readonly isNext: boolean;
  readonly context: SettingsContext;
}): ReactElement {
  const last = step.lastCheck;
  const mark = stepMark(step);
  return (
    <button className={`step-link ${mark}`} onClick={() => context.navigate({ section: "setup", item: step.key })}>
      <StatusIcon state={mark} />
      <span className="step-link-text">
        <span className="step-link-title">
          <span className="step-number">Step {String(number)}</span> {step.title}
        </span>
        <span className="field-hint">
          {/* A step that needs the person says so in few words; its page has the whole guide. */}
          {step.state === "missing" ? "Open this step to see what to do." : <RichText text={step.detail} />}
        </span>
        {last !== null && (
          <span className={last.ok ? "check-result ok" : "check-result failed"}>
            <TestMark ok={last.ok} detail={`Last test: ${last.detail}`} />
          </span>
        )}
      </span>
      {isNext ? (
        <span className="step-action" aria-hidden="true">
          Set up
        </span>
      ) : (
        <StatusPill state={mark} />
      )}
      <Icon name="back" className="chevron flip" />
    </button>
  );
}

export function SetupStepPage({
  context,
  stepKey,
}: {
  readonly context: SettingsContext;
  readonly stepKey: string;
}): ReactElement {
  const setup = context.setup;
  if (setup === null) return <CardsSkeleton label="Loading the setup…" cards={2} />;
  const steps = setup.progress;
  const index = steps.findIndex((step) => step.key === stepKey);
  const step = steps[index];
  if (step === undefined) return <div className="empty">This setup step does not exist.</div>;
  const previous = steps[index - 1];
  const next = steps[index + 1];
  return (
    <>
      <nav className="stepper" aria-label="Setup steps">
        {steps.map((each, position) => (
          <button
            key={each.key}
            className={`stepper-dot ${stepMark(each)}`}
            aria-current={each.key === step.key ? "step" : undefined}
            aria-label={`Step ${String(position + 1)}: ${each.title}`}
            onClick={() => context.navigate({ section: "setup", item: each.key })}
          >
            {stepMark(each) === "done" ? (
              <Icon name="check" />
            ) : stepMark(each) === "failed" ? (
              <Icon name="x" label="Failed" />
            ) : (
              String(position + 1)
            )}
          </button>
        ))}
      </nav>
      <StepHeader step={step} number={index + 1} total={steps.length} context={context} />
      <RestartCallout context={context} />
      <StepBody stepKey={step.key} context={context} />
      <div className="step-footer">
        {previous !== undefined ? (
          <button onClick={() => context.navigate({ section: "setup", item: previous.key })}>
            <Icon name="back" />
            Back
          </button>
        ) : (
          <span />
        )}
        {next !== undefined ? (
          <button className="primary" onClick={() => context.navigate({ section: "setup", item: next.key })}>
            {needsYou(step) ? "Skip for now" : "Next step"}
            <Icon name="back" className="flip" />
          </button>
        ) : (
          <button className="primary" onClick={() => context.navigate({ section: "setup", item: null })}>
            Back to the setup list
          </button>
        )}
      </div>
    </>
  );
}

function StepHeader({
  step,
  number,
  total,
  context,
}: {
  readonly step: ProgressStep;
  readonly number: number;
  readonly total: number;
  readonly context: SettingsContext;
}): ReactElement {
  const [testing, setTesting] = useState(false);
  const check = step.check;
  const test = async (): Promise<void> => {
    if (check === null) return;
    setTesting(true);
    try {
      await api.check(check);
    } catch {
      // The step shows the result that the server kept, or the step as it was.
    } finally {
      setTesting(false);
      context.noteAndReload(`Tested: ${step.title}.`);
    }
  };
  const last = step.lastCheck;
  const mark = stepMark(step);
  return (
    <section className={`card step-header ${mark}`} aria-label={step.title}>
      <StatusIcon state={mark} size="large" />
      <div className="step-header-text">
        <span className="step-number">
          Step {String(number)} of {String(total)}
        </span>
        <h2>{step.title}</h2>
        <p>{whyItMatters[step.key]}</p>
        <div className={`callout ${calloutTone[mark]}`}>
          <StatusPill state={mark} />{" "}
          {mark === "failed" ? (
            "The last test failed. Follow the steps below to fix it, then press Test this step."
          ) : mark === "missing" ? (
            check === null ? (
              "Follow the steps below. Eva sees each change by herself."
            ) : (
              "Follow the steps below, then press Test this step."
            )
          ) : (
            <RichText text={step.detail} />
          )}
        </div>
        {last !== null && (
          <div className={last.ok ? "check-result ok" : "check-result failed"}>
            <TestMark ok={last.ok} detail={`Last test: ${last.detail}`} />
          </div>
        )}
        {testing && <ProgressBar label={`Testing ${step.title}…`} />}
        {check !== null && (
          <div className="button-row">
            <button
              aria-label={`Test ${step.title}`}
              disabled={testing}
              aria-busy={testing}
              onClick={() => void test()}
            >
              {testing && <ButtonSpinner />}
              {testing ? "Testing…" : "Test this step"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** The controls that finish a step: the same cards as in their own section. */
function StepBody({
  stepKey,
  context,
}: {
  readonly stepKey: ProgressStep["key"];
  readonly context: SettingsContext;
}): ReactElement {
  switch (stepKey) {
    case "engine":
      return (
        <>
          <ClaudeCodeCard context={context} />
          <button className="link-button" onClick={() => context.navigate({ section: "engines", item: "pi" })}>
            Use another provider with pi instead
          </button>
        </>
      );
    case "vault":
      return <VaultFolderCard context={context} />;
    case "remoteAccess":
      return <PhoneAccess context={context} />;
    case "device":
      return (
        <>
          <DevicesGuide />
          <DevicesPanel onChanged={context.notify} onLoggedOut={context.onLoggedOut} />
        </>
      );
    case "github":
      return <GitHubCard context={context} />;
    case "telegram":
      return <TelegramCard context={context} />;
    case "google":
      return <GooglePanel context={context} />;
  }
}
