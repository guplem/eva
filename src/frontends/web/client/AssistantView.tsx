/** Assistant mode: chats in the sidebar, the conversation, background tasks. */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { api, type ChatBlocker, type ListedSession, type SessionRecord } from "./api.ts";
import { useShownChat, type ChatApprovals } from "./ApprovalCard.tsx";
import { chatPreview, chatState, chatTime, groupChats, matchesSearch, type ChatState } from "./chat-list.ts";
import type { LiveState } from "./live-state.ts";
import { chatSubtitle } from "./chat-details.ts";
import { chatTree, Conversation, rootChats } from "./Conversation.tsx";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import { ChatHeader, chatListItems, useChatActionRequest, type ChatAction } from "./ChatHeader.tsx";
import { useContextMenu } from "./Menu.tsx";
import { ChatPanel, tasksOf, useChatPanelShown } from "./ChatPanel.tsx";
import { NewChatDraft } from "./NewChatDraft.tsx";

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
  /** The missing setup step that stops every chat, or null. */
  readonly blocker: ChatBlocker | null;
  /** True when Eva's machine can turn a voice note into text. */
  readonly voiceNotes: boolean;
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
  blocker,
  voiceNotes,
}: AssistantViewProps): ReactElement {
  const approvalSessionIds = approvals.pending.map((approval) => approval.sessionId);
  const chats = rootChats(sessions.filter((session) => session.mode === "assistant"));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const shown = chats.filter((chat) => matchesSearch(chat.title, query));
  const now = new Date();
  // The list knows the turns that ran before this page loaded. The events know the newer ones.
  const isRunning = (sessionId: string): boolean =>
    sessionId in live.steps || sessions.some((session) => session.id === sessionId && session.running);
  const selected = chats.find((chat) => chat.id === selectedId) ?? chats[0];
  const showError = useShowError();
  const tree = selected === undefined ? [] : chatTree(selected, sessions);
  const [panelShown, togglePanel] = useChatPanelShown();
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
  const actionRequest = useChatActionRequest();
  const clearAction = actionRequest.clear;

  /** Opens a chat, and starts a header action when the chat's context menu asks for one. */
  const select = (chatId: string, action?: ChatAction): void => {
    setSelectedId(chatId);
    if (action === undefined) clearAction();
    else actionRequest.ask(chatId, action);
    onNavigate();
  };

  useEffect(() => {
    if (linkedId === null) return;
    setSelectedId(linkedId);
    clearAction();
    onLinkedChatOpened();
  }, [linkedId, onLinkedChatOpened, clearAction]);

  const openNewChat = async (chat: SessionRecord): Promise<void> => {
    await onChanged();
    setSelectedId(chat.id);
    clearAction();
    // A new chat goes first in the list. Show it, because the list can be scrolled down.
    listRef.current?.scrollTo({ top: 0 });
    onNavigate();
  };

  const newChat = async (): Promise<void> => {
    try {
      // The composer chip picks another model before the first message (lesson 41).
      await openNewChat(await api.newAssistantChat("default"));
    } catch (caught) {
      showError(caught);
    }
  };

  return (
    <div className="layout">
      <nav className={`sidebar has-list${sidebarOpen ? " open" : ""}`} aria-label="Chats">
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
                  onSelect={() => select(chat.id)}
                  onAction={(action) => select(chat.id, action)}
                />
              ))}
            </section>
          ))}
        </div>
      </nav>
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Close the list" onClick={onNavigate} />}
      <main className="main">
        {notices}
        {selected === undefined ? (
          <NewChatDraft blocker={blocker} voiceNotes={voiceNotes} onShowList={onShowList} onStarted={openNewChat} />
        ) : (
          <>
            <ChatHeader
              key={actionRequest.headerProps(selected.id).key}
              startWith={actionRequest.headerProps(selected.id).startWith}
              chat={selected}
              details={chat}
              subtitle={chatSubtitle(
                selected,
                tree.some((session) => isRunning(session.id)),
              )}
              onShowList={onShowList}
              panelShown={panelShown}
              onTogglePanel={togglePanel}
              onChanged={onChanged}
            />
            <Conversation
              root={selected}
              sessions={sessions}
              live={live}
              onChanged={onChanged}
              approvals={approvals}
              blocker={blocker}
              voiceNotes={voiceNotes}
            />
          </>
        )}
      </main>
      {/* The inspector is about one chat, so a new chat draft has none. */}
      {selected !== undefined && panelShown && <ChatPanel {...chat} />}
    </div>
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
  onAction,
}: {
  readonly chat: SessionRecord;
  readonly time: string;
  readonly state: ChatState;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly onAction: (action: ChatAction) => void;
}): ReactElement {
  const { props, menu } = useContextMenu(chatListItems(onSelect, onAction), `Actions of “${chat.title}”`);
  return (
    <>
      <button className="list-item chat-item" aria-current={isSelected} onClick={onSelect} {...props}>
        <span className="chat-item-title">
          {chat.source === "schedule" && <Icon name="clock" label="Schedule" />}
          {chat.title}
        </span>
        <span className="chat-item-time">{time}</span>
        <span className="chat-item-preview">{chatPreview(chat, state)}</span>
        {state !== null && <span className={`status-pill ${state}`}>{stateLabels[state]}</span>}
      </button>
      {menu}
    </>
  );
}
