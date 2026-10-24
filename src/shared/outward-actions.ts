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
  "Send data with gh api: -f, -F, --field, --raw-field or --input",
  "Send data with curl: -d, --data, --json, -F or --form",
  "Upload a file with curl -T, or read a curl config file with -K",
  "Use curl or gh api with a request method other than GET or HEAD, such as -X POST",
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
      (outwardCommandPattern.test(command) || programSends(command, curlSends) || programSends(command, ghApiSends))) ||
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
