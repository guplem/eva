/**
 * The header of an open chat: one row with the title, one subtitle, and a "More actions" menu with Rename,
 * Rename automatically, Chat info, Compact, Archive and Delete chat. Rename, Compact and Delete chat ask
 * in a dialog. One row leaves the chat its height. A computer also has a button that hides or shows the chat details
 * column. On a phone, a tap on the title opens the chat details.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { api, type SessionRecord } from "./api.ts";
import { chatStateLabels, type ChatState } from "./chat-list.ts";
import { ChatInfoSheet, chatPanelId, type ChatProps } from "./ChatPanel.tsx";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import { Toast } from "./Toast.tsx";
import { BackButton, ShowListButton } from "./MainNav.tsx";
import { MoreMenu, type MenuItem } from "./Menu.tsx";
import { compactLabel, SummaryChatQuestion } from "./SummaryChatQuestion.tsx";
import { useLeaveGuard } from "./UnsavedChangesDialog.tsx";
import { useEscape } from "./back-layer-hook.ts";
import { dialogBackdropClass } from "./Dialog.tsx";

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

/**
 * The context menu of a chat in a list: the actions that need no open chat first. A list that
 * keeps archived chats apart gives the Archive item.
 */
export function chatListItems(
  onOpen: () => void,
  onAction: (action: ChatAction) => void,
  archive?: MenuItem,
): MenuItem[] {
  return [
    { label: "Open", icon: "chat", onChoose: onOpen },
    { label: "Rename", icon: "pen", onChoose: () => onAction("rename") },
    ...(archive === undefined ? [] : [archive]),
    { label: "Delete chat", icon: "trash", danger: true, onChoose: () => onAction("delete") },
  ];
}

/**
 * "Archive" for a chat in the list, "Unarchive" for an archived one. `onDone` gets the changed chat.
 * A failure shows as a toast.
 */
export function useArchiveItem(onDone: (chat: SessionRecord) => Promise<void>): (chat: SessionRecord) => MenuItem {
  const showError = useShowError();
  return (chat) => ({
    label: chat.archived ? "Unarchive" : "Archive",
    icon: "archive",
    onChoose: () => {
      api
        .archive(chat.id, !chat.archived)
        .then(onDone)
        .catch((caught: unknown) => showError(caught));
    },
  });
}

/** The state of a chat in a list, as a word on a pill with a dot. No state shows no pill. */
export function ChatStatePill({ state }: { readonly state: ChatState }): ReactElement | null {
  return state === null ? null : <span className={`status-pill ${state}`}>{chatStateLabels[state]}</span>;
}

/** The phone breakpoint of `styles.css`. */
const phoneQuery = "(max-width: 760px)";

export function useIsPhone(): boolean {
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
  /** A phone shows the list button, or this arrow when the chat has a page above it, such as its project. */
  readonly back?: { readonly label: string; readonly onClick: () => void };
  readonly onShowList?: () => void;
  /** True when another chat in the list has an answer that the person did not see. */
  readonly listHasUnread?: boolean;
  /** Whether a computer shows the chat details column. */
  readonly panelShown: boolean;
  readonly onTogglePanel: () => void;
  readonly onChanged: () => Promise<void>;
  /** An action that the header starts with, asked from the chat's context menu in a list. */
  readonly startWith?: ChatAction | null;
  /** Given when the chat's list keeps archived chats apart: the menu then has Archive, and this runs after it. */
  readonly onArchived?: (chat: SessionRecord) => Promise<void>;
}

