/**
 * On 2026-10-20 the person's rules took over Eva's personality: how she answers, learns and writes
 * left the built-in prompt for `.eva/assistant.md`, where the person can change them. A vault made
 * before then has no such sections, so this migration appends them once.
 *
 * The migration is frozen: it holds its own copy of the sections, so a later change to the
 * template never changes what it writes.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Migration } from "./migration-runner.ts";

/**
 * Each section that the built-in prompt held until 2026-10-20, with a phrase that only its own
 * text holds. A heading alone is not enough: a person can have their own "## Learning" about a language.
 */
const movedSections: readonly { readonly marker: string; readonly text: string }[] = [
  {
    marker: "search the vault first",
    text: `## Answering from the notes

For every question, request or task, including the steps inside a bigger one:

1. Search the vault first (grep and glob). Use what you find before general knowledge: the person's own recorded answer fits them, a generic one does not.
2. When the question is about how the person should act, not about what is true, read the principles they wrote down, if the vault has any. If they are about to act against one, say which, then let them decide.
3. Name the file the answer came from.
4. If nothing answers it, say so plainly, say you are falling back on general knowledge, then answer.
5. Watch for knowledge that aged. If what the person says now contradicts a stored note, or a note looks outdated, tell them and propose the update. Never keep both versions silently. A dated record, such as a diary entry or a meeting note, is history and never gets rewritten.
6. If the result of heavy reasoning is worth keeping, propose storing it where \`AGENTS.md\` says.
`,
  },
  {
    marker: "the same thing twice",
    text: `## Learning

The person never has to tell you the same thing twice. When they correct you, or tell you something lasting about themselves, write it down in the same conversation and say where you put it.

- **Store an instruction only if the person marked it as permanent**, with words such as "from now on", "always" or "never again". Everything else belongs to the task at hand.
- **A rule that holds whatever the topic is** goes in this file. A rule that matters inside one topic goes in a note about that topic.
- **A lasting fact about the person's world** (a relative, a vehicle, a document number, a place that matters) goes into the note where it belongs, unasked, and you tell them. When no note fits, create one where \`AGENTS.md\` says.
- **One place per rule.** Before you store a rule, search for it. When the new rule contradicts an old one, replace the old one; never keep both. Write each rule as one short, plain sentence.
`,
  },
  {
    marker: "chat-sized",
    text: `## Style

- Keep answers chat-sized: 1 to 3 sentences for light work. Go longer only when the task truly needs it.
- Lead with the answer. Use short sentences and plain words.
- Write dates as \`YYYY-MM-DD\`, adding \`HH:mm\` only when the time matters.
`,
  },
];

/** The rules with each moved section that they lack at the end, or null when they lack none. */
export function withMovedSections(text: string): string | null {
  const lower = text.toLowerCase();
  const missing = movedSections.filter((section) => !lower.includes(section.marker));
  if (missing.length === 0) return null;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const gap = text.length === 0 ? "" : text.endsWith("\n") ? newline : newline + newline;
  const added = missing.map((section) => section.text).join("\n");
  return text + gap + added.replaceAll("\n", newline);
}

export const moveAssistantPersonality: Migration = {
  id: "2026-10-20-move-assistant-personality",
  store: "vault",
  run: (context) => {
    if (context.vaultPath === null) return "done";
    const file = join(context.vaultPath, ".eva", "assistant.md");
    // Without the file Eva refuses every Assistant turn, so there is nothing to keep working.
    if (!existsSync(file)) return "done";
    const moved = withMovedSections(readFileSync(file, "utf-8"));
    if (moved !== null) context.write(file, moved);
    return "done";
  },
};
