/**
 * The header of an open chat: one row with the title, one subtitle, and a "More actions" menu with Rename,
 * Chat info and Delete chat. One row leaves the chat its height. A computer also has a button that
 * hides or shows the chat details column. On a phone, a tap on the title opens the chat details.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { api, type SessionRecord } from "./api.ts";
import { ChatInfoSheet, chatPanelId, type ChatProps } from "./ChatPanel.tsx";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import { ShowListButton } from "./MainNav.tsx";
import { MenuList, useDismissOutside, type MenuItem } from "./Menu.tsx";
import { RenameForm } from "./RenameForm.tsx";

/** A header action that a list asks for, such as Rename from the context menu of a chat in the list. */
export type ChatAction = "rename" | "delete";

/**
 * Lets a list start a header action on a chat. Give the ChatHeader the `key` and `startWith` of `headerProps(chat.id)`:
 * the key makes a new header, and the new header starts with the action.
 */
export function useChatActionRequest(): {
  readonly ask: (chatId: string, action: ChatAction) => void;
  readonly clear: () => void;
  readonly headerProps: (chatId: string) => { readonly key: string; readonly startWith: ChatAction | null };
} {
  // The count only grows, so a cleared request keeps the header and its open form.
  const [request, setRequest] = useState<{ chatId: string | null; action: ChatAction | null; count: number }>({
    chatId: null,
    action: null,
    count: 0,
  });
  const ask = useCallback(
    (chatId: string, action: ChatAction) => setRequest((current) => ({ chatId, action, count: current.count + 1 })),
    [],
  );
  const clear = useCallback(() => setRequest((current) => ({ ...current, chatId: null, action: null })), []);
  return {
    ask,
    clear,
    headerProps: (chatId) => ({
      key: `${chatId}-${String(request.count)}`,
      startWith: request.chatId === chatId ? request.action : null,
    }),
  };
}

/** The context menu of a chat in a list: the actions that need no open chat first. */
export function chatListItems(onOpen: () => void, onAction: (action: ChatAction) => void): MenuItem[] {
  return [
    { label: "Open", icon: "chat", onChoose: onOpen },
    { label: "Rename", icon: "pen", onChoose: () => onAction("rename") },
    { label: "Delete chat", icon: "trash", danger: true, onChoose: () => onAction("delete") },
  ];
}

/** The phone breakpoint of `styles.css`. */
const phoneQuery = "(max-width: 760px)";

