/** The web UI (docs/plan.md §8.3): a mode switch, the two views, settings, and approvals. */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, ApiError, subscribeToEvents, type SessionEvent, type SessionRecord } from "./api.ts";
import { AssistantView } from "./AssistantView.tsx";
import type { LiveState } from "./live-state.ts";
import { LoginView } from "./LoginView.tsx";
import { ProjectView } from "./ProjectView.tsx";
import { SettingsView } from "./SettingsView.tsx";

type Screen = "assistant" | "project" | "settings";

interface PendingApproval {
  readonly requestId: string;
  readonly toolName: string;
  readonly summary: string;
}

export function App(): ReactElement {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [screen, setScreen] = useState<Screen>("assistant");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [live, setLive] = useState<LiveState>({ streaming: {}, tasks: {} });
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const refreshSessions = useCallback(async (): Promise<void> => {
    try {
      setSessions(await api.sessions());
      setAuthenticated(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (authenticated !== true) return undefined;
    return subscribeToEvents((event: SessionEvent) => {
      if (event.kind === "text") {
        setLive((state) => ({
          ...state,
          streaming: {
            ...state.streaming,
            [event.sessionId]: `${state.streaming[event.sessionId] ?? ""}${event.text}\n\n`,
          },
        }));
      } else if (event.kind === "task_changed") {
        setLive((state) => ({
          ...state,
          tasks: {
            ...state.tasks,
            [event.taskId]: { description: event.description, state: event.state, sessionId: event.sessionId },
          },
        }));
      } else if (event.kind === "approval_needed") {
        setApprovals((current) => [
          ...current,
          { requestId: event.requestId, toolName: event.toolName, summary: event.summary },
        ]);
      } else if (event.kind === "turn_finished" || event.kind === "turn_failed") {
        setLive((state) => {
          const streaming = { ...state.streaming };
          Reflect.deleteProperty(streaming, event.sessionId);
          return { ...state, streaming };
        });
        void refreshSessions();
      }
    });
  }, [authenticated, refreshSessions]);

  if (authenticated === null) return <div className="empty">Loading…</div>;
  if (!authenticated) return <LoginView onLoggedIn={() => void refreshSessions()} />;

  const answerApproval = async (requestId: string, answer: "allow" | "deny"): Promise<void> => {
    await api.answerApproval(requestId, answer);
    setApprovals((current) => current.filter((approval) => approval.requestId !== requestId));
  };
  const approval = approvals[0];

  return (
    <div className="app">
      <header className="topbar">
        <button className="menu-button" aria-label="Show the list" onClick={() => setSidebarOpen((open) => !open)}>
          ☰
        </button>
        <div className="mode-switch" role="group" aria-label="Mode">
          <button aria-pressed={screen === "assistant"} onClick={() => setScreen("assistant")}>
            Assistant
          </button>
          <button aria-pressed={screen === "project"} onClick={() => setScreen("project")}>
            Project
          </button>
        </div>
        <span className="spacer" />
        <button aria-pressed={screen === "settings"} onClick={() => setScreen("settings")}>
          Settings
        </button>
      </header>
      {screen === "assistant" && (
        <AssistantView
          sessions={sessions}
          live={live}
          sidebarOpen={sidebarOpen}
          onChanged={refreshSessions}
          onNavigate={() => setSidebarOpen(false)}
        />
      )}
      {screen === "project" && (
        <ProjectView
          sessions={sessions}
          live={live}
          sidebarOpen={sidebarOpen}
          onChanged={refreshSessions}
          onNavigate={() => setSidebarOpen(false)}
        />
      )}
      {screen === "settings" && <SettingsView onLoggedOut={() => setAuthenticated(false)} />}
      {approval !== undefined && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-label="Approval">
            <strong>Eva wants to run {approval.toolName}</strong>
            <code>{approval.summary}</code>
            <div className="message-actions">
              <button className="primary" onClick={() => void answerApproval(approval.requestId, "allow")}>
                Allow
              </button>
              <button onClick={() => void answerApproval(approval.requestId, "deny")}>Deny</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
