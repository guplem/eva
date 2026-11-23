/**
 * A page before a chat exists, with a message box. The first message makes the chat, so an open page leaves no empty
 * chat behind. Two pages use it (#1037): the home page, with the greeting and the widgets, and the blank New chat page
 * of Chats.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { EffortLevel, EngineName, ModelAlias } from "../../../shared/engine-port.ts";
import { api, type ChatBlocker, type SessionRecord } from "./api.ts";
import { chatSubtitle } from "./chat-details.ts";
import { Composer, type ChatChoices } from "./Composer.tsx";
import { UserMessage } from "./Conversation.tsx";
import { newMessageId } from "./conversation-parts.ts";
import { useShowError } from "./error-toast.tsx";
import { ShowListButton } from "./MainNav.tsx";
import { outbox } from "./page-outbox.ts";
import { NewChatGreeting, NewChatSetup } from "./NewChatGreeting.tsx";
import { goTo } from "./back-layers.ts";
import { withFixRequest, withProjectMention } from "./mentions.ts";
import { fillNewChat, newChatTextKey } from "./new-chat-text.ts";
import type { WidgetFrames } from "./WidgetGrid.tsx";
import { Icon } from "./icons.tsx";
import { settingsHash } from "./settings-routes.ts";

/**
 * Opens the New chat page of Chats with a mention of the project at the start of its text (issue 657).
 * A fix request of the repository setup follows the mention (issue 668). The person sends it.
 * The page keeps the text that the person typed before, so nothing is lost.
 */
export function startChatAbout(projectId: string, fixRequest?: string): void {
  fillNewChat((text) =>
    fixRequest === undefined ? withProjectMention(text, projectId) : withFixRequest(text, projectId, fixRequest),
  );
}

/** How long the page waits to read the settings again after a failed read. */
const settingsRetryMs = 5_000;

interface ChatDefaults {
  readonly engine: EngineName;
  readonly model: ModelAlias;
  readonly effort: EffortLevel;
}

/** The page that holds the message box. */
export type DraftPage =
  | {
      /** The home page that the visor opens (#761): the greeting and the widgets. */
      readonly kind: "home";
      readonly widgets: WidgetFrames;
      /** The ☰ menu with every page, or nothing on a computer (#1037). */
      readonly menu: ReactNode;
      /** The bell and, on a phone, the gear. */
      readonly buttons: ReactNode;
    }
  | {
      /** The blank New chat page of Chats (#1037). */
      readonly kind: "new-chat";
      readonly onShowList: () => void;
      /** True when a chat in the list has an answer that the person has not read. */
      readonly listHasUnread: boolean;
    };

interface NewChatDraftProps {
  readonly page: DraftPage;
  readonly blocker: ChatBlocker | null;
  readonly voiceNotes: boolean;
  /** Opens the chat that the first message made. */
  readonly onStarted: (chat: SessionRecord) => Promise<void>;
}

export function NewChatDraft({ page, blocker, voiceNotes, onStarted }: NewChatDraftProps): ReactElement {
  // Null until the settings answer: the chip must not name an engine, a model or an effort that Eva does not use.
  const [defaults, setDefaults] = useState<ChatDefaults | null>(null);
  // The person's own picks. Null: the one from the settings.
  const [engine, setEngine] = useState<EngineName | null>(null);
  const [model, setModel] = useState<ModelAlias | null>(null);
  const [effort, setEffort] = useState<EffortLevel | null>(null);
  const [sending, setSending] = useState(false);
  // The first message shows at once, while Eva makes its chat. The chat then shows it in the same place.
  const [sentText, setSentText] = useState<string | null>(null);
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
    setSentText(message);
    try {
      let chat: SessionRecord;
      try {
        // The chat runs with the choices that the chip shows, even when the settings changed since the read.
        chat = made.current ??= await api.newAssistantChat(shown?.model, shown?.engine, shown?.effort);
      } catch (caught) {
        // No chat holds the message yet, so the message box gets the text back, and the message must not show twice.
        setSentText(null);
        showError(caught);
        return false;
      }
      // The outbox sends the message, and tries again on a bad connection (#945).
      outbox.add({ sessionId: chat.id, text: message, id: newMessageId(), turnCount: 0 });
      try {
        await onStarted(chat);
      } catch (caught) {
        // The message still goes. The chat shows in the list when the list reads again.
        showError(caught);
      }
      return true;
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
      {page.kind === "home" ? (
        <div className="main-header chat-header home-header">
          {page.menu}
          {/* The greeting below says hello. The page's name is for a screen reader only. */}
          <h1 className="visually-hidden">Home</h1>
          <div className="home-actions">
            {page.widgets.frames.length > 0 && (
              <button
                type="button"
                className="icon-button"
                aria-label="Arrange the widgets"
                data-tooltip="Arrange the widgets"
                onClick={() => goTo(settingsHash({ section: "personalize", item: "widget-layout" }))}
              >
                <Icon name="tiles" />
              </button>
            )}
            {page.buttons}
          </div>
        </div>
      ) : (
        <div className="main-header chat-header">
          <ShowListButton onClick={page.onShowList} unread={page.listHasUnread} />
          <div className="header-text">
            <h1>New chat</h1>
            {draft !== null && <div className="sub">{chatSubtitle(draft, false)}</div>}
          </div>
        </div>
      )}
      <div className="branches">
        <section className="branch" aria-label={page.kind === "home" ? "Home" : "New chat"}>
          {page.kind === "home" ? (
            blocker !== null ? (
              <NewChatSetup blocker={blocker} widgets={page.widgets} />
            ) : (
              !sending && <NewChatGreeting onPick={(text) => void send(text)} widgets={page.widgets} />
            )
          ) : (
            // The New chat page stays blank, ready to type. Only a missing setup step, which stops every chat, shows.
            blocker !== null && <NewChatSetup blocker={blocker} />
          )}
          {sentText !== null && <UserMessage text={sentText} />}
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
