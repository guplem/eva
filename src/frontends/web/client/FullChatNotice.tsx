/**
 * The offer of a new chat from a summary, when the branch in view nearly fills its context window
 * (issue 969). A person looks for this step only when the chat is long, so Eva shows it then.
 *
 * The notice reads the path of this branch alone: the turns that it shares with its parents, then
 * its own. The chat details ring reads the whole tree, but the summary works on one branch, so a
 * full fork must not offer to compact a short one.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { SessionRecord } from "./api.ts";
import { contextIsFull, contextShare, latestContext } from "./chat-details.ts";
import { SummaryChatQuestion } from "./SummaryChatQuestion.tsx";
import { forgetOffer, hideOffer, offerShows, readHiddenShare } from "./summary-offer.ts";

export function FullChatNotice({
  sessionId,
  turns,
  onChanged,
}: {
  readonly sessionId: string;
  /** The turns of the branch in view, oldest first: those it shares with its parents, then its own. */
  readonly turns: SessionRecord["turns"];
  readonly onChanged: () => Promise<void>;
}): ReactElement | null {
  const [asking, setAsking] = useState(false);
  const compact = useRef<HTMLButtonElement>(null);
  const later = useRef<HTMLButtonElement>(null);
  /** The share at which the person put this chat off. A switch of branch makes a new notice. */
  const [hidden, setHidden] = useState<number | null>(() => readHiddenShare(sessionId));

  const context = latestContext([{ turns }]);
  const share = context === null ? null : contextShare(context);
  // A chat that the engine compacted itself forgets a "Not now", so it offers again when it fills.
  // An unknown share is no fall: a failed answer must not undo the choice.
  const fell = share !== null && !contextIsFull(context);
  useEffect(() => {
    if (!fell) return;
    forgetOffer(sessionId);
    setHidden(null);
  }, [fell, sessionId]);

  const shownShare = share !== null && contextIsFull(context) && offerShows(hidden, share) ? share : null;
  // The question stays mounted while it runs: a turn that ends mid-request must not tear it down.
  if (shownShare === null && !asking) return null;
  return (
    <>
      {shownShare !== null && (
        <div className="callout warning callout-action" role="status">
          <span>
            This chat is {shownShare}% full. A full chat can confuse the model. Compact it: Eva writes a summary and
            opens a new chat.
          </span>
          <button ref={compact} className="primary" onClick={() => setAsking(true)}>
            Compact
          </button>
          <button
            ref={later}
            onClick={() => {
              hideOffer(sessionId, shownShare);
              setHidden(shownShare);
              // The notice goes away, so the keyboard goes where the person works: the message box.
              later.current?.closest("section")?.querySelector<HTMLElement>("textarea")?.focus();
            }}
          >
            Not now
          </button>
        </div>
      )}
      {asking && (
        <SummaryChatQuestion
          sessionId={sessionId}
          onKeep={() => {
            setAsking(false);
            compact.current?.focus();
          }}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
