/**
 * The problems whose notice the person closed, in the machine's state folder. The file keeps
 * them across a restart, such as after an update. Each machine hides its own notices.
 */
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { AlertLevel, HiddenProblems } from "./alert-center.ts";

/** A missing or broken file hides nothing: the notices show again, and nothing is lost. */
export function readHiddenProblems(path: string): HiddenProblems {
  const read = readJsonTolerant(path);
  if (!read.ok || read.value === null || typeof read.value !== "object") return {};
  const { hidden } = read.value as { hidden?: unknown };
  if (hidden === null || typeof hidden !== "object") return {};
  return Object.fromEntries(Object.entries(hidden as Record<string, unknown>).filter(isMark));
}

function isMark(entry: [string, unknown]): entry is [string, AlertLevel] {
  return entry[1] === "warn" || entry[1] === "error";
}

export function writeHiddenProblems(path: string, hidden: HiddenProblems): void {
  writeFileAtomic(path, `${JSON.stringify({ hidden }, null, 2)}\n`);
}
