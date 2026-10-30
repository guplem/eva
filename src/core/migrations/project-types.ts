/**
 * On 2026-10-30 a project got a type: software or specialist (#703). The vault map's _Projects_
 * section shows the `type` key and says what the text of a project file means for each type. The
 * map is the person's own text, so this migration replaces only the exact sentences that Eva
 * wrote. A section that the person changed stays as it is.
 *
 * The migration is frozen: it holds its own copy of the old and the new text.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Migration } from "./migration-runner.ts";

const oldExample = "status: active # idea, active, paused or closed\nrepos:";
const newExample =
  "status: active # idea, active, paused or closed\ntype: software # software or specialist. No type means software\nrepos:";

const oldText =
  "The text under the front matter says what an agent must know about the project. The project's notes sit beside it.";
const newText = [
  "A project is one of two types:",
  "",
  "- **Software:** work in repositories, such as an app, a website or a widget. The text under the front matter describes the project for the person and for you, and names the repository to read first. The rules for the code live in each repository's own `AGENTS.md`. The project's notes sit beside the file.",
  "- **Specialist:** a chat with its own rules and memory, such as a gym coach. The text under the front matter holds the rules of the specialist. Its memory and its other files sit beside the file. A specialist has no repository and no clone.",
].join("\n");

export const describeProjectTypes: Migration = {
  id: "2026-10-30-project-types",
  store: "vault",
  run: (context) => {
    const vaultPath = context.vaultPath;
    if (vaultPath === null || !existsSync(vaultPath)) return "later";
    const path = join(vaultPath, "AGENTS.md");
    if (!existsSync(path)) return "done";
    const text = readFileSync(path, "utf-8");
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    const inStyle = (value: string): string => value.replaceAll("\n", newline);
    // Both parts or neither: one alone would show a key that the text does not explain.
    if (!text.includes(inStyle(oldExample)) || !text.includes(inStyle(oldText))) return "done";
    context.write(
      path,
      text.replace(inStyle(oldExample), inStyle(newExample)).replace(inStyle(oldText), inStyle(newText)),
    );
    return "done";
  },
};
