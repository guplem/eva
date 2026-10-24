/**
 * Which tool calls ask the person first: those that reach other people, and changes to the
 * schedules. Assistant mode runs every other call at once. Each engine adapter uses this one
 * rule, so Claude Code and pi ask for the same actions. Tool names differ in case between the
 * two engines (`Bash` and `bash`), so they are matched without case.
 */
import type { ToolCategory } from "./events.ts";

/** Shell commands that publish, push or send. */
const outwardCommandPattern = /\b(git\s+push|gh\s+(issue|pr|release|gist)\s+(create|comment|edit|close|merge))/i;
/**
 * The rest of one command: it stops at an unquoted `|`, `;`, `&` or new line, so a flag of the
 * next command does not count. A continued line, an escaped character, a redirect such as `2>&1`
 * and quoted text do not end it. A lone quote also does not end it, so a typo cannot hide a flag.
 * Each text has only one way to match: overlapping choices make a failed match take seconds.
 */
const commandRest = String.raw`(?:\\\r\n|\\[\s\S]|>&|&>|[^|;&\n'"\\]|'[^']*'|'(?![^']*')|"(?:\\[\s\S]|[^"\\])*"|"(?!(?:\\[\s\S]|[^"\\])*"))*?`;
/** Each method except GET and HEAD asks, so an unknown method, such as `$METHOD`, fails safe. */
const sendingMethod = String.raw`[\s=]*(?!["']?(?:GET|HEAD)\b)\S`;
// curl and gh api send a POST by themselves when the command carries data (issue #451). Short
// flags can share one dash (`-sd`) and take an attached value (`-d@file`). Case matters:
// `curl -f` only fails on an error, but `curl -F` sends a form. curl takes a unique start of a
// long option (`--jso`), and a config file (`-K`) can hold data.
const curlSendsPattern = new RegExp(
  String.raw`\bcurl\b${commandRest}\s(?:-[A-Za-z]*[dFTK]|--(?:da|js|fo|up|conf)[\w-]*(?=[\s=]|$)|(?:-[A-Za-z]*X|--req[\w-]*)${sendingMethod})`,
);
// gh takes global flags, such as `--repo`, before `api`.
const ghApiSendsPattern = new RegExp(
  String.raw`\bgh(?:\.exe)?(?:\s+-\S+(?:\s+[^\s-]\S*)?)*?\s+api\b${commandRest}\s(?:-[A-Za-z]*[fF]|--(?:field|raw-field|input)(?=[\s=]|$)|(?:-[A-Za-z]*X|--method)${sendingMethod})`,
);
const outwardMcpPattern = /^mcp__.*(send|share|invite|post|reply|forward|permission|access|comment|reaction)/i;
/** A calendar event reaches other people only when it has guests or sends updates. */
const calendarEventToolPattern = /^mcp__.*manage_event$/;
/** Claude Code's file tools take `file_path`; pi's `write` and `edit` take `path`. */
const fileChangeToolPattern = /^(write|edit|multiedit)$/i;
const schedulesFilePattern = /\.eva[\\/]schedules\.json/i;

/** The actions that `asksThePerson` asks about, in plain words for Settings. Change both together. */
export const askedActionWords: readonly string[] = [
  "Push commits with git push",
  "Create, comment on, edit, close or merge a GitHub issue, pull request, release or gist",
  "Send data with gh api: -f, -F, --field, --raw-field, --input, or a method other than GET or HEAD",
  "Send data with curl: -d, --data, --json, -F, --form, -T (upload a file), -K (a config file), or a method other than GET or HEAD",
  "A tool that sends, shares, invites, posts, replies, forwards, comments, reacts or changes access",
  "A calendar event with guests or updates, and an answer to an invitation",
  "A change to the schedules in .eva/schedules.json, also a shell command that names that file",
];

/**
 * A schedule with a `prompt` runs a full turn later, on its own. So a message with hidden
 * instructions must not add one without the person (issue #440).
 */
export function asksThePerson(toolName: string, input: Readonly<Record<string, unknown>>): boolean {
  return reachesOtherPeople(toolName, input) || changesSchedules(toolName, input);
}

function changesSchedules(toolName: string, input: Readonly<Record<string, unknown>>): boolean {
  // A shell command that only reads the file also asks: telling a read from a write is guesswork.
  if (isShellTool(toolName)) return schedulesFilePattern.test(stringField(input, "command"));
  if (!fileChangeToolPattern.test(toolName)) return false;
  return schedulesFilePattern.test(stringField(input, "file_path") || stringField(input, "path"));
}

function stringField(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function reachesOtherPeople(toolName: string, input: Readonly<Record<string, unknown>>): boolean {
  const command = typeof input["command"] === "string" ? input["command"] : "";
  return (
    (isShellTool(toolName) &&
      (outwardCommandPattern.test(command) || curlSendsPattern.test(command) || ghApiSendsPattern.test(command))) ||
    outwardMcpPattern.test(toolName) ||
    (calendarEventToolPattern.test(toolName) && eventReachesOthers(input))
  );
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
