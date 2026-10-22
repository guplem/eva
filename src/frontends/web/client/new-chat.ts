/**
 * The words of an empty chat: EVE's greeting, and the suggestions that show what Eva does well.
 * Each suggestion is a request that Eva can do today, with the vault's notes, skills and tools.
 */
import type { ChatBlocker } from "./api.ts";
import type { IconName } from "./icons.tsx";
import { settingsHash } from "./settings-routes.ts";

export interface Suggestion {
  /** The request that a tap sends. */
  readonly title: string;
  /** What Eva does with it, in one line. */
  readonly detail: string;
  readonly icon: IconName;
}

/** The greeting for an hour of the person's day, from 0 to 23. */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning.";
  if (hour >= 12 && hour < 18) return "Good afternoon.";
  return "Good evening.";
}

const notes: Suggestion = {
  title: "Summarize yesterday's notes",
  detail: "Reads the vault and tells you what is new",
  icon: "file",
};
const calendar: Suggestion = {
  title: "What do I have this week?",
  detail: "Checks the calendar and the tasks",
  icon: "calendar",
};
// Eva makes the project's folder from the vault's rules. She cannot make a repository yet.
const project: Suggestion = { title: "Create a project", detail: "Makes its folder in the vault", icon: "briefcase" };
const reminder: Suggestion = {
  title: "Remind me of something",
  detail: "Sets a schedule that messages you",
  icon: "clock",
};

/** The calendar needs the Google tools, so it shows only when Google is set up. */
export function suggestions(googleReady: boolean): readonly Suggestion[] {
  return googleReady ? [notes, calendar, project, reminder] : [notes, project, reminder];
}

/** The words and the link of a chat that cannot answer until a setup step is done. */
export interface SetupBlock {
  readonly sentence: string;
  /** The main button, which opens the step. */
  readonly action: string;
  /** The line under the locked message box. */
  readonly composerLine: string;
  readonly address: string;
}

const blocks: Readonly<
  Record<ChatBlocker, { readonly sentence: string; readonly action: string; readonly address: string }>
> = {
  engine: {
    sentence: "Eva needs an AI engine before she can answer.",
    action: "Set up an AI engine",
    address: settingsHash({ section: "setup", item: "engine" }),
  },
  vault: {
    sentence: "Eva needs your vault before she can answer.",
    action: "Set up your vault",
    address: settingsHash({ section: "setup", item: "vault" }),
  },
  // The engine reads a login at start, so a login saved since then waits for a restart.
  restart: {
    sentence: "Eva needs a restart before she can use the new login.",
    action: "Restart Eva",
    address: settingsHash({ section: "updates", item: "restart" }),
  },
};

export function setupBlock(blocker: ChatBlocker): SetupBlock {
  const block = blocks[blocker];
  return { ...block, composerLine: `${block.action} to send a message.` };
}

/** The kind of answer that a fact question takes. */
export type FactAnswer = "date" | "text";

/**
 * A special suggestion that asks the person for a fact that Eva still needs. A tap opens a small
 * form, and the answer goes to Eva in a message, so Eva saves it with her `about-me` skill.
 */
export interface FactQuestion {
  readonly title: string;
  readonly detail: string;
  readonly answer: FactAnswer;
  /** The label of the form's field. */
  readonly label: string;
  /** The message to Eva, with the person's answer in it. */
  readonly message: (answer: string) => string;
}

const factQuestions: Readonly<Record<"birthDate" | "region", FactQuestion>> = {
  birthDate: {
    title: "Hey Eva! I was born on…",
    detail: "Tell Eva your birthday",
    answer: "date",
    label: "Your birthday",
    message: (answer) =>
      `Hey Eva, I was born on ${answer}. Save it as my birthDate in Life/About me.md with the about-me skill.`,
  },
  region: {
    title: "Hey Eva! I live in…",
    detail: "Tell Eva where you live",
    answer: "text",
    label: "Your city and country",
    message: (answer) =>
      `Hey Eva, I live in ${answer}. Save my region, hemisphere and home place in Life/About me.md with the about-me skill.`,
  },
};

/** The question for the most useful fact that Eva still needs, or null when she has them all. */
export function factQuestion(missing: readonly string[]): FactQuestion | null {
  const first = missing.find((key): key is "birthDate" | "region" => key === "birthDate" || key === "region");
  return first === undefined ? null : factQuestions[first];
}
