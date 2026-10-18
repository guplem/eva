/** The setup progress list at the top of Settings: each step done, missing or optional, with what to do. */
import { useState, type ReactElement } from "react";
import { api, type ProgressStep } from "./api.ts";

const marks: Readonly<Record<ProgressStep["state"], string>> = { done: "✓", missing: "✗", optional: "○" };

/** `onChanged` loads the list again, so a Test result shows in it. */
export function SetupProgress({
  steps,
  onChanged,
}: {
  steps: readonly ProgressStep[];
  onChanged: () => void;
}): ReactElement {
  const missing = steps.filter((step) => step.state === "missing").length;
  return (
    <fieldset aria-label="Progress list">
      <legend>
        {missing === 0 ? "Setup is complete" : `Setup: ${String(missing)} of ${String(steps.length)} steps left`}
      </legend>
      <div className="hint">
        Each step saves at once, here or in <code>eva setup</code> on Eva&apos;s computer. A step marked ○ is optional.
      </div>
      {steps.map((step) => (
        <StepRow key={step.key} step={step} onChanged={onChanged} />
      ))}
    </fieldset>
  );
}

function StepRow({ step, onChanged }: { step: ProgressStep; onChanged: () => void }): ReactElement {
  const [isTesting, setIsTesting] = useState(false);
  const check = step.check;
  const test = async (): Promise<void> => {
    if (check === null) return;
    setIsTesting(true);
    try {
      await api.check(check);
    } catch {
      // The list shows the result that the server kept, or the step as it was.
    } finally {
      setIsTesting(false);
      onChanged();
    }
  };
  const last = step.lastCheck;
  return (
    <div className="check-row" data-state={step.state}>
      <span role="img" aria-label={step.state}>
        {marks[step.state]}
      </span>
      <span style={{ flex: 1 }}>
        <strong>{step.title}</strong>
        <br />
        <span className="hint">{step.detail}</span>
        {last !== null && (
          <>
            <br />
            <span className={last.ok ? "ok" : "failed"}>
              {last.ok ? "✓" : "✗"} Last test: {last.detail}
            </span>
          </>
        )}
      </span>
      {check !== null && (
        <button aria-label={`Test ${step.title}`} disabled={isTesting} onClick={() => void test()}>
          {isTesting ? "Testing…" : "Test"}
        </button>
      )}
    </div>
  );
}
