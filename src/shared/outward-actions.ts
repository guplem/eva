/**
 * Which tool calls reach other people. Assistant mode asks the person
 * before these and runs every other call at once. Each engine adapter uses this one rule, so
 * Claude Code and pi ask for the same actions. Tool names differ in case between the two
 * engines (`Bash` and `bash`), so the shell tool is matched without case.
 */
import type { ToolCategory } from "./events.ts";

/** Shell commands that publish, push or send. */
const outwardCommandPattern =
  /\b(git\s+push|gh\s+(issue|pr|release|gist)\s+(create|comment|edit|close|merge)|gh\s+api\b.*-X\s*(POST|PATCH|PUT|DELETE)|curl\b.*-X\s*(POST|PUT|PATCH|DELETE))/i;
const outwardMcpPattern = /^mcp__.*(send|share|invite|post|reply|forward|permission|access|comment|reaction)/i;
/** A calendar event reaches other people only when it has guests or sends updates. */
const calendarEventToolPattern = /^mcp__.*manage_event$/;

export function reachesOtherPeople(toolName: string, input: Readonly<Record<string, unknown>>): boolean {
  const command = typeof input["command"] === "string" ? input["command"] : "";
  return (
    (isShellTool(toolName) && outwardCommandPattern.test(command)) ||
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
