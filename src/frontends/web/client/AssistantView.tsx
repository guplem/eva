/** Assistant mode: chats in the sidebar, the conversation, background tasks. */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { ChatBlocker, ListedSession, SessionRecord } from "./api.ts";
import { useShownChat, type ChatApprovals } from "./ApprovalCard.tsx";
import { chatForks, chatPreview, chatState, chatTime, groupChats, matchesSearch, type ChatState } from "./chat-list.ts";
import { useMarkSeen } from "./seen-chats.ts";
import { latestId, type LiveState } from "./live-state.ts";
import { chatSubtitle } from "./chat-details.ts";
import { seenPart } from "./branch-path.ts";
import { BranchesButton, useBranchStates, useForkMenu, useShownBranch } from "./Branches.tsx";
import { chatTree, Conversation, rootChats, rootIdOf, type SentMessage } from "./Conversation.tsx";
import { Icon } from "./icons.tsx";
import {
  ChatHeader,
  ChatStatePill,
  chatListItems,
  useArchiveItem,
  useChatActionRequest,
  type ChatAction,
} from "./ChatHeader.tsx";
import { BackButton } from "./MainNav.tsx";
import { useContextMenu, type MenuItem } from "./Menu.tsx";
import { ChatPanel, tasksOf, useChatPanelShown } from "./ChatPanel.tsx";
import { NewChatDraft } from "./NewChatDraft.tsx";
import { assistantChatAddressOf, assistantChatIdOf, linkedChatIdOf, newChatPageId } from "./navigation.ts";
import { goTo, replaceAddress } from "./back-layers.ts";
import { useBackLayer } from "./back-layer-hook.ts";

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
  /** `address` names the page of the opened chat, so the used link leaves the history. */
  readonly onLinkedChatOpened: (address?: string) => void;
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
  // The address names the open chat, so Back goes to the chat or the list before.
  const [selectedId, setSelectedId] = useState(() => assistantChatIdOf(window.location.hash));
  useEffect(() => {
    // A Telegram link names no chat of Chats: the link effect opens its chat, with no flash of another.
    const onHashChange = (): void => {
      if (linkedChatIdOf(window.location.hash) === null) setSelectedId(assistantChatIdOf(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const [query, setQuery] = useState("");
  /** An archived chat leaves the page, so the list opens another one. */
  const afterArchive = async (chat: SessionRecord): Promise<void> => {
    // The address, not this render: the person may have opened another chat while the request ran.
    if (chat.archived && assistantChatIdOf(window.location.hash) === chat.id) {
      setSelectedId(null);
      replaceAddress(assistantChatAddressOf(null));
    }
    await onChanged();
  };
  const archiveItem = useArchiveItem(afterArchive);
  /** Switches the sidebar between the chats and the archived chats. The open chat stays open. */
  const showList = (archived: boolean): void => {
    setShowArchived(archived);
    setQuery("");
  };
  // Back from the archived chats shows the chats again, and Back from an archived chat shows the archived chats.
  useBackLayer(
    showArchived,
    () => showList(false),
    "archived",
    () => setShowArchived(true),
  );
  // The turn start lists the new chat, and the chat then opens before its turn is stored.
  const [firstMessage, setFirstMessage] = useState<SentMessage | null>(null);
  const shown = chats.filter((chat) => matchesSearch(chat.title, query));
  const now = new Date();
  // The list knows the turns that ran before this page loaded. The events know the newer ones.
  const isRunning = (sessionId: string): boolean =>
    sessionId in live.steps || sessions.some((session) => session.id === sessionId && session.running);
  // Any root chat, and the chats list first, so a switch between the lists keeps the open chat.
  // True while the page shows a new chat before its first message. The chat exists only once it is sent.
  const drafting = selectedId === newChatPageId;
  // A deleted first branch gives its place to a fork (issue 647). Until the list knows it, the old record answers.
  const selectedNow = selectedId === null ? null : latestId(selectedId, live.heirs);
  const selected = drafting
    ? undefined
    : (roots.find((chat) => chat.id === selectedNow) ??
      roots.find((chat) => chat.id === selectedId) ??
      active[0] ??
      chats[0]);
  const tree = selected === undefined ? [] : chatTree(selected, sessions);
  // A fork that the person picks in the list opens like a link to it.
  const [pickedBranchId, setPickedBranchId] = useState<string | null>(null);
  const branch = useShownBranch(tree, linkedChat?.id ?? pickedBranchId, live.heirs);
  useEffect(() => {
    // The address names the fork that took the place of the deleted first branch, so a reload opens it.
    if (selectedNow === null || selectedNow === selectedId || selected?.id !== selectedNow) return;
    if (assistantChatIdOf(window.location.hash) === selectedId) replaceAddress(assistantChatAddressOf(selectedNow));
    setSelectedId(selectedNow);
  }, [selectedNow, selectedId, selected?.id]);
  useEffect(() => {
    // Cleared once shown, so the same fork can be picked again later.
    if (pickedBranchId !== null && branch.id === pickedBranchId) setPickedBranchId(null);
  }, [branch.id, pickedBranchId]);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const toggleForks = (chatId: string): void =>
    setExpandedIds((current) => {
      const next = new Set(current);
      if (!next.delete(chatId)) next.add(chatId);
      return next;
    });
  const states = useBranchStates(tree, branch.id, approvals.pending, live);
  const [panelShown, togglePanel] = useChatPanelShown();
  const chat = {
    tree,
    shownId: branch.id,
    sessions,
    onChanged,
    tasks: tasksOf(
      live.tasks,
      tree.map((session) => session.id),
    ),
  };
  const listRef = useRef<HTMLDivElement>(null);
  // Only the shown branch shows its requests as cards, so a hidden branch gets the notice.
  useShownChat(approvals.onShowChat, branch.id === null ? [] : [branch.id]);
  // On a phone, the open list covers the chat.
  useMarkSeen(branch.id === null ? [] : seenPart(tree, branch.id), !sidebarOpen);
  const stateOf = (candidate: SessionRecord): ChatState => {
    const state = chatState(chatTree(candidate, sessions), isRunning, approvalSessionIds);
    // The person reads the open chat now. Its mark reaches the core a moment later.
    return state === "unread" && candidate.id === selected?.id && !sidebarOpen ? null : state;
  };
  // A fork opens as a branch of its first chat, which holds the archive flag.
  const linkedId = linkedChat?.mode === "assistant" ? rootIdOf(linkedChat, sessions) : null;
  // A link can come before the list, so the linked record itself answers until then.
  const linkedArchived = (sessions.find((chat) => chat.id === linkedId) ?? linkedChat)?.archived === true;
  const listHasUnread = active.some((candidate) => stateOf(candidate) === "unread");
  const actionRequest = useChatActionRequest();
  const clearAction = actionRequest.clear;

  /** Opens a chat, and starts a header action when the chat's context menu asks for one. */
  const select = (chatId: string, action?: ChatAction): void => {
    goTo(assistantChatAddressOf(chatId), () => setSelectedId(chatId));
    if (action === undefined) clearAction();
    else actionRequest.ask(chatId, action);
    onNavigate();
  };

  /** Opens one branch of a chat from the list. */
  const selectBranch = (chatId: string, branchId: string): void => {
    if (chatId === selected?.id) branch.show(branchId);
    else setPickedBranchId(branchId);
    select(chatId);
  };

  useEffect(() => {
    if (linkedId === null) return;
    setSelectedId(linkedId);
    // The list shows where the linked chat lives.
    setShowArchived(linkedArchived);
    setQuery("");
    clearAction();
    onLinkedChatOpened(assistantChatAddressOf(linkedId));
  }, [linkedId, linkedArchived, onLinkedChatOpened, clearAction]);

  // The view mounts again at each screen change, so only a request made while it shows opens a new chat.
  const handledRequest = useRef(newChatRequest);
  useEffect(() => {
    if (newChatRequest === handledRequest.current) return;
    handledRequest.current = newChatRequest;
    goTo(assistantChatAddressOf(newChatPageId), () => setSelectedId(newChatPageId));
    clearAction();
  }, [newChatRequest, clearAction]);

  const openNewChat = async (chat: SessionRecord): Promise<void> => {
    await onChanged();
    // The chat takes the place of the New chat page, so Back does not open the page again.
    setSelectedId(chat.id);
    replaceAddress(assistantChatAddressOf(chat.id));
    clearAction();
    // A new chat goes first in the list. Show it, because the list can be scrolled down.
    listRef.current?.scrollTo({ top: 0 });
    onNavigate();
  };

  /** Shows the New chat page. Its first message makes the chat, so a tap leaves no empty chat behind. */
  const newChat = (): void => {
    goTo(assistantChatAddressOf(newChatPageId), () => setSelectedId(newChatPageId));
    clearAction();
    // The new chat goes first in the list. A phone hides the list now, and a hidden list does not scroll.
    listRef.current?.scrollTo({ top: 0 });
    onNavigate();
  };

  return (
    <div className="layout">
      <nav className={`sidebar has-list${sidebarOpen ? " open" : ""}`} aria-label="Chats">
        <div className="sidebar-list" ref={listRef}>
          <div className="chat-list-header">
            {showArchived ? (
              <>
                <BackButton label="Back to the chats" onClick={() => showList(false)} />
                <h2>
                  <Icon name="archive" /> Archived
                </h2>
              </>
            ) : (
              <>
                <h2>Chats</h2>
                {/* "New" is short for the header; the name says what it makes. */}
                <button className="primary wide-only" aria-label="New chat" onClick={newChat}>
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
                  forks={chatForks(chatTree(chat, sessions)).map(({ session, name }) => {
                    const state = chatState([session], isRunning, approvalSessionIds);
                    return {
                      session,
                      name,
                      preview: chatPreview(session, state),
                      state,
                      isShown: chat.id === selected?.id && session.id === branch.id,
                    };
                  })}
                  forksOpen={expandedIds.has(chat.id)}
                  onToggleForks={() => toggleForks(chat.id)}
                  onSelectFork={(branchId) => selectBranch(chat.id, branchId)}
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
            <button className="primary large" onClick={newChat}>
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
            listHasUnread={listHasUnread}
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
              listHasUnread={listHasUnread}
              onArchived={afterArchive}
              panelShown={panelShown}
              extra={<BranchesButton tree={tree} shown={branch} states={states} />}
              onTogglePanel={togglePanel}
              onChanged={onChanged}
            />
            <Conversation
              root={selected}
              shown={branch}
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

/** One branch of a chat in the list. */
interface ForkItem {
  readonly session: SessionRecord;
  readonly name: string;
  readonly preview: string;
  readonly state: ChatState;
  readonly isShown: boolean;
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
  forks,
  forksOpen,
  onToggleForks,
  onSelectFork,
}: {
  readonly chat: SessionRecord;
  readonly time: string;
  readonly state: ChatState;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly onAction: (action: ChatAction) => void;
  readonly archiveItem: MenuItem;
  /** Each branch of a chat that has forks, the main line first. Empty for a chat with no fork. */
  readonly forks: readonly ForkItem[];
  readonly forksOpen: boolean;
  readonly onToggleForks: () => void;
  readonly onSelectFork: (branchId: string) => void;
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
      {/* A sibling of the row, not a child: a button cannot hold a button. */}
      {forks.length > 0 && (
        <button className="ghost chat-forks-toggle" aria-expanded={forksOpen} onClick={onToggleForks}>
          <Icon name="branch" /> {forks.length} branches <Icon name="down" />
        </button>
      )}
      {forksOpen && forks.length > 0 && (
        <ul className="chat-forks" aria-label={`Branches of “${chat.title}”`}>
          {forks.map((fork) => (
            <ForkRow key={fork.session.id} fork={fork} onSelect={() => onSelectFork(fork.session.id)} />
          ))}
        </ul>
      )}
      {menu}
    </>
  );
}

/** One branch under a chat in the list, with the branch menu. The main line has it too (issue 647). */
function ForkRow({ fork, onSelect }: { readonly fork: ForkItem; readonly onSelect: () => void }): ReactElement {
  const { props, parts } = useForkMenu(fork.session, fork.name, onSelect);
  return (
    <li>
      <button
        className={`list-item chat-item chat-fork${fork.state === "unread" ? " unread" : ""}`}
        aria-current={fork.isShown}
        onClick={onSelect}
        {...props}
      >
        <span className="chat-item-title">{fork.name}</span>
        <span className="chat-item-preview">{fork.preview}</span>
        <ChatStatePill state={fork.state} />
      </button>
      {parts}
    </li>
  );
}
