/**
 * Which outward actions a tool call does: those that reach other people, and changes to the
 * schedules. The person sets a level for each category: allow, ask or deny. Assistant mode runs
 * every other call at once. Each engine adapter uses this one rule, so Claude Code and pi treat
 * the same actions alike. Tool names differ in case between the two engines (`Bash` and `bash`),
 * so they are matched without case.
 */
import type { ToolCategory } from "./events.ts";

/** Shell commands that push code. */
const pushCodePattern = /\bgit\s+push/i;
/** Shell commands that publish on GitHub. */
const githubPattern = /\bgh\s+(issue|pr|release|gist)\s+(create|comment|edit|close|merge)/i;
/**
 * The rest of one command: it stops at an unquoted `|`, `;`, `&` or new line, so a flag of the
 * next command does not count. A continued line, an escaped character, a redirect such as `2>&1`,
 * quoted text and a command in `$(...)` or backticks do not end it. A lone quote also does not end
 * it, so a typo cannot hide a flag. Each text has only one way to match: overlapping choices make
 * a failed match take seconds.
 */
const commandPart = String.raw`(?:\\\r\n|\\[\s\S]|>&|(?<!>)&>|[^|;&\n'"\\$\`]|'[^']*'|'(?![^']*')|"(?:\\[\s\S]|[^"\\])*"|"(?!(?:\\[\s\S]|[^"\\])*")|\$\([^)]*\)|\$(?!\([^)]*\))|\`[^\`]*\`|\`(?![^\`]*\`))`;
const commandRest = `${commandPart}*?`;
const commandEnd = new RegExp(`${commandPart}*`, "y");
/** A flag follows a space. After a continued line with no indent, only the new line is left. */
const flagStart = String.raw`(?<=\s)`;
/** Each method except GET and HEAD asks, so an unknown method, such as `$METHOD`, fails safe. */
const sendingMethod = String.raw`(?!["']?(?:GET|HEAD)\b)\S`;
/** `-XPOST`, `-X POST` or `-X=POST`. Each form has one way to match, so `-X=GET` reads as GET. */
const shortMethodFlag = String.raw`-[A-Za-z]*X(?:=|\s+|(?![\s=]))${sendingMethod}`;
// curl and gh api send a POST by themselves when the command carries data (issue #451). Short
// flags can share one dash (`-sd`) and take an attached value (`-d@file`). Case matters:
// `curl -f` only fails on an error, but `curl -F` sends a form. curl takes a unique start of a
// long option (`--jso`), and from version 8.3 an `--expand-` form of each option. A config file
// (`-K`) can hold data.
const curlSends = {
  start: /\bcurl\b/g,
  flag: new RegExp(
    String.raw`${commandRest}${flagStart}(?:-[A-Za-z]*[dFTK]|--(?:expand-)?(?:da|js|form|up|conf)[\w-]*(?=[\s=]|$)|${shortMethodFlag}|--req(?:u(?:e(?:st?)?)?)?(?:=|\s+)${sendingMethod})`,
    "y",
  ),
};
// gh takes global flags, such as `--repo`, before `api`.
const ghApiSends = {
  start: /\bgh(?:\.exe)?(?:\s+-\S+(?:\s+(?:'[^']*'|"[^"]*"|[^\s'"-]\S*))?)*?\s+api\b/g,
  flag: new RegExp(
    String.raw`${commandRest}${flagStart}(?:-[A-Za-z]*[fF]|--(?:field|raw-field|input)(?=[\s=]|$)|${shortMethodFlag}|--method(?:=|\s+)${sendingMethod})`,
    "y",
  ),
};

/**
 * Tests the flags of each command that the program starts. The search then goes on after the end
 * of that command: a new search from each later `curl` word in the same command took seconds.
 */
function programSends(command: string, program: { start: RegExp; flag: RegExp }): boolean {
  program.start.lastIndex = 0;
  for (let found = program.start.exec(command); found; found = program.start.exec(command)) {
    program.flag.lastIndex = program.start.lastIndex;
    if (program.flag.test(command)) return true;
    commandEnd.lastIndex = program.start.lastIndex;
    commandEnd.exec(command);
    program.start.lastIndex = Math.max(commandEnd.lastIndex, program.start.lastIndex);
  }
  return false;
}
/** Claude Code's file tools take `file_path`; pi's `write` and `edit` take `path`. */
const fileChangeToolPattern = /^(write|edit|multiedit)$/i;
const schedulesFilePattern = /\.eva[\\/]schedules\.json/i;
/** The vault settings file, and the path before the migration that moved it. */
const settingsFilePattern = /\.eva[\\/]settings(?:[\\/]settings)?\.json/i;
const settingsSetPattern = /\bsettings\s+set\s+outwardActions\b/i;
/** Eva's own Google server. Only these exact tools reach other people: a word pattern asked for read-only tools too (#910). */
const driveSharingTools = new Set(["mcp__google__set_drive_file_permissions", "mcp__google__manage_drive_access"]);
const sendEmailTool = "mcp__google__send_gmail_message";
const calendarEventTool = "mcp__google__manage_event";

export const outwardActionCategories = [
  "pushCode",
  "github",
  "shareDriveFile",
  "sendEmail",
  "calendarInvitations",
  "sendData",
  "changeSchedules",
] as const;

export type OutwardActionCategory = (typeof outwardActionCategories)[number];
export type OutwardActionLevel = "allow" | "ask" | "deny";
export const outwardActionLevelValues: readonly OutwardActionLevel[] = ["allow", "ask", "deny"];
export type OutwardActionLevels = Readonly<Record<OutwardActionCategory, OutwardActionLevel>>;

/** The categories in plain words, for Settings, the approval dialog and the prompt. Change them with the rules above. */
export const outwardActionWords: Readonly<Record<OutwardActionCategory, { title: string; covers: string }>> = {
  pushCode: { title: "Push code", covers: "git push" },
  github: {
    title: "GitHub: issues and pull requests",
    covers: "Create, comment on, edit, close or merge an issue, pull request, release or gist with gh",
  },
  shareDriveFile: {
    title: "Share a Google Drive file",
    covers: "Change who can open a file in Google Drive",
  },
  sendEmail: { title: "Send an email", covers: "Send a message with Gmail" },
  calendarInvitations: {
    title: "Calendar invitations",
    covers: "A calendar event with guests or updates, and an answer to an invitation",
  },
  sendData: {
    title: "Send data over the network",
    covers: "curl or gh api with data, with a file upload or with a request method other than GET or HEAD",
  },
  changeSchedules: {
    title: "Change the schedules",
    covers: "A change to .eva/schedules.json, also a shell command that names that file",
  },
};

/** The one fixed question that has no level: a change by the agent to the levels themselves. */
export const outwardLevelChangeWords =
  "A change to these levels in the vault settings file, by a shell command or a file tool";

/**
 * The categories of one tool call, in the order of `outwardActionCategories`. A schedule with a
 * `prompt` runs a full turn later, on its own. So a message with hidden instructions must not add
 * one without the person (issue #440).
 */
export function outwardActionsOf(toolName: string, input: Readonly<Record<string, unknown>>): OutwardActionCategory[] {
  const command = stringField(input, "command");
  const shell = isShellTool(toolName);
  const found: Record<OutwardActionCategory, boolean> = {
    pushCode: shell && pushCodePattern.test(command),
    github: shell && githubPattern.test(command),
    shareDriveFile: driveSharingTools.has(toolName),
    sendEmail: toolName === sendEmailTool,
    calendarInvitations: toolName === calendarEventTool && eventReachesOthers(input),
    sendData: shell && (programSends(command, curlSends) || programSends(command, ghApiSends)),
    changeSchedules: changesSchedules(toolName, input),
  };
  return outwardActionCategories.filter((category) => found[category]);
}

/**
 * True when a call changes the levels: it names the vault settings file, by a file tool or the
 * shell, or runs `settings set outwardActions`. Without this question, a hidden instruction could
 * set a level to Allow first. A shell command that only reads the file also counts: telling a
 * read from a write is guesswork.
 */
export function changesActionLevels(toolName: string, input: Readonly<Record<string, unknown>>): boolean {
  if (isShellTool(toolName)) {
    const command = stringField(input, "command");
    return settingsFilePattern.test(command) || settingsSetPattern.test(command);
  }
  if (!fileChangeToolPattern.test(toolName)) return false;
  return settingsFilePattern.test(stringField(input, "file_path") || stringField(input, "path"));
}

export interface OutwardActionDecision {
  readonly level: OutwardActionLevel;
  /** On `deny`: the categories on Deny. On `ask`: the categories on Ask. Empty for a change to the levels. */
  readonly categories: OutwardActionCategory[];
}

/** The strictest level wins: deny, then ask, then allow. */
export function decideOutwardAction(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  levels: OutwardActionLevels,
): OutwardActionDecision {
  const found = outwardActionsOf(toolName, input);
  const denied = found.filter((category) => levels[category] === "deny");
  if (denied.length > 0) return { level: "deny", categories: denied };
  const asked = found.filter((category) => levels[category] === "ask");
  if (asked.length > 0 || changesActionLevels(toolName, input)) return { level: "ask", categories: asked };
  return { level: "allow", categories: [] };
}

/**
 * The category lines for Settings, by level. The fixed question about a change to the levels is
 * always an ask, so it joins the asks.
 */
export function outwardActionWordsByLevel(levels: OutwardActionLevels): Record<OutwardActionLevel, string[]> {
  const lines = (level: OutwardActionLevel): string[] =>
    outwardActionCategories
      .filter((category) => levels[category] === level)
      .map((category) => `${outwardActionWords[category].title}: ${outwardActionWords[category].covers}`);
  return { allow: lines("allow"), ask: [...lines("ask"), outwardLevelChangeWords], deny: lines("deny") };
}

/** Every category on Ask: the levels that a person gets with no choice made. */
export const defaultOutwardActionLevels: OutwardActionLevels = Object.fromEntries(
  outwardActionCategories.map((category) => [category, "ask"]),
) as OutwardActionLevels;

function changesSchedules(toolName: string, input: Readonly<Record<string, unknown>>): boolean {
  // A shell command that only reads the file also counts: telling a read from a write is guesswork.
  if (isShellTool(toolName)) return schedulesFilePattern.test(stringField(input, "command"));
  if (!fileChangeToolPattern.test(toolName)) return false;
  return schedulesFilePattern.test(stringField(input, "file_path") || stringField(input, "path"));
}

function stringField(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

/** Each adapter tags its tool calls with this one rule, so the core knows no engine's tool names. */
export function toolCategory(name: string): ToolCategory {
  return isShellTool(name) ? "command" : "tool";
}

/** One line that says what a tool call does, for an approval button or an activity chip. */
export function summarizeToolCall(name: string, input: unknown): string {
  const fields = (input ?? {}) as Record<string, unknown>;
  for (const key of ["command", "file_path", "path", "pattern", "url", "description", "skill"]) {
    const value = fields[key];
    if (typeof value === "string") return isShellTool(name) ? value : `${name} ${value}`;
  }
  return JSON.stringify(input);
}

function isShellTool(name: string): boolean {
  return name.toLowerCase() === "bash";
}

function eventReachesOthers(input: Readonly<Record<string, unknown>>): boolean {
  const attendees = input["attendees"];
  const hasGuests = Array.isArray(attendees) ? attendees.length > 0 : typeof attendees === "string" && attendees !== "";
  const sendsUpdates = input["send_updates"] === "all" || input["send_updates"] === "externalOnly";
  return hasGuests || sendsUpdates || input["action"] === "rsvp";
}
