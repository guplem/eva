/** The words and marks of a repository setup report, in the marks that Settings uses. */
import type { SetupItem, SetupReport } from "./api.ts";
import type { StepMark } from "./setup-summary.ts";

const marks: Readonly<Record<SetupItem["light"], StepMark | null>> = {
  green: "done",
  yellow: "missing",
  red: "failed",
  // Settings has no mark for a check that did not run, and "optional" would read as "add this".
  grey: null,
};

export function lightMark(light: SetupItem["light"]): StepMark | null {
  return marks[light];
}

/** A full section is done. A section with half or more done needs work, and less than half fails. */
export function scoreMark(score: number): StepMark {
  if (score >= 100) return "done";
  return score >= 50 ? "missing" : "failed";
}

export function reportSummary(report: SetupReport): string {
  const lights = report.sections.flatMap((section) => section.items.map((item) => item.light));
  const unchecked = lights.filter((light) => light === "grey").length;
  const checked = lights.length - unchecked;
  const done = lights.filter((light) => light === "green").length;
  const words: string[] = [];
  if (checked > 0) {
    words.push(
      done === checked ? `All ${String(checked)} items done.` : `${String(done)} of ${String(checked)} items done.`,
    );
  }
  if (unchecked > 0) words.push(`${String(unchecked)} not checked.`);
  return words.join(" ");
}
