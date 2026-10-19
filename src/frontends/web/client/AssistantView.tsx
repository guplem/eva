/** Assistant mode: chats in the sidebar, the conversation, background tasks. */
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { ModelAlias } from "../../../shared/engine-port.ts";
import { api, type SessionRecord } from "./api.ts";
import type { LiveState } from "./live-state.ts";
import { chatTree, Conversation, DeleteChatButton, rootChats } from "./Conversation.tsx";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import { ChatInfoButton, ChatPanel, tasksOf } from "./ChatPanel.tsx";

const models: readonly ModelAlias[] = ["default", "opus", "sonnet", "haiku"];

interface AssistantViewProps {
  readonly sessions: readonly SessionRecord[];
  readonly live: LiveState;
  readonly sidebarOpen: boolean;
  readonly onChanged: () => Promise<void>;
  readonly onNavigate: () => void;
  /** The chat that the address names; it opens once it is in the list. */
  readonly linkedChat: SessionRecord | null;
  readonly onLinkedChatOpened: () => void;
  readonly onOpenSchedules: () => void;
}

export function AssistantView({
  sessions,
  live,
  sidebarOpen,
  onChanged,
  onNavigate,
  linkedChat,
  onLinkedChatOpened,
  onOpenSchedules,
}: AssistantViewProps): ReactElement {
  const chats = rootChats(sessions.filter((session) => session.mode === "assistant"));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The model comes first in a new chat, and the chat keeps it (lesson 41).
  const [model, setModel] = useState<ModelAlias>("default");
  const selected = chats.find((chat) => chat.id === selectedId) ?? chats[0];
  const showError = useShowError();
  const tree = selected === undefined ? [] : chatTree(selected, sessions);
  const chat = {
    tree,
    tasks: tasksOf(
      live.tasks,
      tree.map((session) => session.id),
    ),
  };
  const listRef = useRef<HTMLDivElement>(null);
  const linkedId = linkedChat?.mode === "assistant" ? linkedChat.id : null;

  useEffect(() => {
    if (linkedId === null) return;
    setSelectedId(linkedId);
    onLinkedChatOpened();
  }, [linkedId, onLinkedChatOpened]);

  const newChat = async (): Promise<void> => {
    try {
      const chat = await api.newAssistantChat(model);
      await onChanged();
      setSelectedId(chat.id);
      // A new chat goes first in the list. Show it, because the list can be scrolled down.
      listRef.current?.scrollTo({ top: 0 });
      onNavigate();
    } catch (caught) {
      showError(caught);
    }
  };

  return (
    <div className="layout">
      <nav className={`sidebar has-footer${sidebarOpen ? " open" : ""}`} aria-label="Chats">
        <div className="sidebar-list" ref={listRef}>
          <div className="sidebar-heading">
            <h2>Schedules</h2>
            <button
              className="icon-button"
              aria-label="Open schedules"
              title="Open schedules"
              onClick={() => {
                onOpenSchedules();
                onNavigate();
              }}
            >
              <Icon name="clock" />
            </button>
          </div>
          {chats.filter((chat) => chat.source === "schedule").length === 0 && (
            <span className="chip">
              No schedule has run yet. Add one on the Schedules page (
              <Icon name="clock" label="the clock button" />
              ).
            </span>
          )}
          <h2>Chats</h2>
          {chats.map((chat) => (
            <button
              key={chat.id}
              className="list-item"
              aria-current={chat.id === selected?.id}
              onClick={() => {
                setSelectedId(chat.id);
                onNavigate();
              }}
            >
              {/* Hidden from a screen reader: the line below the title already says "schedule". */}
              {chat.source === "schedule" && (
                <>
                  <Icon name="clock" />{" "}
                </>
              )}
              {chat.title}
              <div className="muted">{chat.source}</div>
            </button>
          ))}
        </div>
        {/* The controls stay at the bottom, in reach of a thumb. The model comes first (lesson 41). */}
        <div className="sidebar-footer">
          <label>
            Model for a new chat
            <select value={model} onChange={(event) => setModel(event.target.value as ModelAlias)}>
              {models.map((alias) => (
                <option key={alias} value={alias}>
                  {alias}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={() => void newChat()}>
            New chat
          </button>
        </div>
      </nav>
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Close the list" onClick={onNavigate} />}
      <main className="main">
        {selected === undefined ? (
          <div className="empty">No chats yet. Start one with “New chat”.</div>
        ) : (
          <>
            <div className="main-header">
              <ChatTitle key={selected.id} chat={selected} onChanged={onChanged} />
              <span className="badge">{selected.modelAlias}</span>
              <ChatInfoButton {...chat} />
              <DeleteChatButton chat={selected} onChanged={onChanged} />
            </div>
            <Conversation root={selected} sessions={sessions} live={live} onChanged={onChanged} />
          </>
        )}
      </main>
      <ChatPanel {...chat} />
    </div>
  );
}

/** The chat's title, and a pencil that turns it into a field. Enter saves; Escape keeps the old title. */
function ChatTitle({
  chat,
  onChanged,
}: {
  readonly chat: SessionRecord;
  readonly onChanged: () => Promise<void>;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  // A second Enter while the request runs must not send it again.
  const [saving, setSaving] = useState(false);
  const showError = useShowError();

  const save = async (title: string): Promise<void> => {
    setSaving(true);
    try {
      await api.rename(chat.id, title);
      await onChanged();
      setDraft(null);
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  if (draft === null) {
    return (
      <>
        <h1>{chat.title}</h1>
        <button
          className="icon-button"
          aria-label="Rename this chat"
          title="Rename this chat"
          onClick={() => setDraft(chat.title)}
        >
          <Icon name="pen" />
        </button>
      </>
    );
  }
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
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setDraft(null);
        }}
      />
      <button className="primary" type="submit" disabled={saving || draft.trim() === ""}>
        Save
      </button>
      <button type="button" onClick={() => setDraft(null)}>
        Cancel
      </button>
    </form>
  );
}
