/** The web UI: a mode switch, the two views, settings, schedules, approvals, and the setup cards of schedules. */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  api,
  ApiError,
  subscribeToEvents,
  type PendingApproval,
  type ScheduleCard,
  type SessionEvent,
  type SessionRecord,
} from "./api.ts";
import { AssistantView } from "./AssistantView.tsx";
import { ErrorToastProvider, useShowError } from "./error-toast.tsx";
import type { LiveState } from "./live-state.ts";
import { LoginView } from "./LoginView.tsx";
import { ProjectView } from "./ProjectView.tsx";
import { ScheduleCardDialog } from "./ScheduleCardDialog.tsx";
import { SchedulesView } from "./SchedulesView.tsx";
import { SettingsView } from "./SettingsView.tsx";

type Screen = "assistant" | "project" | "settings" | "schedules";

/** Problems come with the status, not over the socket, so the page asks for them, and for the cards, again this often. */
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
  const [cards, setCards] = useState<ScheduleCard[]>([]);
  const showError = useShowError();

  // A waiting card is also a problem, so both come back together.
  const refreshProblems = useCallback(async (): Promise<void> => {
    try {
      setProblems((await api.status()).problems);
    } catch {
      // The next poll or the next reconnect tries again.
    }
    try {
      setCards(await api.scheduleCards());
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
    return subscribeToEvents((event: SessionEvent | ScheduleCard) => {
      if (event.kind === "schedule_card") {
        // The core sends a waiting card again at each check. It replaces the old one in place, so
        // the dialog never jumps to another card while the person reads.
        setCards((current) =>
          current.some((card) => card.scheduleId === event.scheduleId)
            ? current.map((card) => (card.scheduleId === event.scheduleId ? event : card))
            : [...current, event],
        );
      } else if (event.kind === "text") {
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
      } else if (event.kind === "session_renamed") {
        // A rename can come from Telegram or the terminal.
        void refreshSessions();
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
  const hasSidebar = screen === "assistant" || screen === "project";

  const answerCard = async (card: ScheduleCard, answer: "confirm" | "remove"): Promise<void> => {
    try {
      if (answer === "confirm") await api.confirmScheduleCard(card);
      else if (window.confirm(`Remove the schedule ${card.name}?`)) await api.removeSchedule(card.scheduleId);
      else return;
      setCards((current) => current.filter((entry) => entry.scheduleId !== card.scheduleId));
    } catch (caught) {
      showError(caught);
    }
    // A card that changed meanwhile comes back with its new fields; the problem banner follows.
    await refreshProblems();
  };
  const card = cards[0];

  return (
    <div className="app">
      <header className="topbar">
        {/* Hidden, not removed, so the mode switch does not move on a phone. */}
        <button
          className="menu-button"
          aria-label="Show the list"
          style={hasSidebar ? undefined : { visibility: "hidden" }}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          ☰
        </button>
        <div className="mode-switch" role="group" aria-label="Mode">
          {/* The Schedules page opens from the Assistant sidebar, so Assistant is the way back. */}
          <button
            aria-pressed={screen === "assistant" || screen === "schedules"}
            onClick={() => setScreen("assistant")}
          >
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
          onOpenSchedules={() => setScreen("schedules")}
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
      {screen === "schedules" && <SchedulesView />}
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
      {/* An approval holds a running turn, so it comes first. */}
      {approval === undefined && card !== undefined && (
        <ScheduleCardDialog
          card={card}
          onConfirm={() => void answerCard(card, "confirm")}
          onRemove={() => void answerCard(card, "remove")}
        />
      )}
    </div>
  );
}
