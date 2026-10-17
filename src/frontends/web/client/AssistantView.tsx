/** Assistant mode (mockups/assistant-mode.png): chats in the sidebar, the conversation, background tasks. */
import { useState, type ReactElement } from "react";
import type { ModelAlias } from "../../../shared/engine-port.ts";
import { api, type SessionRecord } from "./api.ts";
import type { LiveState } from "./live-state.ts";
import { Conversation, rootChats } from "./Conversation.tsx";
import { useShowError } from "./error-toast.tsx";

const models: readonly ModelAlias[] = ["default", "opus", "sonnet", "haiku"];

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
  // The model comes first in a new chat, and the chat keeps it (lesson 41).
  const [model, setModel] = useState<ModelAlias>("default");
  const selected = chats.find((chat) => chat.id === selectedId) ?? chats[0];
  const tasks = Object.entries(live.tasks);
  const showError = useShowError();

  const newChat = async (): Promise<void> => {
    try {
      const chat = await api.newAssistantChat(model);
      await onChanged();
      setSelectedId(chat.id);
      onNavigate();
    } catch (caught) {
      showError(caught);
    }
  };

  return (
    <div className="layout">
      <nav className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="Chats">
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
        <h2>Schedules</h2>
        {chats.filter((chat) => chat.source === "schedule").length === 0 && (
          <span className="chip">No schedule has run yet. Add one in Settings.</span>
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
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Close the list" onClick={onNavigate} />}
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
