/**
 * pi keeps each conversation as a tree in a JSONL session file: a `session` header, then
 * entries with an `id` and a `parentId`. RPC events carry no entry ids, so Eva reads the file
 * after a turn for the id of the last answer, and writes a branch file herself for a fork,
 * because RPC can neither cut at an answer nor let Eva name the new file (spike, P7).
 */
import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "../../shared/files.ts";

interface SessionEntry {
  readonly type: string;
  readonly id?: string;
  readonly parentId?: string | null;
  readonly message?: { readonly role?: string };
}

/** The entry id of the last answer in the file, or null when it holds none. */
export function lastAnswerEntryId(sessionFile: string): string | null {
  const answers = readEntries(sessionFile).filter(
    (entry) => entry.type === "message" && entry.message?.role === "assistant",
  );
  return answers.at(-1)?.id ?? null;
}

export interface BranchInputs {
  readonly sourceFile: string;
  /** The entry where the branch ends, inclusive. */
  readonly atEntryId: string;
  readonly targetFile: string;
  readonly cwd: string;
  readonly headerId: string;
  readonly now: Date;
}

/**
 * Writes a new session file that holds the path from the root to `atEntryId`. Returns false
 * when the source file or the entry is gone, so the caller can say that the history is lost.
 */
export function writeBranchFile(inputs: BranchInputs): boolean {
  const entries = readEntries(inputs.sourceFile);
  const byId = new Map(entries.filter((entry) => entry.id !== undefined).map((entry) => [entry.id, entry]));
  const path: SessionEntry[] = [];
  let current = byId.get(inputs.atEntryId);
  while (current !== undefined) {
    path.unshift(current);
    current = current.parentId === null || current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  if (path.length === 0) return false;
  const header = {
    type: "session",
    version: 3,
    id: inputs.headerId,
    timestamp: inputs.now.toISOString(),
    cwd: inputs.cwd,
    parentSession: inputs.sourceFile,
  };
  writeFileAtomic(inputs.targetFile, [header, ...path].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return true;
}

function readEntries(sessionFile: string): SessionEntry[] {
  if (!existsSync(sessionFile)) return [];
  const entries: SessionEntry[] = [];
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === "object" && value !== null && typeof (value as SessionEntry).type === "string") {
        entries.push(value as SessionEntry);
      }
    } catch {
      // A torn last line after a crash: the entries before it still count.
    }
  }
  return entries;
}
