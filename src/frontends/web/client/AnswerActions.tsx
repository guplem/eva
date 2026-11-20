/**
 * Retry and Fork of a stored answer, with their questions: the undo of file changes (#525), and
 * the place and files of a Project chat (#523). The chat and the branch map share it (#990).
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { api, type SessionRecord, type UndoPreview } from "./api.ts";
import { BranchChoiceDialog, useFinishBranch, type BranchRequest } from "./BranchChoiceDialog.tsx";
import { chatKind } from "../../../shared/chat-kind.ts";
import { undoQuestion } from "./conversation-parts.ts";
import { useShowError } from "./error-toast.tsx";
import { RetryUndoDialog } from "./RetryUndoDialog.tsx";

export interface AnswerActions {
  readonly retry: (owner: SessionRecord, index: number) => void;
  readonly fork: (owner: SessionRecord, index: number) => void;
  /** The dialogs of the questions. Draw them once. */
  readonly parts: ReactElement;
}

/**
 * `place` names the shown chat and branch. A question belongs to the place that asked it: before,
 * each branch view held its own questions, and a new branch dropped them.
 */
export function useAnswerActions(onChanged: () => Promise<void>, place: string): AnswerActions {
  const showError = useShowError();
  const currentPlace = useRef(place);
  /** The question before a retry that would undo file changes (#525), or null. */
  const [undoAsk, setUndoAsk] = useState<{
    readonly sessionId: string;
    readonly index: number;
    readonly title: string;
    readonly preview: UndoPreview;
  } | null>(null);
  const closeUndoAsk = useCallback(() => setUndoAsk(null), []);
  /** The retry or fork of a Project chat whose choices the dialog shows. */
  const [branching, setBranching] = useState<BranchRequest | null>(null);
  const closeBranching = useCallback(() => setBranching(null), []);
  const finishBranch = useFinishBranch(onChanged);

  // An open question would act on a chat that the page no longer shows, so another place closes it.
  useEffect(() => {
    currentPlace.current = place;
    setUndoAsk(null);
    setBranching(null);
  }, [place]);

  /** Runs an action on an answer, and shows its failure. */
  const runAction = (action: () => Promise<unknown>): void => {
    action()
      .then(onChanged)
      .catch((caught: unknown) => {
        showError(caught);
      });
  };

  /**
   * A retry of an answer in the vault that changed files asks first whether to undo them (#525):
   * an Assistant or a specialist answer (#703). A retry of a chat in a clone asks where it runs and
   * from which files of its clone (#523).
   */
  const retry = (owner: SessionRecord, index: number): void => {
    const turn = owner.turns[index];
    if (chatKind(owner) === "project" && turn !== undefined) {
      setBranching({ kind: "retry", sessionId: owner.id, turnIndex: index, turn });
      return;
    }
    const asked = place;
    runAction(async () => {
      const preview = chatKind(owner) === "project" ? null : await api.retryUndo(owner.id, index);
      const title = preview === null ? null : undoQuestion(preview);
      if (preview === null || title === null) await api.retry(owner.id, index);
      // The person moved on while Eva read the changes, so the question would open on another chat.
      else if (currentPlace.current === asked) setUndoAsk({ sessionId: owner.id, index, title, preview });
    });
  };

  const fork = (owner: SessionRecord, index: number): void => {
    const turn = owner.turns[index];
    if (turn === undefined) return;
    // A specialist has no clone, so its fork is a branch of the chat (#703).
    if (chatKind(owner) === "project") {
      setBranching({ kind: "fork", sessionId: owner.id, atMessageId: turn.lastMessageId ?? "", turn });
    } else {
      runAction(() => api.fork(owner.id, turn.lastMessageId ?? ""));
    }
  };

  const retryAfterQuestion = async (undo: boolean): Promise<void> => {
    if (undoAsk === null) return;
    try {
      await api.retry(undoAsk.sessionId, undoAsk.index, { undo });
      setUndoAsk(null);
      await onChanged();
    } catch (caught) {
      // A failed undo starts no retry. The question closes, so the person sees why.
      setUndoAsk(null);
      showError(caught);
    }
  };

  const parts = (
    <>
      {branching !== null && <BranchChoiceDialog request={branching} onClose={closeBranching} onDone={finishBranch} />}
      {undoAsk !== null && (
        <RetryUndoDialog
          title={undoAsk.title}
          preview={undoAsk.preview}
          onRetry={retryAfterQuestion}
          onClose={closeUndoAsk}
        />
      )}
    </>
  );
  return { retry, fork, parts };
}
