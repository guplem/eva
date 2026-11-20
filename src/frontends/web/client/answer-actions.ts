/**
 * The rules of the actions on a stored answer, shared by the answer in the chat and its row in the
 * branch map (#990), so both offer the same actions.
 */

export interface AnswerFacts {
  readonly lastMessageId: string | null;
  readonly failure: unknown;
}

/** A closed chat takes no new turn. A fork starts after the answer's last message, so a failed answer has none. */
export function answerActions(
  chat: { readonly closed: boolean },
  turn: AnswerFacts,
): { readonly retry: boolean; readonly fork: boolean } {
  return {
    retry: !chat.closed,
    fork: !chat.closed && turn.lastMessageId !== null && turn.failure === null,
  };
}

export type BranchRowAction = "show" | "copy" | "retry" | "fork";

/**
 * The turn actions of a row of the branch map, in menu order. The branch actions follow them.
 * `turn` is null for a fork with no turn yet. `inChat` is false where the map lives outside the
 * chat, such as the phone's sheet, which cannot run the questions of a retry or a fork.
 */
export function branchRowActions(
  chat: { readonly closed: boolean },
  turn: (AnswerFacts & { readonly words: string | null }) | null,
  inChat: boolean,
): BranchRowAction[] {
  const actions: BranchRowAction[] = ["show"];
  if (turn !== null) {
    if (turn.words !== null && turn.words !== "") actions.push("copy");
    const allowed = answerActions(chat, turn);
    if (inChat && allowed.retry) actions.push("retry");
    if (inChat && allowed.fork) actions.push("fork");
  }
  return actions;
}
