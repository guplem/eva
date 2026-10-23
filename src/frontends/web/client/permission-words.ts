/** The words around the engines' permission lists on the AI engines page. Pure, so a test covers them. */
import type { EnginePermissions, PermissionChat, PersonPermissionRules } from "../../../shared/permissions.ts";

export const chatTitles: Readonly<Record<PermissionChat, string>> = {
  assistant: "Assistant chats",
  "trusted-project": "Project chats in a trusted clone",
  "untrusted-project": "Project chats in a clone that Eva does not trust",
};

/** Where a file of the person's own rules lives, and which chats read it. */
export function rulesPlaceWords(place: PersonPermissionRules["place"]): string {
  return place === "machine"
    ? "On this machine, for every Claude Code chat"
    : "In your vault, for Assistant chats with Claude Code";
}

/** One line on the state of a rules file, or null when the file holds rules to list. */
export function rulesStateWords(rules: PersonPermissionRules): string | null {
  if (rules.state === "missing") return "This file does not exist. You have no rules here.";
  if (rules.state === "invalid") return "Eva cannot read this file as JSON, so Claude Code may not read it either.";
  return rules.allow.length + rules.ask.length + rules.deny.length === 0 ? "This file has no permission rules." : null;
}

/**
 * The lists show the mode that the running engine uses. A new choice applies after a restart,
 * so until then the two differ.
 */
export function modeWaitsForRestart(running: EnginePermissions["mode"], chosen: string): boolean {
  return running !== null && running.value !== chosen;
}

/**
 * In Assistant chats, Eva's own ask rules send every shell call and every call of her tools to
 * her approval, which lets each local action through. So there, a person's ask rule adds no
 * question, and an allow rule skips none of hers.
 */
export const personRulesHint =
  "Claude Code reads the allow, ask and deny rules in these files. A deny rule always blocks the action. In Assistant chats, Eva decides what to ask: your ask rules add no question, and your allow rules skip none of hers. In Project chats, each rule works as in a terminal.";
