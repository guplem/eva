/**
 * The question before a new chat that goes on from a summary of one branch (issue 522). The chat
 * header asks it from its menu. The page then opens the new chat, where the person reads the
 * summary before it goes.
 */
import { useState, type ReactElement } from "react";
import { api } from "./api.ts";
import { dialogBackdropClass } from "./Dialog.tsx";
import { useEscape } from "./back-layer-hook.ts";
import { goTo } from "./back-layers.ts";
import { useShowError } from "./error-toast.tsx";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";

const heading = "Start a new chat from a summary";

export function SummaryChatQuestion({
  sessionId,
  onKeep,
  onChanged,
}: {
  readonly sessionId: string;
  readonly onKeep: () => void;
  readonly onChanged: () => Promise<void>;
}): ReactElement {
  const [working, setWorking] = useState(false);
  const showError = useShowError();
  useEscape(onKeep, working);
  const start = async (): Promise<void> => {
    if (working) return;
    setWorking(true);
    try {
      const { session, summaryFailure } = await api.summaryChat(sessionId);
      await onChanged();
      // Closed here: the page may fail to open the new chat, and the old header then stays.
      onKeep();
      goTo(`#/chat/${encodeURIComponent(session.id)}`);
      if (summaryFailure !== null)
        showError(new Error(`Eva could not write the summary: ${summaryFailure} The new chat starts empty.`));
    } catch (caught) {
      showError(caught);
      setWorking(false);
    }
  };
  return (
    <div
      className={dialogBackdropClass("schedule-backdrop")}
      onClick={(event) => event.target === event.currentTarget && !working && onKeep()}
    >
      <div className="schedule-sheet" role="dialog" aria-modal="true" aria-label={`${heading}?`}>
        <h2>{heading}?</h2>
        <p>
          Eva writes a short summary of this chat and opens a new chat with it. You can read and change the summary
          before you send it.
        </p>
        <div className="schedule-sheet-actions">
          {/* Not disabled: a disabled button drops the focus, and a failed start must leave it here. */}
          <button className="primary" aria-disabled={working} aria-busy={working} onClick={() => void start()}>
            {working && <ButtonSpinner />}
            Start
          </button>
          <span className="spacer" />
          <button autoFocus onClick={onKeep} disabled={working}>
            Cancel
          </button>
        </div>
        {working && <ProgressBar label="Eva writes the summary." />}
      </div>
    </div>
  );
}
