/**
 * The Chats page before a chat exists: the greeting, or the missing setup step, and a message box.
 * The first message makes the chat, so an open page leaves no empty chat behind.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { EffortLevel, EngineName, ModelAlias } from "../../../shared/engine-port.ts";
import { api, type ChatBlocker, type SessionRecord } from "./api.ts";
import { chatSubtitle } from "./chat-details.ts";
import { Composer, type ChatChoices } from "./Composer.tsx";
import type { SentMessage } from "./Conversation.tsx";
import { useShowError } from "./error-toast.tsx";
import { ShowListButton } from "./MainNav.tsx";
import { NewChatGreeting, NewChatSetup } from "./NewChatGreeting.tsx";

/** The key of the unsent text of this page, which has no chat yet. A chat id never takes it. */
const newChatTextKey = "new-chat";

/** How long the page waits to read the settings again after a failed read. */
const settingsRetryMs = 5_000;

interface ChatDefaults {
  readonly engine: EngineName;
  readonly model: ModelAlias;
  readonly effort: EffortLevel;
}

interface NewChatDraftProps {
  readonly blocker: ChatBlocker | null;
  readonly voiceNotes: boolean;
  readonly onShowList: () => void;
  /** True when a chat in the list has an answer that the person has not read. */
  readonly listHasUnread: boolean;
  /** Gets the first message before it goes, or null when it failed to go. */
  readonly onSending: (message: SentMessage | null) => void;
  /** Opens the chat that the first message made. */
  readonly onStarted: (chat: SessionRecord) => Promise<void>;
}

export function NewChatDraft({
  blocker,
  voiceNotes,
  onShowList,
  listHasUnread,
  onSending,
  onStarted,
}: NewChatDraftProps): ReactElement {
  // Null until the settings answer: the chip must not name an engine, a model or an effort that Eva does not use.
  const [defaults, setDefaults] = useState<ChatDefaults | null>(null);
  // The person's own picks. Null: the one from the settings.
  const [engine, setEngine] = useState<EngineName | null>(null);
  const [model, setModel] = useState<ModelAlias | null>(null);
  const [effort, setEffort] = useState<EffortLevel | null>(null);
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
          const engines = settings.config.engines;
          if (current)
            setDefaults({ engine: engines.default, model: engines.defaultModel, effort: engines.defaultEffort });
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

  const shown =
    defaults === null
      ? null
      : { engine: engine ?? defaults.engine, model: model ?? defaults.model, effort: effort ?? defaults.effort };

  const send = async (message: string): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setSending(true);
    try {
      // The chat runs with the choices that the chip shows, even when the settings changed since the read.
      made.current ??= await api.newAssistantChat(shown?.model, shown?.engine, shown?.effort);
      onSending({ sessionId: made.current.id, text: message });
      await api.send(made.current.id, message);
      await onStarted(made.current);
      return true;
    } catch (caught) {
      onSending(null);
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
    setEffort: async (picked) => {
      if (made.current !== null) made.current = await api.setEffort(made.current.id, picked);
      setEffort(picked);
    },
  };
  const draft =
    shown === null
      ? null
      : { engine: shown.engine, modelAlias: shown.model, effort: shown.effort, mode: "assistant" as const };

  return (
    <>
      <div className="main-header chat-header">
        <ShowListButton onClick={onShowList} unread={listHasUnread} />
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
              // A switch to another page, or to another device, must not lose the first message (issue 652).
              draftKey={newChatTextKey}
            />
          )}
        </section>
      </div>
    </>
  );
}