export function ChatHeader({
  chat,
  details,
  subtitle,
  extra,
  back,
  onShowList = () => undefined,
  listHasUnread = false,
  panelShown,
  onTogglePanel,
  onChanged,
  startWith = null,
  onArchived,
}: ChatHeaderProps): ReactElement {
  const isPhone = useIsPhone();
  const archiveItem = useArchiveItem(onArchived ?? onChanged);
  const [renaming, setRenaming] = useState(startWith === "rename");
  // The chat whose info sheet is open. A fork that opens another chat closes the sheet (issue 523).
  const [infoChat, setInfoChat] = useState<string | null>(null);
  const infoOpen = infoChat === chat.id;
  const [asking, setAsking] = useState(startWith === "delete");
  const [summarizing, setSummarizing] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  // A chosen menu item leaves the page, so focus goes back to the button that opened the sheet or the question.
  const opener = useRef<HTMLElement | null>(null);
  const closeInfo = useCallback(() => {
    setInfoChat(null);
    opener.current?.focus();
  }, []);
  const openInfo = (from: HTMLElement | null): void => {
    opener.current = from;
    setInfoChat(chat.id);
  };

  const autoRename = useAutoRename(onChanged);
  const items: MenuItem[] = [
    { label: "Rename", icon: "pen", onChoose: () => setRenaming(true) },
    // The branch on screen, as for Compact: a chat often ends far from where it began.
    autoRename.item(details.shownId ?? chat.id, "chat"),
  ];
  // A computer shows the details in the inspector column.
  if (isPhone) items.push({ label: "Chat info", icon: "chat", onChoose: () => openInfo(moreButton.current) });
  // Every chat has it, open or closed: a long chat can also confuse the model (issue 522).
  items.push({ label: compactLabel, icon: "chat", onChoose: () => setSummarizing(true) });
  if (onArchived !== undefined) items.push(archiveItem(chat));
  items.push({ label: "Delete chat", icon: "trash", danger: true, onChoose: () => setAsking(true) });

  return (
    <div className="main-header chat-header">
      {back === undefined ? (
        <ShowListButton onClick={onShowList} unread={listHasUnread} />
      ) : (
        <BackButton label={back.label} onClick={back.onClick} className="phone-only" />
      )}
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
      <MoreMenu items={items} label="Chat actions" toggle={moreButton} />
      {renaming && (
        <RenameDialog
          heading="Rename chat"
          label="Chat title"
          original={chat.title}
          onSave={(title) => api.rename(chat.id, title)}
          onEnd={() => {
            setRenaming(false);
            moreButton.current?.focus();
          }}
          onChanged={onChanged}
        />
      )}
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
      {summarizing && (
        <SummaryChatQuestion
          sessionId={details.shownId ?? chat.id}
          onKeep={() => {
            setSummarizing(false);
            moreButton.current?.focus();
          }}
          onChanged={onChanged}
        />
      )}
      {infoOpen && <ChatInfoSheet {...details} onClose={closeInfo} />}
      {autoRename.wait}
    </div>
  );
}

/**
 * "Rename automatically" for the chat header and the fork menu (#996). A model names the chat, or the
 * fork, from the turns of the branch, by the person's chat name rules. It asks nothing first: a
 * rename is easy to undo. A toast shows the wait, and a failure shows its reason.
 */
export function useAutoRename(onDone: () => Promise<void>): {
  readonly item: (branchId: string, target: "chat" | "fork") => MenuItem;
  readonly wait: ReactElement | null;
} {
  const [working, setWorking] = useState<"chat" | "fork" | null>(null);
  const showError = useShowError();
  const label = `Eva names the ${working ?? "chat"}.`;
  return {
    item: (branchId, target) => ({
      label: "Rename automatically",
      icon: "wand",
      // A second name while one waits would only race the first.
      disabled: working !== null,
      onChoose: () => {
        if (working !== null) return;
        setWorking(target);
        api
          .autoRename(branchId, target)
          .then(onDone)
          .catch((caught: unknown) => showError(caught))
          .finally(() => setWorking(null));
      },
    }),
    wait:
      working !== null ? (
        <Toast message={label} role={null}>
          <ProgressBar label={label} />
        </Toast>
      ) : null,
  };
}

/**
 * Asks for a new name: the title of a chat, or the name of a fork. Enter saves. Escape or Cancel keeps
 * the old name, after a question when the name changed.
 */
