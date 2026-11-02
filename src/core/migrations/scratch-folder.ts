/**
 * On 2026-11-02 Eva started to write the files of the chats in `.eva/scratch/` instead of `Scratch/`
 * at the vault root (#767). The vault sync keeps both folders out of each commit anyway. This
 * migration adds `.eva/scratch/` to the vault's `.gitignore`, so `git status` in the vault stays
 * clean. It keeps the `Scratch/` line for good: an older Eva on another computer, or an old vault
 * map, can still write there. It moves no file: the old folder empties itself as its files age.
 *
 * The migration is frozen: it holds its own copy of the text.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Migration } from "./migration-runner.ts";

const comment = "# Files made only to send to a chat, and files received from it. Eva removes them after a week.";
const oldLine = "Scratch/";
const newLine = ".eva/scratch/";

export const ignoreEvaScratch: Migration = {
  id: "2026-11-02-eva-scratch",
  store: "vault",
  run: (context) => {
    const vaultPath = context.vaultPath;
    if (vaultPath === null || !existsSync(vaultPath)) return "later";
    const path = join(vaultPath, ".gitignore");
    if (!existsSync(path)) return "done";
    const text = readFileSync(path, "utf-8");
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(newline);
    if (lines.some((line) => /^\/?\.eva\/scratch\/?$/i.test(line.trim()))) return "done";
    const block = lines.findIndex((line, index) => line === comment && lines[index + 1] === oldLine);
    if (block !== -1) lines.splice(block + 2, 0, newLine);
    else {
      if (lines.at(-1) === "") lines.pop();
      lines.push("", comment, newLine, "");
    }
    context.write(path, lines.join(newline));
    return "done";
  },
};
