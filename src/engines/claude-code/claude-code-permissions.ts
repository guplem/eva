/**
 * What Claude Code chats may do, in words for Settings. The words follow `buildQueryOptions` and
 * `decidePermission` in claude-code-adapter.ts: change them together.
 */
import { join } from "node:path";
import { readJsonTolerant } from "../../shared/files.ts";
import { outwardActionWords } from "../../shared/outward-actions.ts";
import type {
  ChatPermissions,
  EnginePermissions,
  PermissionContext,
  PersonPermissionRules,
} from "../../shared/permissions.ts";

/** The two modes that a person may pick for Claude Code chats. */
export type ClaudePermissionMode = "auto" | "bypassPermissions";

const modeWords: Readonly<Record<ClaudePermissionMode, string>> = {
  auto: "Auto",
  bypassPermissions: "Bypass permissions",
};

const denyRules = "Each action that one of your deny rules names";
const safetyCheckRefusals = "Each action that the safety check of Claude Code refuses";
// A trusted clone adds its own rules, so a project chat names no owner. The note says whose settings apply.
const anyDenyRule = "Each action that a deny rule names";

export function describeClaudePermissions(mode: ClaudePermissionMode, context: PermissionContext): EnginePermissions {
  return {
    mode: { value: mode, words: modeWords[mode] },
    chats: [assistantChat(mode), projectChat("trusted-project", mode), projectChat("untrusted-project", "auto")],
    personRules: personRules(context),
  };
}

function assistantChat(mode: ClaudePermissionMode): ChatPermissions {
  if (mode === "bypassPermissions") {
    return {
      chat: "assistant",
      runs: ["Every action, also one that reaches other people"],
      asks: [],
      blocks: [denyRules],
      note: null,
    };
  }
  return {
    chat: "assistant",
    runs: [
      "Reading and searching files",
      "Shell commands that stay on this computer",
      "Changes to Eva's own files in .eva/",
      "Eva's own tools, such as Google, when the action stays with you",
      "Each other action that the safety check of Claude Code allows",
    ],
    asks: outwardActionWords,
    blocks: [safetyCheckRefusals, denyRules],
    note: null,
  };
}

function projectChat(chat: "trusted-project" | "untrusted-project", mode: ClaudePermissionMode): ChatPermissions {
  const note =
    chat === "trusted-project"
      ? "Claude Code runs as you would run it in the clone: its own settings, hooks and MCP servers apply."
      : "Always in Auto mode. Only your own settings apply: the clone's settings, hooks and MCP servers are off.";
  if (mode === "bypassPermissions") {
    return { chat, runs: ["Every action"], asks: [], blocks: [anyDenyRule], note };
  }
  return {
    chat,
    runs: ["Each action that the safety check of Claude Code or an allow rule allows"],
    asks: ["Each action that Claude Code asks about in a terminal"],
    blocks: [safetyCheckRefusals, anyDenyRule],
    note,
  };
}

/**
 * Claude Code reads the `user` settings from its config folder in every chat, and the vault's
 * `project` settings in Assistant chats. Eva sets the mode herself, so `defaultMode` is not shown.
 */
function personRules(context: PermissionContext): PersonPermissionRules[] {
  const files: PersonPermissionRules[] = [];
  const configFolder = context.environment["CLAUDE_CONFIG_DIR"];
  if (configFolder !== undefined) files.push(readRules("machine", join(configFolder, "settings.json")));
  if (context.vaultFolder !== null) {
    const rules = readRules("vault", join(context.vaultFolder, ".claude", "settings.json"));
    files.push({ ...rules, file: ".claude/settings.json" });
  }
  return files;
}

function readRules(place: PersonPermissionRules["place"], file: string): PersonPermissionRules {
  const read = readJsonTolerant(file);
  const empty = { place, file, allow: [], ask: [], deny: [] };
  if (!read.ok) return { ...empty, state: read.reason };
  const permissions = recordOf(recordOf(read.value)["permissions"]);
  return {
    place,
    file,
    state: "ok",
    allow: stringsOf(permissions["allow"]),
    ask: stringsOf(permissions["ask"]),
    deny: stringsOf(permissions["deny"]),
  };
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
