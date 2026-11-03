/**
 * On 2026-10-22 `Life/About me.md` got a YAML header with the person's basic facts (#370), so code
 * can read them. A vault made before then has a note with no header, so this migration adds one,
 * with the name from the note and every other field empty. The `about-me` skill fills the rest.
 *
 * The migration is frozen: it holds its own copy of the header.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Migration } from "./migration-runner.ts";

const fields = [
  "givenName:",
  "familyName:",
  "nickname:",
  "pronouns:",
  "birthDate: # YYYY-MM-DD",
  "region: # ISO 3166 code, such as ES or ES-CT",
  "hemisphere: # north or south",
  "units: # metric or imperial",
  "clock: # 24h or 12h",
  "weekStart: # monday to sunday",
  "sleep: # from and to, as HH:mm",
  "work: # from, to and days",
  "places: # home, work and other places, each with a city",
  "people: # each with a name, a relation and a birthDate",
  "dates: # each with a name and a date",
  "diet:",
  "allergies:",
];

function header(name: string | null): string {
  const nameLine = name === null ? "name:" : `name: ${JSON.stringify(name)}`;
  return [
    "---",
    "# The basic facts about the person, for Eva and her scripts. The about-me skill says how to fill each field.",
    nameLine,
    ...fields,
    "---",
    "",
    "",
  ].join("\n");
}

export const addAboutMeHeader: Migration = {
  id: "2026-10-22-about-me-header",
  store: "vault",
  run: (context) => {
    const vaultPath = context.vaultPath;
    if (vaultPath === null || !existsSync(vaultPath)) return "later";
    const path = join(vaultPath, "Life", "About me.md");
    // No note: the Assistant creates it when she first meets the person, and the skill adds the header.
    if (!existsSync(path)) return "done";
    const text = readFileSync(path, "utf-8");
    if (/^---\r?\n/.test(text)) return "done";
    const name = /^- \*\*Name:\*\* (.+)$/m.exec(text)?.[1]?.trim() ?? null;
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    context.write(path, header(name === "" ? null : name).replaceAll("\n", newline) + text);
    return "done";
  },
};
