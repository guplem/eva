/** Assistant mode (mockups/assistant-mode.png): chats in the sidebar, the conversation, background tasks. */
import { useState, type ReactElement } from "react";
import { api, type SessionRecord } from "./api.ts";
import type { LiveState } from "./live-state.ts";
import { Conversation, rootChats } from "./Conversation.tsx";

interface AssistantViewProps {
  readonly sessions: readonly SessionRecord[];
  readonly live: LiveState;
  readonly sidebarOpen: boolean;
  readonly onChanged: () => Promise<void>;
  readonly onNavigate: () => void;
}

export function AssistantView({
  sessions,
  live,
  sidebarOpen,
  onChanged,
  onNavigate,
}: AssistantViewProps): ReactElement {
  const chats = rootChats(sessions.filter((session) => session.mode === "assistant"));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = chats.find((chat) => chat.id === selectedId) ?? chats[0];
  const tasks = Object.entries(live.tasks);

  const newChat = async (): Promise<void> => {
    const chat = await api.newAssistantChat("default");
    await onChanged();
    setSelectedId(chat.id);
    onNavigate();
  };

  return (
    <div className="layout">
      <nav className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="Chats">
        <button className="primary" onClick={() => void newChat()}>
          New chat
        </button>
        <h2>Schedules</h2>
        {chats.filter((chat) => chat.source === "schedule").length === 0 && (
          <span className="chip">No schedules yet.</span>
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
      </nav>
      <main className="main">
        {selected === undefined ? (
          <div className="empty">No chats yet. Start one with “New chat”.</div>
        ) : (
          <>
            <div className="main-header">
              <h1>{selected.title}</h1>
              <span className="badge">{selected.modelAlias}</span>
            </div>
            <Conversation root={selected} sessions={sessions} live={live} onChanged={onChanged} />
          </>
        )}
      </main>
      <aside className="tasks" aria-label="Background tasks">
        <h2 style={{ fontSize: 13, marginTop: 0 }}>Background tasks</h2>
        {tasks.length === 0 && <span className="chip">Nothing runs in the background.</span>}
        {tasks.map(([taskId, task]) => (
          <div key={taskId} className="task">
            {task.description}
            <div className="state">{task.state}</div>
          </div>
        ))}
      </aside>
    </div>
  );
}
