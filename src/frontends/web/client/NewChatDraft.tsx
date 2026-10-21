/**
 * The Chats page before a chat exists: the greeting, or the missing setup step, and a message box.
 * The first message makes the chat, so an open page leaves no empty chat behind.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { EngineName, ModelAlias } from "../../../shared/engine-port.ts";
import { api, type ChatBlocker, type SessionRecord } from "./api.ts";
import { chatSubtitle } from "./chat-details.ts";
import { Composer, type ChatChoices } from "./Composer.tsx";
import { useShowError } from "./error-toast.tsx";
import { ShowListButton } from "./MainNav.tsx";
import { NewChatGreeting, NewChatSetup } from "./NewChatGreeting.tsx";

/** How long the page waits to read the settings again after a failed read. */
const settingsRetryMs = 5_000;

interface NewChatDraftProps {
  readonly blocker: ChatBlocker | null;
  readonly voiceNotes: boolean;
  readonly onShowList: () => void;
  /** Opens the chat that the first message made. */
  readonly onStarted: (chat: SessionRecord) => Promise<void>;
}

export function NewChatDraft({ blocker, voiceNotes, onShowList, onStarted }: NewChatDraftProps): ReactElement {
  // Null until the settings answer: the chip must not name an engine that Eva does not use.
  const [defaultEngine, setDefaultEngine] = useState<EngineName | null>(null);
  const [engine, setEngine] = useState<EngineName | null>(null);
  const [model, setModel] = useState<ModelAlias>("default");
  const [sending, setSending] = useState(false);
  // A suggestion tap and the message box must not both make a chat.
  const busy = useRef(false);
  // The chat of a first message that failed to send. A retry sends into it, so no empty chat stays behind.
  const made = useRef<SessionRecord | null>(null);
  const showError = useShowError();

  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let toldOnce = false;
    // With no engine to show, the page has no message box, so a failed read tries again.
    const read = (): void => {
      api
        .settings()
        .then((settings) => {
          if (current) setDefaultEngine(settings.config.engines.default);
        })
        .catch((caught: unknown) => {
          if (!current) return;
          if (!toldOnce) showError(caught);
          toldOnce = true;
          timer = setTimeout(read, settingsRetryMs);
        });
    };
    read();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [showError]);

  const shownEngine = engine ?? defaultEngine;

  const send = async (message: string): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setSending(true);
    try {
      // The chat runs on the engine that the chip shows, even when Eva read another default at start.
      made.current ??= await api.newAssistantChat(model, shownEngine ?? undefined);
      await api.send(made.current.id, message);
      await onStarted(made.current);
      return true;
    } catch (caught) {
      showError(caught);
      return false;
    } finally {
      busy.current = false;
      setSending(false);
    }
  };

  const choices: ChatChoices = {
    setEngine: async (picked) => {
      if (made.current !== null) made.current = await api.setEngine(made.current.id, picked);
      setEngine(picked);
    },
    setModel: async (picked) => {
      if (made.current !== null) made.current = await api.setModel(made.current.id, picked);
      setModel(picked);
    },
  };
  const draft = shownEngine === null ? null : { engine: shownEngine, modelAlias: model, mode: "assistant" as const };

  return (
    <>
      <div className="main-header chat-header">
        <ShowListButton onClick={onShowList} />
        <div className="header-text">
          <h1>New chat</h1>
          {draft !== null && <div className="sub">{chatSubtitle(draft, false)}</div>}
        </div>
      </div>
      <div className="branches">
        <section className="branch" aria-label="New chat">
          {blocker !== null ? (
            <NewChatSetup blocker={blocker} />
          ) : (
            !sending && <NewChatGreeting onPick={(text) => void send(text)} />
          )}
          {draft !== null && (
            <Composer
              session={{ ...draft, parentId: null, turns: [] }}
              choices={choices}
              // Nothing runs before the chat exists, so the box never shows Stop.
              running={false}
              onSend={send}
              onStop={() => undefined}
              onChanged={() => Promise.resolve()}
              blocker={blocker}
              // A voice note sends the text that Eva heard. The new chat cannot play it back.
              voiceNotes={voiceNotes}
            />
          )}
        </section>
      </div>
    </>
  );
}
