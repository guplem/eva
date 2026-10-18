/** Assistant mode: chats in the sidebar, the conversation, background tasks. */
import { useRef, useState, type ReactElement } from "react";
import type { ModelAlias } from "../../../shared/engine-port.ts";
import { api, type SessionRecord } from "./api.ts";
import type { LiveState } from "./live-state.ts";
import { chatTree, Conversation, rootChats } from "./Conversation.tsx";
import { useShowError } from "./error-toast.tsx";
import { ChatInfoButton, ChatPanel, tasksOf } from "./ChatPanel.tsx";

const models: readonly ModelAlias[] = ["default", "opus", "sonnet", "haiku"];

interface AssistantViewProps {
  readonly sessions: readonly SessionRecord[];
  readonly live: LiveState;
  readonly sidebarOpen: boolean;
  readonly onChanged: () => Promise<void>;
  readonly onNavigate: () => void;
  readonly onOpenSchedules: () => void;
}

export function AssistantView({
  sessions,
  live,
  sidebarOpen,
  onChanged,
  onNavigate,
  onOpenSchedules,
}: AssistantViewProps): ReactElement {
  const chats = rootChats(sessions.filter((session) => session.mode === "assistant"));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The model comes first in a new chat, and the chat keeps it (lesson 41).
  const [model, setModel] = useState<ModelAlias>("default");
  const selected = chats.find((chat) => chat.id === selectedId) ?? chats[0];
  const showError = useShowError();
  const branches = selected === undefined ? [] : chatTree(selected, sessions);
  const chat = {
    branches,
    tasks: tasksOf(
      live.tasks,
      branches.map((branch) => branch.id),
    ),
  };
  const listRef = useRef<HTMLDivElement>(null);

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
              ⏰
            </button>
          </div>
          {chats.filter((chat) => chat.source === "schedule").length === 0 && (
            <span className="chip">No schedule has run yet. Add one on the Schedules page (⏰).</span>
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
              {chat.source === "schedule" ? "⏰ " : ""}
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
              <h1>{selected.title}</h1>
              <span className="badge">{selected.modelAlias}</span>
              <ChatInfoButton {...chat} />
            </div>
            <Conversation root={selected} sessions={sessions} live={live} onChanged={onChanged} />
          </>
        )}
      </main>
      <ChatPanel {...chat} />
    </div>
  );
}
