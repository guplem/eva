/** The web UI: a mode switch, the two views, settings, and approvals. */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  api,
  ApiError,
  subscribeToEvents,
  type PendingApproval,
  type SessionEvent,
  type SessionRecord,
} from "./api.ts";
import { AssistantView } from "./AssistantView.tsx";
import { ErrorToastProvider, useShowError } from "./error-toast.tsx";
import type { LiveState } from "./live-state.ts";
import { LoginView } from "./LoginView.tsx";
import { ProjectView } from "./ProjectView.tsx";
import { SettingsView } from "./SettingsView.tsx";

type Screen = "assistant" | "project" | "settings";

/** Problems come with the status, not over the socket, so the page asks for them again this often. */
const problemPollMs = 60_000;

export function App(): ReactElement {
  return (
    <ErrorToastProvider>
      <EvaApp />
    </ErrorToastProvider>
  );
}

function EvaApp(): ReactElement {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [screen, setScreen] = useState<Screen>("assistant");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [live, setLive] = useState<LiveState>({ streaming: {}, tasks: {} });
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const showError = useShowError();

  const refreshProblems = useCallback(async (): Promise<void> => {
    try {
      setProblems((await api.status()).problems);
    } catch {
      // The next poll or the next reconnect tries again.
    }
  }, []);

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

  /**
   * A phone drops the socket when it sleeps, so events are lost: a turn ends, or an approval
   * waits, with no event here. Read the state again, and drop the text of turns that ran meanwhile.
   */
  const recover = useCallback(async (): Promise<void> => {
    setLive((state) => ({ ...state, streaming: {} }));
    await refreshSessions();
    await refreshProblems();
    try {
      setApprovals(await api.pendingApprovals());
    } catch {
      // The next reconnect or the next visit tries again.
    }
  }, [refreshSessions, refreshProblems]);

  useEffect(() => {
    if (authenticated !== true) return undefined;
    void refreshProblems();
    const timer = setInterval(() => void refreshProblems(), problemPollMs);
    return () => clearInterval(timer);
  }, [authenticated, refreshProblems]);

  useEffect(() => {
    if (authenticated !== true) return undefined;
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void recover();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [authenticated, recover]);

  useEffect(() => {
    if (authenticated !== true) return undefined;
    const onConnectionChange = (connected: boolean): void => {
      setIsConnected(connected);
      if (connected) void recover();
    };
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
      } else if (event.kind === "approval_resolved") {
        setApprovals((current) => current.filter((approval) => approval.requestId !== event.requestId));
      } else if (event.kind === "history_lost") {
        setLive((state) => ({
          ...state,
          streaming: {
            ...state.streaming,
            [event.sessionId]: `${state.streaming[event.sessionId] ?? ""}*The earlier history of this chat is lost.*\n\n`,
          },
        }));
      } else if (event.kind === "approval_needed") {
        setApprovals((current) => [
          ...current.filter((approval) => approval.requestId !== event.requestId),
          { requestId: event.requestId, sessionId: event.sessionId, toolName: event.toolName, summary: event.summary },
        ]);
      } else if (event.kind === "turn_finished" || event.kind === "turn_failed") {
        setLive((state) => {
          const streaming = { ...state.streaming };
          Reflect.deleteProperty(streaming, event.sessionId);
          return { ...state, streaming };
        });
        void refreshSessions();
      }
    }, onConnectionChange);
  }, [authenticated, refreshSessions, recover]);

  if (authenticated === null) return <div className="empty">Loading…</div>;
  if (!authenticated) return <LoginView onLoggedIn={() => void refreshSessions()} />;

  const answerApproval = async (requestId: string, answer: "allow" | "deny"): Promise<void> => {
    try {
      await api.answerApproval(requestId, answer);
      setApprovals((current) => current.filter((approval) => approval.requestId !== requestId));
    } catch (caught) {
      showError(caught);
    }
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
      {problems.length > 0 && (
        <section className="problem-banner" aria-label="Problems">
          <strong>{problems.length === 1 ? "1 problem" : `${String(problems.length)} problems`}</strong>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </section>
      )}
      {!isConnected && (
        <div className="connection-banner" role="status">
          Reconnecting…
        </div>
      )}
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
