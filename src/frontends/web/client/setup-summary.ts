/**
 * The words and numbers of the setup ring, each step's mark, and the restart question.
 * Pure, so a test covers them without a browser.
 */
import type { ProgressStep } from "./api.ts";

/** A step's round mark. "failed" is not a step state: it comes from the step's last Test. */
export type StepMark = ProgressStep["state"] | "failed";

/**
 * A failed last test wins over "done": the step is set up, but it does not work now.
 * An optional step stays optional, because Eva works without it.
 */
export function stepMark(step: ProgressStep): StepMark {
  return step.lastCheck?.ok === false && step.state !== "optional" ? "failed" : step.state;
}

/** A step to do, or a step whose test failed: both need the person. */
export function needsYou(step: ProgressStep): boolean {
  const mark = stepMark(step);
  return mark === "missing" || mark === "failed";
}

/** The first step that needs the person. Its row and the Continue button lead to it. */
export function nextToDo(steps: readonly ProgressStep[]): ProgressStep | undefined {
  return steps.find(needsYou);
}

export interface SetupSummary {
  readonly done: number;
  readonly total: number;
  /** The steps that need the person: to do, or failed. */
  readonly left: number;
  /** How full the ring is, from 0 to 100. */
  readonly percent: number;
  readonly headline: string;
}

export function setupSummary(steps: readonly ProgressStep[]): SetupSummary {
  const marks = steps.map(stepMark);
  const done = marks.filter((mark) => mark === "done").length;
  const left = steps.filter(needsYou).length;
  const total = steps.length;
  return {
    done,
    total,
    left,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    headline: left === 0 ? "Setup is complete" : `Setup: ${String(left)} ${left === 1 ? "step" : "steps"} left`,
  };
}

/** The question before a restart. It names the running chats, because a restart stops them. */
export function restartQuestion(runningChats: readonly string[]): string {
  const count = runningChats.length;
  if (count === 0) return "Restart Eva now?";
  const names = runningChats.map((name) => `"${name}"`).join(", ");
  const running = count === 1 ? `${names} is running` : `${String(count)} chats are running: ${names}`;
  return `${running}. A restart stops ${count === 1 ? "it" : "them"}. Restart Eva now?`;
}
