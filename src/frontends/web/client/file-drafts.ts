/**
 * The unsaved edits of the Files page, by path. They live outside the page, so a tap on another
 * file, another page or Back keeps the edit, and the file opens in its editor again. A draft of an
 * encrypted file holds decrypted text, so it goes when this tab locks (#707).
 */
import { isUnder } from "./file-paths.ts";
import { onUnlockForgotten } from "./vault-unlock.ts";

export interface Draft {
  readonly text: string;
  /** The version that the edit started from, so a save after a change on disk answers `file_changed`. */
  readonly version: string;
  /** True for decrypted text, which must not outlive a lock. */
  readonly encrypted?: boolean;
}

const drafts = new Map<string, Draft>();
let leaveGuard = false;

/** A browser text area gives LF only, so a Windows file must not look changed. */
export const sameText = (first: string, second: string): boolean =>
  first.replaceAll("\r\n", "\n") === second.replaceAll("\r\n", "\n");

export function draftOf(path: string): Draft | undefined {
  return drafts.get(path);
}

export function keepDraft(path: string, draft: Draft | null, onDisk: string): void {
  if (draft === null || sameText(draft.text, onDisk)) drafts.delete(path);
  else drafts.set(path, draft);
  if (leaveGuard || typeof window === "undefined") return;
  leaveGuard = true;
  // A reload or a closed tab would drop the drafts, so the browser asks first.
  window.addEventListener("beforeunload", (event) => {
    if (drafts.size > 0) event.preventDefault();
  });
}

/** A renamed file or folder takes its drafts, and the drafts of the files inside it, to the new path. */
export function moveDrafts(from: string, to: string): void {
  for (const [path, draft] of [...drafts]) {
    if (!isUnder(path, from)) continue;
    drafts.delete(path);
    drafts.set(to + path.slice(from.length), draft);
  }
}

/** True while an unsaved edit of an encrypted file waits, so a lock asks first. */
export function hasEncryptedDraft(): boolean {
  return [...drafts.values()].some((draft) => draft.encrypted === true);
}

export function dropEncryptedDrafts(): void {
  for (const [path, draft] of [...drafts]) if (draft.encrypted === true) drafts.delete(path);
}

/** For a test only: each test starts with no draft. */
export function forgetAllDrafts(): void {
  drafts.clear();
}

onUnlockForgotten(dropEncryptedDrafts);
