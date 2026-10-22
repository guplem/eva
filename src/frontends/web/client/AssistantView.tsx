/** Assistant mode: chats in the sidebar, the conversation, background tasks. */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { api, type ChatBlocker, type ListedSession, type SessionRecord } from "./api.ts";
import { useShownChat, type ChatApprovals } from "./ApprovalCard.tsx";
import { chatPreview, chatState, chatTime, groupChats, matchesSearch, type ChatState } from "./chat-list.ts";
import { useMarkSeen } from "./seen-chats.ts";
import type { LiveState } from "./live-state.ts";
import { chatSubtitle } from "./chat-details.ts";
import { chatTree, Conversation, rootChats, rootIdOf, type SentMessage } from "./Conversation.tsx";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import {
  ChatHeader,
  ChatStatePill,
  chatListItems,
  useArchiveItem,
  useChatActionRequest,
  type ChatAction,
} from "./ChatHeader.tsx";
import { BackButton } from "./ProjectPage.tsx";
import { useContextMenu, type MenuItem } from "./Menu.tsx";
import { ChatPanel, tasksOf, useChatPanelShown } from "./ChatPanel.tsx";
import { NewChatDraft } from "./NewChatDraft.tsx";

interface AssistantViewProps {
  readonly sessions: readonly ListedSession[];
  readonly live: LiveState;
  readonly sidebarOpen: boolean;
  readonly onShowList: () => void;
  readonly onChanged: () => Promise<void>;
  readonly onNavigate: () => void;
  /** Grows at each tap on Chats while Chats is open on a computer. Each change opens a new chat. */
  readonly newChatRequest: number;
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
  newChatRequest,
  linkedChat,
  onLinkedChatOpened,
  notices,
  approvals,
  blocker,
  voiceNotes,
}: AssistantViewProps): ReactElement {
  const approvalSessionIds = approvals.pending.map((approval) => approval.sessionId);
  const roots = rootChats(sessions.filter((session) => session.mode === "assistant"));
  const active = roots.filter((chat) => !chat.archived);
  const archivedCount = roots.length - active.length;
  const [showArchived, setShowArchived] = useState(false);
  const chats = showArchived ? roots.filter((chat) => chat.archived) : active;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // True while the page shows a new chat before its first message. The chat exists only once it is sent.
  const [drafting, setDrafting] = useState(false);
  const [query, setQuery] = useState("");
  /** An archived chat leaves the page, so the list opens another one. */
  const afterArchive = async (chat: SessionRecord): Promise<void> => {
    if (chat.archived) setSelectedId((current) => (current === chat.id ? null : current));
    await onChanged();
  };
  const archiveItem = useArchiveItem(afterArchive);
  /** Switches the sidebar between the chats and the archived chats. The open chat stays open. */
  const showList = (archived: boolean): void => {
    setShowArchived(archived);
    setQuery("");
  };
  // The turn start lists the new chat, and the chat then opens before its turn is stored.
  const [firstMessage, setFirstMessage] = useState<SentMessage | null>(null);
  const shown = chats.filter((chat) => matchesSearch(chat.title, query));
  const now = new Date();
  // The list knows the turns that ran before this page loaded. The events know the newer ones.
  const isRunning = (sessionId: string): boolean =>
    sessionId in live.steps || sessions.some((session) => session.id === sessionId && session.running);
  // Any root chat, and the chats list first, so a switch between the lists keeps the open chat.
  const selected = drafting ? undefined : (roots.find((chat) => chat.id === selectedId) ?? active[0] ?? chats[0]);
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
  // On a phone, the open list covers the chat.
  useMarkSeen(tree, !sidebarOpen);
  const stateOf = (candidate: SessionRecord): ChatState => {
    const state = chatState(chatTree(candidate, sessions), isRunning, approvalSessionIds);
    // The person reads the open chat now. Its mark reaches the core a moment later.
    return state === "unread" && candidate.id === selected?.id && !sidebarOpen ? null : state;
  };
  // A fork opens as a branch of its first chat, which holds the archive flag.
  const linkedId = linkedChat?.mode === "assistant" ? rootIdOf(linkedChat, sessions) : null;
  // A link can come before the list, so the linked record itself answers until then.
  const linkedArchived = (sessions.find((chat) => chat.id === linkedId) ?? linkedChat)?.archived === true;
  const actionRequest = useChatActionRequest();
  const clearAction = actionRequest.clear;

  /** Opens a chat, and starts a header action when the chat's context menu asks for one. */
  const select = (chatId: string, action?: ChatAction): void => {
    setSelectedId(chatId);
    setDrafting(false);
    if (action === undefined) clearAction();
    else actionRequest.ask(chatId, action);
    onNavigate();
  };

  useEffect(() => {
    if (linkedId === null) return;
    setSelectedId(linkedId);
    setDrafting(false);
    // The list shows where the linked chat lives.
    setShowArchived(linkedArchived);
    setQuery("");
    clearAction();
    onLinkedChatOpened();
  }, [linkedId, linkedArchived, onLinkedChatOpened, clearAction]);

  // The view mounts again at each screen change, so only a request made while it shows opens a new chat.
  const handledRequest = useRef(newChatRequest);
  useEffect(() => {
    if (newChatRequest === handledRequest.current) return;
    handledRequest.current = newChatRequest;
    setDrafting(true);
    clearAction();
  }, [newChatRequest, clearAction]);

  const openNewChat = async (chat: SessionRecord): Promise<void> => {
    await onChanged();
    setSelectedId(chat.id);
    setDrafting(false);
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
            {showArchived ? (
              <>
                <BackButton label="Back to the chats" onClick={() => showList(false)} />
                <h2>Archived</h2>
              </>
            ) : (
              <>
                <h2>Chats</h2>
                {/* "New" is short for the header; the name says what it makes. */}
                <button className="primary wide-only" aria-label="New chat" onClick={() => void newChat()}>
                  <Icon name="plus" /> New
                </button>
              </>
            )}
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
          {showArchived && chats.length === 0 && <span className="chip">No archived chat.</span>}
          {groupChats(shown, timeOf, now).map(({ group, chats: inGroup }) => (
            <section key={group} className="chat-group" aria-label={group}>
              <h3>{group}</h3>
              {inGroup.map((chat) => (
                <ChatItem
                  key={chat.id}
                  chat={chat}
                  time={chatTime(timeOf(chat), now)}
                  state={stateOf(chat)}
                  isSelected={chat.id === selected?.id}
                  onSelect={() => select(chat.id)}
                  onAction={(action) => select(chat.id, action)}
                  archiveItem={archiveItem(chat)}
                />
              ))}
            </section>
          ))}
          {!showArchived && archivedCount > 0 && (
            <button className="ghost archived-link" onClick={() => showList(true)}>
              {/* "Archived", not "Archived chats": the Chats button of the main menu keeps a name of its own. */}
              <Icon name="archive" /> Archived ({archivedCount})
            </button>
          )}
        </div>
        {/* A phone keeps the button at the foot of the list, in reach of the thumb. */}
        {!showArchived && (
          <div className="chat-list-footer phone-only">
            <button className="primary large" onClick={() => void newChat()}>
              <Icon name="plus" /> New chat
            </button>
          </div>
        )}
      </nav>
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Close the list" onClick={onNavigate} />}
      <main className="main">
        {notices}
        {selected === undefined ? (
          <NewChatDraft
            blocker={blocker}
            voiceNotes={voiceNotes}
            onShowList={onShowList}
            onSending={setFirstMessage}
            onStarted={openNewChat}
          />
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
              listHasUnread={active.some((candidate) => stateOf(candidate) === "unread")}
              onArchived={afterArchive}
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
              firstMessage={firstMessage}
            />
          </>
        )}
      </main>
      {/* The inspector is about one chat, so a new chat draft has none. */}
      {selected !== undefined && <ChatPanel shown={panelShown} {...chat} />}
    </div>
  );
}

/** The time the list sorts a chat by: its last turn, or its start. */
function timeOf(chat: SessionRecord): Date {
  return new Date(chat.lastTurnAt ?? chat.createdAt);
}

/** One chat in the list: the title, the time, one line of the last message, and its state. */
function ChatItem({
  chat,
  time,
  state,
  isSelected,
  onSelect,
  onAction,
  archiveItem,
}: {
  readonly chat: SessionRecord;
  readonly time: string;
  readonly state: ChatState;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly onAction: (action: ChatAction) => void;
  readonly archiveItem: MenuItem;
}): ReactElement {
  const { props, menu } = useContextMenu(chatListItems(onSelect, onAction, archiveItem), `Actions of “${chat.title}”`);
  return (
    <>
      <button
        className={`list-item chat-item${state === "unread" ? " unread" : ""}`}
        aria-current={isSelected}
        onClick={onSelect}
        {...props}
      >
        <span className="chat-item-title">
          {chat.source === "schedule" && <Icon name="clock" label="Schedule" />}
          {chat.title}
        </span>
        <span className="chat-item-time">{time}</span>
        <span className="chat-item-preview">{chatPreview(chat, state)}</span>
        <ChatStatePill state={state} />
      </button>
      {menu}
    </>
  );
}
