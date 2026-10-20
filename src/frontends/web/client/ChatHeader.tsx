/**
 * The header of an open chat: the title, one subtitle line, and a "More actions" menu with Rename,
 * Chat info and Delete chat. On a phone it is one row, and a tap on the title opens the chat details.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { api, type SessionRecord } from "./api.ts";
import { ChatInfoSheet, type ChatProps } from "./ChatPanel.tsx";
import { useShowError } from "./error-toast.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { ShowListButton } from "./MainNav.tsx";

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
  readonly onChanged: () => Promise<void>;
}

export function ChatHeader({ chat, details, subtitle, extra, onShowList, onChanged }: ChatHeaderProps): ReactElement {
  const isPhone = useIsPhone();
  const [draft, setDraft] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const closeInfo = useCallback(() => setInfoOpen(false), []);

  const items: MenuItem[] = [{ label: "Rename", icon: "pen", onChoose: () => setDraft(chat.title) }];
  // A computer shows the details in the inspector column.
  if (isPhone) items.push({ label: "Chat info", icon: "chat", onChoose: () => setInfoOpen(true) });
  items.push({ label: "Delete chat", icon: "x", danger: true, onChoose: () => setAsking(true) });

  return (
    <div className="main-header chat-header">
      <ShowListButton onClick={onShowList} />
      {draft === null ? (
        <div className="header-text">
          <h1>
            {isPhone ? (
              <button
                className="chat-title-button"
                title="Show the chat details"
                aria-haspopup="dialog"
                onClick={() => setInfoOpen(true)}
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
        <RenameForm chat={chat} draft={draft} onDraft={setDraft} onChanged={onChanged} />
      )}
      {extra}
      <MoreMenu items={items} />
      {asking && <DeleteQuestion chat={chat} onKeep={() => setAsking(false)} onChanged={onChanged} />}
      {infoOpen && <ChatInfoSheet {...details} onClose={closeInfo} />}
    </div>
  );
}

/** The title as a field. Enter saves; Escape keeps the old title. */
function RenameForm({
  chat,
  draft,
  onDraft,
  onChanged,
}: {
  readonly chat: SessionRecord;
  readonly draft: string;
  readonly onDraft: (draft: string | null) => void;
  readonly onChanged: () => Promise<void>;
}): ReactElement {
  // A second Enter while the request runs must not send it again.
  const [saving, setSaving] = useState(false);
  const showError = useShowError();

  const save = async (title: string): Promise<void> => {
    setSaving(true);
    try {
      await api.rename(chat.id, title);
      await onChanged();
      onDraft(null);
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="rename-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving) void save(draft);
      }}
    >
      <input
        aria-label="Chat title"
        value={draft}
        autoFocus
        // Selected, so the person can type a new title at once.
        onFocus={(event) => event.target.select()}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDraft(null);
        }}
      />
      <button className="primary" type="submit" disabled={saving || draft.trim() === ""}>
        Save
      </button>
      <button type="button" onClick={() => onDraft(null)}>
        Cancel
      </button>
    </form>
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
      <button className="danger" disabled={deleting} onClick={() => void remove()}>
        Delete
      </button>
      <button onClick={onKeep}>Keep</button>
    </div>
  );
}

interface MenuItem {
  readonly label: string;
  readonly icon: IconName;
  readonly danger?: boolean;
  readonly onChoose: () => void;
}

/** The less common actions of a chat. Escape or a tap outside closes it; the arrow keys move between the items. */
function MoreMenu({ items }: { readonly items: readonly MenuItem[] }): ReactElement {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector("button")?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    const onPointer = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const moveFocus = (step: number): void => {
    const buttons = [...(menu.current?.querySelectorAll("button") ?? [])];
    const current = buttons.findIndex((button) => button === document.activeElement);
    buttons[(current + step + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div className="more-picker" ref={root}>
      <button
        ref={toggle}
        className="icon-button"
        aria-label="More actions"
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div
          className="more-menu"
          role="menu"
          aria-label="Chat actions"
          ref={menu}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") moveFocus(1);
            else if (event.key === "ArrowUp") moveFocus(-1);
            else return;
            event.preventDefault();
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={item.danger === true ? "danger" : undefined}
              onClick={() => {
                setOpen(false);
                item.onChoose();
              }}
            >
              <Icon name={item.icon} /> {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
