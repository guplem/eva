/**
 * The choices of a retry and a fork of a Project chat (issue 523): where the new branch runs, and
 * from which files. The first choice is the default. A choice that needs a snapshot that Eva did not
 * keep, such as for an answer from before Eva kept them, is off with a reason.
 */
import type { ForkFiles, RetryChoice, SessionRecord } from "./api.ts";

type Turn = Pick<SessionRecord["turns"][number], "startSnapshot" | "endSnapshot">;

export interface BranchChoice<Value extends string> {
  readonly value: Value;
  readonly title: string;
  readonly detail: string;
  /** Why the choice is off, or null when the person can pick it. */
  readonly offReason: string | null;
}

const noSnapshotBefore = "Eva kept no snapshot of the files before this answer.";
const noSnapshotAt = "Eva kept no snapshot of the files at this answer.";

/** A retry replaces an answer, so it offers no clean clone: the message needs the earlier work. */
export function retryChoices(turn: Turn): BranchChoice<RetryChoice>[] {
  const off = turn.startSnapshot === null ? noSnapshotBefore : null;
  return [
    {
      value: "undo",
      title: "Undo and retry here",
      detail: "The files go back to how they were before this answer. Every later answer is undone too.",
      offReason: off,
    },
    { value: "keep", title: "Retry here", detail: "The files stay as they are.", offReason: null },
    {
      value: "new-clone",
      title: "Retry in a new clone",
      detail: "A new clone gets the files from before this answer. This clone stays, so you can compare.",
      offReason: off,
    },
  ];
}

/** A fork opens a second path while its chat goes on, so it offers no undo in the same clone. */
export function forkChoices(turn: Turn): BranchChoice<ForkFiles>[] {
  return [
    {
      value: "snapshot-clone",
      title: "New clone at this answer",
      detail: "A new clone gets the files as they were at this answer. Later changes of this chat stay out.",
      offReason: turn.endSnapshot === null ? noSnapshotAt : null,
    },
    {
      value: "clean-clone",
      title: "New clean clone",
      detail: "A clone on the default branch, up to date with GitHub.",
      offReason: null,
    },
    {
      value: "same-clone",
      title: "This clone",
      detail: "The fork shares the files with this chat. Their turns wait in line.",
      offReason: null,
    },
  ];
}

/** The first choice that the person can pick. */
export function defaultChoice<Value extends string>(choices: readonly BranchChoice<Value>[]): Value | null {
  return choices.find((choice) => choice.offReason === null)?.value ?? null;
}

/** True when the new branch runs in another clone. It is the root of that clone's chat, so the page opens it. */
export function movedToOtherClone(branch: Pick<SessionRecord, "parentId">): boolean {
  return branch.parentId === null;
}

/** The line of a chat that came from another clone, such as "Forked from Fix the login in clone-0". */
export function forkedFromText(chat: Pick<SessionRecord, "forkedFrom">, title: string | null): string | null {
  const from = chat.forkedFrom;
  if (from === null) return null;
  const place = from.clone === null ? "" : ` in ${from.clone}`;
  return `Forked from ${title ?? "a deleted chat"}${place}`;
}

/**
 * Why a chat from another clone starts with no conversation, or null. Eva could not take the
 * conversation along, so the chat continues its parent from a summary. The note stays until the first message.
 */
export function historyNotice(
  chat: Pick<SessionRecord, "forkedFrom" | "continuedFrom" | "firstMessageDraft" | "turns">,
): string | null {
  if (chat.forkedFrom === null || chat.continuedFrom === null || chat.turns.length > 0) return null;
  return chat.firstMessageDraft === null
    ? "Eva could not take the conversation to this clone, and its summary failed. This chat starts with no history."
    : "Eva could not take the conversation to this clone, so this chat starts from a summary. Read it in the message box, then send it.";
}
