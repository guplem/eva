/**
 * The offer of a new chat from a summary, when the branch in view nearly fills its context window
 * (issue 969). A person looks for this step only once the chat is long, so Eva names it there.
 *
 * The notice reads this branch alone. The chat details ring reads the whole tree, but the summary
 * works on one branch, so a full fork must not offer to compact a short one.
 */
import { useRef, useState, type ReactElement } from "react";
import type { SessionRecord } from "./api.ts";
import { contextIsFull, contextShare, latestContext } from "./chat-details.ts";
import { SummaryChatQuestion } from "./SummaryChatQuestion.tsx";
import { hideOffer, offerShows, readHiddenShare } from "./summary-offer.ts";

export function FullChatNotice({
  session,
  onChanged,
}: {
  readonly session: SessionRecord;
  readonly onChanged: () => Promise<void>;
}): ReactElement | null {
  const [asking, setAsking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  /** The share at which the person put this chat off. A switch of branch reads the new chat's own. */
  const [hidden, setHidden] = useState<{ readonly chatId: string; readonly share: number | null }>(() => ({
    chatId: session.id,
    share: readHiddenShare(session.id),
  }));
  if (hidden.chatId !== session.id) setHidden({ chatId: session.id, share: readHiddenShare(session.id) });

  const context = latestContext([session]);
  const share = context === null ? null : contextShare(context);
  if (share === null || !contextIsFull(context)) return null;
  if (hidden.chatId === session.id && !offerShows(hidden.share, share)) return null;
  return (
    <>
      <div className="callout warning callout-action" role="status">
        <span>
          This chat is {share}% full. A full chat confuses the model. Compact it into a new chat with a summary.
        </span>
        <button ref={button} className="primary" onClick={() => setAsking(true)}>
          Compact
        </button>
        <button
          onClick={() => {
            hideOffer(session.id, share);
            setHidden({ chatId: session.id, share });
          }}
        >
          Not now
        </button>
      </div>
      {asking && (
        <SummaryChatQuestion
          sessionId={session.id}
          onKeep={() => {
            setAsking(false);
            button.current?.focus();
          }}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
