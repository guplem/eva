/**
 * The Setup pages. The overview lists each step with its state, and a step page explains the step
 * in plain words, shows its controls, and leads to the next step.
 */
import { useState, type ReactElement } from "react";
import { api, type ProgressStep } from "./api.ts";
import { ClaudeCodeCard } from "./EnginesSection.tsx";
import { DevicesPanel } from "./DevicesPanel.tsx";
import { GitHubCard, TelegramCard } from "./ConnectionsSection.tsx";
import { GooglePanel } from "./GooglePanel.tsx";
import { DevicesGuide, PhoneAccess } from "./AccessSection.tsx";
import { Icon } from "./icons.tsx";
import { RichText, StatusIcon, StatusPill, TestMark, type SettingsContext } from "./SettingsParts.tsx";
import { VaultFolderCard } from "./VaultSection.tsx";

/** Why each step matters, in words for a person who is new to all of this. */
const whyItMatters: Readonly<Record<ProgressStep["key"], string>> = {
  engine:
    "Eva thinks with an AI engine, such as Claude Code. She needs your own login to it. Without one, she cannot answer.",
  vault: "The vault is the folder of your notes. Eva reads it and writes to it, and keeps it safe in git.",
  remoteAccess: "Phone access lets you open Eva on your phone, also away from home. It uses Tailscale, which is free.",
  device: "Each phone or computer asks once to open Eva. You allow it, so nobody else gets in.",
  github: "With a GitHub token, Eva can reach a private vault and your private projects.",
  telegram: "With a Telegram bot, you can chat with Eva from the Telegram app.",
  google: "With Google, Eva can read your calendar, files, contacts and tasks.",
};

export function nextMissing(steps: readonly ProgressStep[]): ProgressStep | undefined {
  return steps.find((step) => step.state === "missing");
}

/** The bar and the count at the top of the setup pages. */
function ProgressSummary({ steps }: { readonly steps: readonly ProgressStep[] }): ReactElement {
  const done = steps.filter((step) => step.state === "done").length;
  const missing = steps.filter((step) => step.state === "missing").length;
  return (
    <div className="progress-summary">
      <div className="progress-text">
        <strong>
          {missing === 0
            ? "Setup is complete"
            : `${String(missing)} ${missing === 1 ? "step needs" : "steps need"} you`}
        </strong>
        <span className="field-hint">
          {String(done)} of {String(steps.length)} done
        </span>
      </div>
      <div className="progress-bar" aria-hidden="true">
        {steps.map((step) => (
          <span key={step.key} className={`progress-segment ${step.state}`} />
        ))}
      </div>
    </div>
  );
}

function RestartCallout({ context }: { readonly context: SettingsContext }): ReactElement | null {
  if (context.setup?.restartNeeded !== true) return null;
  return (
    <div className="callout warning callout-action">
      <span>Eva uses the new tokens after a restart.</span>
      <button className="primary" onClick={() => void context.restartNow()}>
        Restart now
      </button>
    </div>
  );
}

export function SetupOverview({ context }: { readonly context: SettingsContext }): ReactElement {
  const setup = context.setup;
  if (setup === null) return <div className="empty">Loading the setup…</div>;
  const steps = setup.progress;
  const next = nextMissing(steps);
  return (
    <>
      <section className="card setup-hero" aria-label="Progress list">
        <ProgressSummary steps={steps} />
        <p className="card-description">
          Each step has its own page with what to do. A step marked Optional adds more, but Eva works without it.
        </p>
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
              <StepLink step={step} number={index + 1} context={context} />
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
  context,
}: {
  readonly step: ProgressStep;
  readonly number: number;
  readonly context: SettingsContext;
}): ReactElement {
  const last = step.lastCheck;
  return (
    <button
      className={`step-link ${step.state}`}
      onClick={() => context.navigate({ section: "setup", item: step.key })}
    >
      <StatusIcon state={step.state} />
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
      <StatusPill state={step.state} />
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
  if (setup === null) return <div className="empty">Loading the setup…</div>;
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
            className={`stepper-dot ${each.state}`}
            aria-current={each.key === step.key ? "step" : undefined}
            aria-label={`Step ${String(position + 1)}: ${each.title}`}
            onClick={() => context.navigate({ section: "setup", item: each.key })}
          >
            {each.state === "done" ? <Icon name="check" /> : String(position + 1)}
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
            {step.state === "missing" ? "Skip for now" : "Next step"}
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
  return (
    <section className={`card step-header ${step.state}`} aria-label={step.title}>
      <StatusIcon state={step.state} size="large" />
      <div className="step-header-text">
        <span className="step-number">
          Step {String(number)} of {String(total)}
        </span>
        <h2>{step.title}</h2>
        <p>{whyItMatters[step.key]}</p>
        <div
          className={
            step.state === "done" ? "callout success" : step.state === "missing" ? "callout danger" : "callout"
          }
        >
          <StatusPill state={step.state} />{" "}
          {step.state === "missing" ? (
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
        {check !== null && (
          <div className="button-row">
            <button aria-label={`Test ${step.title}`} disabled={testing} onClick={() => void test()}>
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
