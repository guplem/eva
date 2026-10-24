/**
 * The choice of where a retry or a fork of a Project chat runs, and from which files (issue 523).
 * One tap on a choice starts the branch. A branch in another clone opens in its own view.
 */
import { useCallback, useState, type ReactElement } from "react";
import { api, type BranchResult, type SessionRecord } from "./api.ts";
import { defaultChoice, forkChoices, movedToOtherClone, retryChoices, type BranchChoice } from "./branch-choices.ts";
import { Dialog } from "./Dialog.tsx";
import { useShowError } from "./error-toast.tsx";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";

type Turn = SessionRecord["turns"][number];

/** What the person asked to branch: a retry of a turn, or a fork at its answer. */
export type BranchRequest =
  | { readonly kind: "retry"; readonly sessionId: string; readonly turnIndex: number; readonly turn: Turn }
  | { readonly kind: "fork"; readonly sessionId: string; readonly atMessageId: string; readonly turn: Turn };

/**
 * Loads the chats again, and opens a branch in another clone in its own view. A branch that lost its
 * history says so in a note of its own view, which stays until its first message, so no toast is needed.
 */
export function useFinishBranch(onChanged: () => Promise<void>): (result: BranchResult) => Promise<void> {
  return useCallback(
    async (result: BranchResult): Promise<void> => {
      await onChanged();
      if (movedToOtherClone(result.session)) window.location.hash = `#/chat/${encodeURIComponent(result.session.id)}`;
    },
    [onChanged],
  );
}

export function BranchChoiceDialog({
  request,
  onClose,
  onDone,
}: {
  readonly request: BranchRequest;
  readonly onClose: () => void;
  readonly onDone: (result: BranchResult) => Promise<void>;
}): ReactElement {
  const showError = useShowError();
  const [picked, setPicked] = useState<string | null>(null);
  const choices: readonly BranchChoice<string>[] =
    request.kind === "retry" ? retryChoices(request.turn) : forkChoices(request.turn);
  const first = defaultChoice(choices);

  const pick = async (value: string): Promise<void> => {
    setPicked(value);
    try {
      const result =
        request.kind === "retry"
          ? await api.retry(request.sessionId, request.turnIndex, value as "undo" | "keep" | "new-clone")
          : await api.fork(
              request.sessionId,
              request.atMessageId,
              value as "snapshot-clone" | "clean-clone" | "same-clone",
            );
      onClose();
      await onDone(result);
    } catch (caught) {
      showError(caught);
      setPicked(null);
    }
  };

  const busy = picked !== null;
  const newClone = picked !== null && picked.includes("clone") && picked !== "same-clone";
  return (
    // While the branch starts, Escape and Cancel do nothing: the dialog closes when it is ready.
    <Dialog
      label={request.kind === "retry" ? "Retry this answer" : "Fork at this answer"}
      onClose={busy ? ignore : onClose}
      closeDisabled={busy}
      closeLabel="Cancel"
    >
      <h2>{request.kind === "retry" ? "Retry this answer" : "Fork at this answer"}</h2>
      <p>
        {request.kind === "retry"
          ? "Choose the files that the new answer starts from."
          : "Choose where the fork works."}
      </p>
      <div className="branch-choices" role="group" aria-label="Choices">
        {choices.map((choice) => (
          <button
            key={choice.value}
            className={choice.value === first ? "primary" : "ghost"}
            disabled={busy || choice.offReason !== null}
            aria-busy={picked === choice.value}
            onClick={() => void pick(choice.value)}
          >
            <span className="branch-choice-title">
              {picked === choice.value && <ButtonSpinner />}
              {choice.title}
            </span>
            <span className="branch-choice-detail">{choice.offReason ?? choice.detail}</span>
          </button>
        ))}
      </div>
      {busy && <ProgressBar label={newClone ? "Eva makes the new clone…" : "Eva starts the branch…"} />}
    </Dialog>
  );
}

const ignore = (): void => undefined;
