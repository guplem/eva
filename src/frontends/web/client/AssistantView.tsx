/** Assistant mode: chats in the sidebar, the conversation, background tasks. */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { ModelAlias } from "../../../shared/engine-port.ts";
import { api, type ListedSession, type SessionRecord } from "./api.ts";
import { useShownChat, type ChatApprovals } from "./ApprovalCard.tsx";
import { chatPreview, chatState, chatTime, groupChats, matchesSearch, type ChatState } from "./chat-list.ts";
import type { LiveState } from "./live-state.ts";
import { chatTree, Conversation, DeleteChatButton, rootChats } from "./Conversation.tsx";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import { ChatInfoButton, ChatPanel, tasksOf } from "./ChatPanel.tsx";
import { PhoneListHeader, ShowListButton } from "./MainNav.tsx";

const models: readonly ModelAlias[] = ["default", "opus", "sonnet", "haiku"];

interface AssistantViewProps {
  readonly sessions: readonly ListedSession[];
  readonly live: LiveState;
  readonly sidebarOpen: boolean;
  readonly onShowList: () => void;
  readonly onChanged: () => Promise<void>;
  readonly onNavigate: () => void;
  /** The chat that the address names; it opens once it is in the list. */
  readonly linkedChat: SessionRecord | null;
  readonly onLinkedChatOpened: () => void;
  /** Offline and the open problems, shown at the top of the main area. */
  readonly notices: ReactNode;
  readonly approvals: ChatApprovals;
}

export function AssistantView({
  sessions,
  live,
  sidebarOpen,
  onShowList,
  onChanged,
  onNavigate,
  linkedChat,
  onLinkedChatOpened,
  notices,
  approvals,
}: AssistantViewProps): ReactElement {
  const approvalSessionIds = approvals.pending.map((approval) => approval.sessionId);
  const chats = rootChats(sessions.filter((session) => session.mode === "assistant"));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The model comes first in a new chat, and the chat keeps it (lesson 41).
  const [model, setModel] = useState<ModelAlias>("default");
  const [query, setQuery] = useState("");
  const shown = chats.filter((chat) => matchesSearch(chat.title, query));
  const now = new Date();
  // The list knows the turns that ran before this page loaded. The events know the newer ones.
  const isRunning = (sessionId: string): boolean =>
    sessionId in live.steps || sessions.some((session) => session.id === sessionId && session.running);
  const selected = chats.find((chat) => chat.id === selectedId) ?? chats[0];
  const showError = useShowError();
  const tree = selected === undefined ? [] : chatTree(selected, sessions);
  const chat = {
    tree,
    onChanged,
    tasks: tasksOf(
      live.tasks,
      tree.map((session) => session.id),
    ),
  };
  const listRef = useRef<HTMLDivElement>(null);
  useShownChat(
    approvals.onShowChat,
    tree.map((session) => session.id),
  );
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
          <div className="chat-list-header">
            <h2>Chats</h2>
            {/* "New" is short for the header; the name says what it makes. */}
            <button className="primary" aria-label="New chat" onClick={() => void newChat()}>
              <Icon name="plus" /> New
            </button>
          </div>
          <label className="chat-search">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Search chats"
              placeholder="Search chats"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {chats.length > 0 && shown.length === 0 && <span className="chip">No chat matches.</span>}
          {groupChats(shown, timeOf, now).map(({ group, chats: inGroup }) => (
            <section key={group} className="chat-group" aria-label={group}>
              <h3>{group}</h3>
              {inGroup.map((chat) => (
                <ChatItem
                  key={chat.id}
                  chat={chat}
                  time={chatTime(timeOf(chat), now)}
                  state={chatState(
                    chatTree(chat, sessions).map((session) => session.id),
                    isRunning,
                    approvalSessionIds,
                  )}
                  isSelected={chat.id === selected?.id}
                  onSelect={() => {
                    setSelectedId(chat.id);
                    onNavigate();
                  }}
                />
              ))}
            </section>
          ))}
        </div>
        {/* The model is picked before the chat starts (lesson 41). It stays here until the composer holds it. */}
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
        </div>
      </nav>
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Close the list" onClick={onNavigate} />}
      <main className="main">
        {notices}
        {selected === undefined ? (
          <>
            <PhoneListHeader title="Chats" onShowList={onShowList} />
            <div className="empty">No chats yet. Start one with “New chat”.</div>
          </>
        ) : (
          <>
            <div className="main-header">
              <ShowListButton onClick={onShowList} />
              <ChatTitle key={selected.id} chat={selected} onChanged={onChanged} />
              <span className="badge">{selected.modelAlias}</span>
              <ChatInfoButton {...chat} />
              <DeleteChatButton chat={selected} onChanged={onChanged} />
            </div>
            <Conversation root={selected} sessions={sessions} live={live} onChanged={onChanged} approvals={approvals} />
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

/** The time the list sorts a chat by: its last turn, or its start. */
function timeOf(chat: SessionRecord): Date {
  return new Date(chat.lastTurnAt ?? chat.createdAt);
}

const stateLabels: Record<NonNullable<ChatState>, string> = { "needs-you": "Needs you", working: "Working" };

/** One chat in the list: the title, the time, one line of the last message, and its state. */
function ChatItem({
  chat,
  time,
  state,
  isSelected,
  onSelect,
}: {
  readonly chat: SessionRecord;
  readonly time: string;
  readonly state: ChatState;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}): ReactElement {
  return (
    <button className="list-item chat-item" aria-current={isSelected} onClick={onSelect}>
      <span className="chat-item-title">
        {chat.source === "schedule" && <Icon name="clock" label="Schedule" />}
        {chat.title}
      </span>
      <span className="chat-item-time">{time}</span>
      <span className="chat-item-preview">{chatPreview(chat, state)}</span>
      {state !== null && <span className={`status-pill ${state}`}>{stateLabels[state]}</span>}
    </button>
  );
}