export function RenameDialog({
  heading,
  label,
  original,
  onSave,
  onEnd,
  onChanged,
}: {
  /** Such as "Rename chat". */
  readonly heading: string;
  /** The label of the field, such as "Chat title". */
  readonly label: string;
  readonly original: string;
  readonly onSave: (name: string) => Promise<unknown>;
  /** Closes the dialog, with the new name saved or not. */
  readonly onEnd: () => void;
  readonly onChanged: () => Promise<void>;
}): ReactElement {
  const [draft, setDraft] = useState(original);
  // A second Enter while the request runs must not send it again.
  const [saving, setSaving] = useState(false);
  const showError = useShowError();

  /** True means that the title saved. */
  const save = async (): Promise<boolean> => {
    if (saving) return false;
    // A fork shows "Fork N" until the person names it. A save of that same text must not fix the number.
    if (draft === original) {
      onEnd();
      return true;
    }
    setSaving(true);
    try {
      await onSave(draft);
      await onChanged();
      onEnd();
      return true;
    } catch (caught) {
      // The dialog stays open, so the person can try again.
      showError(caught);
      setSaving(false);
      return false;
    }
  };
  // While the rename runs, the guard waits: the request is sent already.
  const askFirst = useLeaveGuard(!saving && draft.trim() !== "" && draft !== original, save);
  const cancel = useCallback(() => askFirst(onEnd), [askFirst, onEnd]);
  useEscape(cancel, saving);

  return (
    // A tap beside the dialog does not close it, so a slip never loses a half-written title.
    <div className={dialogBackdropClass("schedule-backdrop")}>
      <div className="schedule-sheet" role="dialog" aria-modal="true" aria-label={heading}>
        <h2>{heading}</h2>
        <form
          className="schedule-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            {label}
            <input
              value={draft}
              autoFocus
              // Selected, so the person can type a new title at once.
              onFocus={(event) => event.target.select()}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <div className="schedule-sheet-actions">
            <button type="submit" className="primary" disabled={saving || draft.trim() === ""}>
              Save
            </button>
            <span className="spacer" />
            <button type="button" onClick={cancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Deletes a chat with every branch, or one branch, in every front end, after the person says yes in a
 * dialog. The forks of a deleted branch stay (issue 647).
 */
export function DeleteQuestion({
  chat,
  fork = false,
  onKeep,
  onChanged,
}: {
  readonly chat: SessionRecord;
  /** The question names a branch, such as "Fork 1", and not the whole chat. */
  readonly fork?: string | false;
  readonly onKeep: () => void;
  readonly onChanged: () => Promise<void>;
}): ReactElement {
  const [deleting, setDeleting] = useState(false);
  const showError = useShowError();
  useEscape(onKeep, deleting);
  const remove = async (): Promise<void> => {
    if (deleting) return;
    setDeleting(true);
    try {
      if (fork === false) await api.deleteChat(chat.id);
      else await api.deleteBranch(chat.id);
      await onChanged();
    } catch (caught) {
      showError(caught);
      setDeleting(false);
    }
  };
  return (
    <div
      className={dialogBackdropClass("schedule-backdrop")}
      // A click inside the dialog also reaches the scrim, so only a click on the scrim itself keeps the chat.
      onClick={(event) => event.target === event.currentTarget && !deleting && onKeep()}
    >
      <div
        className="schedule-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={fork === false ? `Delete “${chat.title}”?` : `Delete ${fork}?`}
      >
        <h2>{fork === false ? `Delete “${chat.title}”?` : `Delete ${fork}?`}</h2>
        <p>
          {fork === false
            ? "Eva deletes the chat and its forks everywhere."
            : "Eva deletes this branch everywhere. Its forks stay."}
        </p>
        <div className="schedule-sheet-actions">
          {/* Not disabled: a disabled button drops the focus, and a failed delete must leave it here. */}
          <button className="danger" aria-disabled={deleting} onClick={() => void remove()}>
            Delete
          </button>
          <span className="spacer" />
          {/* Focus comes here, so a keyboard or a screen reader reaches the question at once. */}
          <button autoFocus onClick={onKeep}>
            Keep
          </button>
        </div>
        {deleting && <ProgressBar label={fork === false ? "Eva deletes the chat." : "Eva deletes the fork."} />}
      </div>
    </div>
  );
}
