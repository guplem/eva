/**
 * The snapshots of the vault around each Assistant turn, so a retry can undo the file changes of
 * an answer (#525). Each snapshot is a commit with no parent under a hidden ref. The push sends
 * only the branch, so the refs stay on this machine.
 */

export type SnapshotMoment = "before" | "after";

export const snapshotRefRoot = "refs/eva/turns";

/** The ref of one snapshot of one turn. */
export function turnSnapshotRef(sessionId: string, turnIndex: number, moment: SnapshotMoment): string {
  return `${sessionRefPrefix(sessionId)}${String(turnIndex)}/${moment}`;
}

/** The prefix of every snapshot ref of one session. */
export function sessionRefPrefix(sessionId: string): string {
  return `${snapshotRefRoot}/${sessionId}/`;
}

/** One turn to undo, by the refs of its two snapshots. */
export interface UndoAnswer {
  readonly before: string;
  readonly after: string;
}

/**
 * What an undo does. `restore`: the files that go back. `changed`: files that changed after the
 * answers, so they stay. `notKept`: files that git does not keep, so Eva cannot restore them.
 */
export interface UndoPreview {
  readonly restore: readonly string[];
  readonly changed: readonly string[];
  readonly notKept: readonly string[];
  /** How many of the answers have snapshots, so the question can name the later ones. */
  readonly answers: number;
}

export const emptyUndo: UndoPreview = { restore: [], changed: [], notKept: [], answers: 0 };

/** A file that the snapshot leaves out, as the sync does: a Scratch file, a secret, a large file. */
export interface LeftOutFile {
  readonly path: string;
  readonly size: number;
  readonly changedAt: number;
}

/** One changed path between two snapshots. Null: the file is absent on that side. */
export interface ChangedPath {
  readonly path: string;
  readonly beforeOid: string | null;
  readonly afterOid: string | null;
}

/** The changes of one answer, read from its snapshots. */
export interface AnswerChanges {
  /** The commit of the `before` snapshot, the source of a restore. */
  readonly beforeCommit: string;
  readonly changes: readonly ChangedPath[];
  /** The left-out files that the answer added, removed or changed. */
  readonly leftOutChanged: readonly string[];
}

export interface UndoPlan {
  readonly answers: number;
  /** Each file to restore. A null source: the file did not exist, so the undo deletes it. */
  readonly restore: readonly { readonly path: string; readonly source: string | null }[];
  readonly changed: readonly string[];
  readonly notKept: readonly string[];
}

/** The `<oid>` that stands for a path that is now a folder or cannot be read: it never matches. */
export const unreadableOid = "unreadable";

const snapshotSubject = "eva: snapshot";

/** The commit message of a snapshot. The left-out files go in it, so the ref holds all it needs. */
export function snapshotMessage(leftOut: readonly LeftOutFile[]): string {
  return `${snapshotSubject}\n\n${JSON.stringify({ leftOut })}\n`;
}

/** The left-out files of a snapshot commit. A message that Eva cannot read lists none. */
export function parseSnapshotCommit(commitText: string): LeftOutFile[] {
  const body = commitText.slice(commitText.indexOf("\n\n") + 2);
  const json = body.slice(body.indexOf("\n\n") + 2).trim();
  try {
    const parsed = JSON.parse(json) as { leftOut?: unknown };
    if (!Array.isArray(parsed.leftOut)) return [];
    return parsed.leftOut.filter(
      (entry): entry is LeftOutFile =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as LeftOutFile).path === "string" &&
        typeof (entry as LeftOutFile).size === "number" &&
        typeof (entry as LeftOutFile).changedAt === "number",
    );
  } catch {
    return [];
  }
}

/** The left-out files that differ between two snapshots: added, removed or changed. */
export function changedLeftOut(before: readonly LeftOutFile[], after: readonly LeftOutFile[]): string[] {
  const key = (file: LeftOutFile): string => `${String(file.size)}:${String(file.changedAt)}`;
  const beforeByPath = new Map(before.map((file) => [file.path, key(file)]));
  const afterByPath = new Map(after.map((file) => [file.path, key(file)]));
  const paths = new Set([...beforeByPath.keys(), ...afterByPath.keys()]);
  return [...paths].filter((path) => beforeByPath.get(path) !== afterByPath.get(path));
}

const zeroOid = /^0+$/;

/** The entries of `git diff-tree -r -z --no-renames`: `:<mode> <mode> <oid> <oid> <status>\0<path>\0`. */
export function parseDiffTree(output: string): ChangedPath[] {
  const fields = output.split("\0");
  const changes: ChangedPath[] = [];
  for (let index = 0; index < fields.length - 1; index += 1) {
    const match = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) [A-Z]/.exec(fields[index] ?? "");
    if (match === null) continue;
    const [, beforeOid = "", afterOid = ""] = match;
    const path = fields[index + 1] ?? "";
    index += 1;
    changes.push({
      path,
      beforeOid: zeroOid.test(beforeOid) ? null : beforeOid,
      afterOid: zeroOid.test(afterOid) ? null : afterOid,
    });
  }
  return changes;
}

/**
 * Plans the undo of answers, oldest first. Each file goes back to its state before the first answer
 * that changed it. A file that differs from its state after the last such answer changed since, so
 * it stays. `current` holds the object id of each file now, or null when it is absent.
 */
export function planUndo(answers: readonly AnswerChanges[], current: ReadonlyMap<string, string | null>): UndoPlan {
  // A left-out file can be in a snapshot tree as an old committed version, or absent from it.
  // Either one is not the file as it was, so a restore would lose the person's version.
  const leftOut = new Set(answers.flatMap((answer) => answer.leftOutChanged));
  const first = new Map<string, { change: ChangedPath; beforeCommit: string }>();
  const last = new Map<string, ChangedPath>();
  for (const answer of answers) {
    for (const change of answer.changes) {
      if (leftOut.has(change.path)) continue;
      if (!first.has(change.path)) first.set(change.path, { change, beforeCommit: answer.beforeCommit });
      last.set(change.path, change);
    }
  }
  const restore: { path: string; source: string | null }[] = [];
  const changed: string[] = [];
  for (const [path, { change, beforeCommit }] of first) {
    const target = change.beforeOid;
    const expected = last.get(path)?.afterOid ?? null;
    const now = current.get(path) ?? null;
    if (now === target) continue;
    if (now === expected) restore.push({ path, source: target === null ? null : beforeCommit });
    else changed.push(path);
  }
  const notKept = [...leftOut];
  const byPath = (left: string, right: string): number => left.localeCompare(right);
  return {
    answers: answers.length,
    restore: restore.sort((left, right) => byPath(left.path, right.path)),
    changed: changed.sort(byPath),
    notKept: notKept.sort(byPath),
  };
}

/** The paths of a plan, for the question in the web app. */
export function previewOf(plan: UndoPlan): UndoPreview {
  return {
    restore: plan.restore.map((entry) => entry.path),
    changed: plan.changed,
    notKept: plan.notKept,
    answers: plan.answers,
  };
}