function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() => window.matchMedia(phoneQuery).matches);
  useEffect(() => {
    const query = window.matchMedia(phoneQuery);
    const onChange = (): void => setIsPhone(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return isPhone;
}

interface ChatHeaderProps {
  readonly chat: SessionRecord;
  /** What the details sheet shows. */
  readonly details: ChatProps;
  readonly subtitle: ReactNode;
  /** Parts between the title and the menu, such as the pull request of a clone. */
  readonly extra?: ReactNode;
  readonly onShowList: () => void;
  /** Whether a computer shows the chat details column. */
  readonly panelShown: boolean;
  readonly onTogglePanel: () => void;
  readonly onChanged: () => Promise<void>;
  /** An action that the header starts with, asked from the chat's context menu in a list. */
  readonly startWith?: ChatAction | null;
}

export function ChatHeader({
  chat,
  details,
  subtitle,
  extra,
  onShowList,
  panelShown,
  onTogglePanel,
  onChanged,
  startWith = null,
}: ChatHeaderProps): ReactElement {
  const isPhone = useIsPhone();
  const [draft, setDraft] = useState<string | null>(startWith === "rename" ? chat.title : null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [asking, setAsking] = useState(startWith === "delete");
  const moreButton = useRef<HTMLButtonElement>(null);
  // A chosen menu item leaves the page, so focus goes back to the button that opened the sheet or the question.
  const opener = useRef<HTMLElement | null>(null);
  const closeInfo = useCallback(() => {
    setInfoOpen(false);
    opener.current?.focus();
  }, []);
  const openInfo = (from: HTMLElement | null): void => {
    opener.current = from;
    setInfoOpen(true);
  };

  const items: MenuItem[] = [{ label: "Rename", icon: "pen", onChoose: () => setDraft(chat.title) }];
  // A computer shows the details in the inspector column.
  if (isPhone) items.push({ label: "Chat info", icon: "chat", onChoose: () => openInfo(moreButton.current) });
  items.push({ label: "Delete chat", icon: "trash", danger: true, onChoose: () => setAsking(true) });

  return (
    <div className="main-header chat-header">
      <ShowListButton onClick={onShowList} />
      {draft === null ? (
        <div className="header-text">
          <h1>
            {isPhone ? (
              <button
                className="chat-title-button"
                data-tooltip="Show the chat details"
                aria-haspopup="dialog"
                onClick={(event) => openInfo(event.currentTarget)}
              >
                {chat.title}
              </button>
            ) : (
              chat.title
            )}
          </h1>
          <div className="sub">{subtitle}</div>
        </div>
      ) : (
        <RenameForm
          label="Chat title"
          draft={draft}
          onDraft={setDraft}
          onSave={async (title) => {
            await api.rename(chat.id, title);
            await onChanged();
          }}
          onEnd={() => {
            setDraft(null);
            moreButton.current?.focus();
          }}
        />
      )}
      {extra}
      {!isPhone && (
        <button
          className="icon-button"
          aria-label={panelShown ? "Hide the chat details" : "Show the chat details"}
          data-tooltip={panelShown ? "Hide the chat details" : "Show the chat details"}
          aria-controls={panelShown ? chatPanelId : undefined}
          aria-expanded={panelShown}
          onClick={onTogglePanel}
        >
          <Icon name="panel" />
        </button>
      )}
      <MoreMenu items={items} toggle={moreButton} />
      {asking && (
        <DeleteQuestion
          chat={chat}
          onKeep={() => {
            setAsking(false);
            moreButton.current?.focus();
          }}
          onChanged={onChanged}
        />
      )}
      {infoOpen && <ChatInfoSheet {...details} onClose={closeInfo} />}
    </div>
  );
}

/** Deletes the chat and its forks in every front end. It asks in the page, as a schedule row does. */
function DeleteQuestion({
  chat,
  onKeep,
  onChanged,
}: {
  readonly chat: SessionRecord;
  readonly onKeep: () => void;
  readonly onChanged: () => Promise<void>;
}): ReactElement {
  const [deleting, setDeleting] = useState(false);
  const showError = useShowError();
  const remove = async (): Promise<void> => {
    if (deleting) return;
    setDeleting(true);
    try {
      await api.deleteChat(chat.id);
      await onChanged();
    } catch (caught) {
      showError(caught);
      setDeleting(false);
    }
  };
  return (
    <div className="chat-delete-question" role="group" aria-label={`Delete “${chat.title}”?`}>
      <span>Delete “{chat.title}” and its forks everywhere?</span>
      {/* Not disabled: a disabled button drops the focus, and a failed delete must leave it here. */}
      <button className="danger" aria-disabled={deleting} onClick={() => void remove()}>
        Delete
      </button>
      {/* Focus comes here, so a keyboard or a screen reader reaches the question at once. */}
      <button autoFocus onClick={onKeep}>
        Keep
      </button>
    </div>
  );
}

/** The less common actions of a chat. Escape or a tap outside closes it; the arrow keys move between the items. */
function MoreMenu({
  items,
  toggle,
}: {
  readonly items: readonly MenuItem[];
  readonly toggle: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) toggle.current?.focus();
  };
  useDismissOutside(open, root, close);

  return (
    <div className="more-picker" ref={root}>
      <button
        ref={toggle}
        className="icon-button"
        aria-label="More actions"
        data-tooltip="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <Icon name="more" />
      </button>
      {open && <MenuList items={items} label="Chat actions" className="more-menu" onClose={close} />}
    </div>
  );
}
