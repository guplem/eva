/** The web UI: a mode switch, the two views, settings, schedules, approvals, and the setup cards of schedules. */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Icon } from "./icons.tsx";
import {
  api,
  ApiError,
  subscribeToEvents,
  type DeviceLoginEvent,
  type DeviceLoginRequest,
  type PendingApproval,
  type ScheduleCard,
  type SessionEvent,
  type ListedSession,
} from "./api.ts";
import { AssistantView } from "./AssistantView.tsx";
import { ErrorToastProvider, useShowError } from "./error-toast.tsx";
import { applyEvent, emptyLiveState, forgetTaskEvents, withTasks, type LiveState } from "./live-state.ts";
import { LoginView } from "./LoginView.tsx";
import { ProjectView } from "./ProjectView.tsx";
import { ScheduleCardDialog } from "./ScheduleCardDialog.tsx";
import { SchedulesView } from "./SchedulesView.tsx";
import { SettingsView } from "./SettingsView.tsx";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";

type Screen = "assistant" | "project" | "settings" | "schedules";

/** Problems come with the status, not over the socket, so the page asks for them, and for the cards, again this often. */
const problemPollMs = 60_000;

/** The chat that the address names, as `#/chat/<id>`: Telegram links to a chat this way. */
function linkedChatIdOf(hash: string): string | null {
  const match = /^#\/chat\/([^/]+)$/.exec(hash);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

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
  const [sessions, setSessions] = useState<ListedSession[]>([]);
  const [live, setLive] = useState<LiveState>(emptyLiveState);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [deviceRequests, setDeviceRequests] = useState<DeviceLoginRequest[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [setupMissing, setSetupMissing] = useState(0);
  const [cards, setCards] = useState<ScheduleCard[]>([]);
  const [linkedChatId, setLinkedChatId] = useState(() => linkedChatIdOf(window.location.hash));
  const showError = useShowError();
  const linkedChat = sessions.find((session) => session.id === linkedChatId) ?? null;

  useEffect(() => {
    const onHashChange = (): void => setLinkedChatId(linkedChatIdOf(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // The linked chat's mode opens when the chat is first in the list.
  const linkedMode = linkedChat?.mode ?? null;
  useEffect(() => {
    if (linkedMode !== null) setScreen(linkedMode);
  }, [linkedChatId, linkedMode]);

  /**
   * A view opened the linked chat: the link is used up. A view mounts again at each screen
   * change, so a kept link would undo the person's own choice. A clear address also lets the
   * same link open again.
   */
  const onLinkedChatOpened = useCallback((): void => {
    setLinkedChatId(null);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  // A waiting card is also a problem, so both come back together.
  const refreshProblems = useCallback(async (): Promise<void> => {
    try {
      const status = await api.status();
      setProblems(status.problems);
      setSetupMissing(status.setupMissing);
    } catch {
      // The next poll or the next reconnect tries again.
    }
    try {
      setCards(await api.scheduleCards());
    } catch {
      // The next poll or the next reconnect tries again.
    }
  }, []);

  // Reads overlap: one starts at a turn start and one at its end. Only the newest read may set the list,
  // or an older answer brings back a running state that already ended.
  const latestRead = useRef(0);
  const refreshSessions = useCallback(async (): Promise<void> => {
    latestRead.current += 1;
    const read = latestRead.current;
    try {
      const listed = await api.sessions();
      if (read === latestRead.current) setSessions(listed);
      setAuthenticated(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // Telegram can link to a chat that is newer than this page's list: read the list once more.
  // A chat that is not in it either was deleted, and the link says so.
  const linkIsMissing = authenticated === true && linkedChatId !== null && linkedChat === null;
  useEffect(() => {
    if (!linkIsMissing) return;
    void (async (): Promise<void> => {
      try {
        const fresh = await api.sessions();
        setSessions(fresh);
        if (fresh.some((session) => session.id === linkedChatId)) return;
        showError(new Error("That chat no longer exists."));
      } catch (caught) {
        showError(caught);
      }
      onLinkedChatOpened();
    })();
  }, [linkIsMissing, linkedChatId, showError, onLinkedChatOpened]);

  /**
   * A phone drops the socket when it sleeps, so events are lost: a turn ends, or an approval
   * waits, with no event here. Read the state again, and drop the steps of turns that ran meanwhile.
   * A note goes too: a lost event can hide the turn start that clears it.
   */
  const recover = useCallback(async (): Promise<void> => {
    setLive((state) => ({ ...forgetTaskEvents(state), steps: {}, notes: {} }));
    await refreshSessions();
    await refreshProblems();
    try {
      setApprovals(await api.pendingApprovals());
    } catch {
      // The next reconnect or the next visit tries again.
    }
    try {
      setDeviceRequests(await api.deviceRequests());
    } catch {
      // The next reconnect or the next visit tries again.
    }
    try {
      const snapshot = await api.backgroundTasks();
      setLive((state) => withTasks(state, snapshot));
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
      // The server closes the socket of a removed device. A WebSocket never sees the 401 that follows,
      // so ask over HTTP: a 401 there shows the login page and ends the retries.
      else void refreshSessions();
    };
    return subscribeToEvents((event: SessionEvent | ScheduleCard | DeviceLoginEvent) => {
      if (event.kind === "device_login_request") {
        setDeviceRequests((current) => [...current.filter((entry) => entry.id !== event.request.id), event.request]);
        return;
      }
      if (event.kind === "device_login_settled") {
        setDeviceRequests((current) => current.filter((entry) => entry.id !== event.id));
        return;
      }
      if (event.kind === "schedule_card") {
        // The core sends a waiting card again at each check. It replaces the old one in place, so
        // the dialog never jumps to another card while the person reads.
        setCards((current) =>
          current.some((card) => card.scheduleId === event.scheduleId)
            ? current.map((card) => (card.scheduleId === event.scheduleId ? event : card))
            : [...current, event],
        );
        return;
      }
      setLive((state) => applyEvent(state, event));
      if (event.kind === "approval_resolved") {
        setApprovals((current) => current.filter((approval) => approval.requestId !== event.requestId));
      } else if (event.kind === "approval_needed") {
        setApprovals((current) => [
          ...current.filter((approval) => approval.requestId !== event.requestId),
          { requestId: event.requestId, sessionId: event.sessionId, toolName: event.toolName, summary: event.summary },
        ]);
      } else if (event.kind === "session_deleted") {
        // Another front end deleted a chat: the list drops it.
        void refreshSessions();
      } else if (event.kind === "session_renamed") {
        // A rename can come from Telegram or the terminal.
        void refreshSessions();
      } else if (event.kind === "turn_finished" || event.kind === "turn_failed") {
        void refreshSessions();
      } else if (event.kind === "message_received") {
        // A turn starts. Its first step can come much later, and the list already says that the chat works.
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

  /** A failed answer drops the request too: it expired, or another approver answered it. */
  const answerDevice = async (id: string, answer: "allow" | "deny"): Promise<void> => {
    setDeviceRequests((current) => current.filter((entry) => entry.id !== id));
    try {
      await api.answerDeviceRequest(id, answer);
    } catch (caught) {
      showError(caught);
    }
  };
  const deviceRequest = deviceRequests[0];
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
        <Visor size={28} face={isConnected ? stateFaces.idle : stateFaces.offline} />
        {/* Hidden, not removed, so the mode switch does not move on a phone. */}
        <button
          className="menu-button"
          aria-label="Show the list"
          style={hasSidebar ? undefined : { visibility: "hidden" }}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <Icon name="menu" />
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
          {/* A badge, not a banner: a short phone screen keeps its room for the chats. */}
          {setupMissing > 0 && <span className="chip">{setupMissing} to set up</span>}
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
          linkedChat={linkedChat}
          onLinkedChatOpened={onLinkedChatOpened}
          onOpenSchedules={() => setScreen("schedules")}
          approvalSessionIds={approvals.map((approval) => approval.sessionId)}
        />
      )}
      {screen === "project" && (
        <ProjectView
          sessions={sessions}
          live={live}
          sidebarOpen={sidebarOpen}
          linkedChat={linkedChat}
          onLinkedChatOpened={onLinkedChatOpened}
          onChanged={refreshSessions}
          onNavigate={() => setSidebarOpen(false)}
        />
      )}
      {screen === "settings" && (
        <SettingsView onLoggedOut={() => setAuthenticated(false)} onSetupChanged={() => void refreshProblems()} />
      )}
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
      {/* An approval holds a running turn, so it comes first. A device request comes next. */}
      {approval === undefined && deviceRequest !== undefined && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-label="New device">
            <strong>A new device wants to get in. Allow it?</strong>
            <span>
              Allow it only if the new device shows the code <code>{deviceRequest.code}</code>. Account:{" "}
              {deviceRequest.account}.
            </span>
            <div className="message-actions">
              <button className="primary" onClick={() => void answerDevice(deviceRequest.id, "allow")}>
                Allow
              </button>
              <button onClick={() => void answerDevice(deviceRequest.id, "deny")}>Deny</button>
            </div>
          </div>
        </div>
      )}
      {approval === undefined && deviceRequest === undefined && card !== undefined && (
        <ScheduleCardDialog
          card={card}
          onConfirm={() => void answerCard(card, "confirm")}
          onRemove={() => void answerCard(card, "remove")}
        />
      )}
    </div>
  );
}
