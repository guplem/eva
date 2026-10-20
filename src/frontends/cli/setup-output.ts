/**
 * The look of `eva setup` in a terminal: numbered steps, a mark for what is done, a clear line
 * when setup waits for the person, and a mark on each question. Plain ASCII, so every terminal
 * shows it the same, a Windows console with an old code page too.
 */

/** The steps of `eva setup`, in their order. */
export const setupSteps = [
  "Programs",
  "Phone access",
  "Start Eva",
  "Your devices",
  "Notebook and GitHub",
  "AI login",
  "Telegram",
  "Google and voice notes",
] as const;

export type SetupStep = (typeof setupSteps)[number];

const optionalSteps: ReadonlySet<SetupStep> = new Set(["Telegram", "Google and voice notes"]);

/** A blank line, then "Step 3 of 8: Start Eva". */
export function stepLines(step: SetupStep): string[] {
  const number = setupSteps.indexOf(step) + 1;
  const optional = optionalSteps.has(step) ? " (optional)" : "";
  return ["", `Step ${String(number)} of ${String(setupSteps.length)}: ${step}${optional}`];
}

/** A line for something that is done. */
export function doneLine(text: string): string {
  return `  [ok] ${text}`;
}

/** A line for something that needs the person, but does not stop setup. */
export function noteLine(text: string): string {
  return `  ${text}`;
}

/** The lines while setup waits for the person to act somewhere else, such as in a browser. */
export function yourTurnLines(action: string): string[] {
  return [
    "",
    `  >> Your turn: ${action}`,
    "     Setup goes on by itself when you are done. Ctrl+C stops setup, and loses nothing.",
  ];
}

/** A question, marked so that it stands out from the lines around it. */
export function questionText(question: string): string {
  return `> ${question}`;
}
