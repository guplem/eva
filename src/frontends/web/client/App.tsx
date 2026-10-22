/**
 * The web UI: the main navigation, the destinations, approvals, and the setup cards of
 * schedules. The address names the destination, so the back button and a reload work.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  api,
  ApiError,
  subscribeToEvents,
  type ChatBlocker,
  type DeviceLoginEvent,
  type DeviceLoginRequest,
  type EvaStatus,
  type EventSubscription,
  type PendingApproval,
  type ScheduleCard,
  type SessionEvent,
  type VaultSyncState,
  type ListedSession,
} from "./api.ts";
import { ApprovalNotice } from "./ApprovalCard.tsx";
import { cueOfEvent, playCue } from "./cues.ts";
import { approvalPlace, approvalsOutside, rootChatId } from "./approvals.ts";
import { AssistantView } from "./AssistantView.tsx";
import { ErrorToastProvider, useShowError } from "./error-toast.tsx";
import { FilesView } from "./FilesView.tsx";
import {
  applyEvent,
  emptyLiveState,
  forgetTaskEvents,
  startRecovery,
  withRunningTurns,
  withTasks,
  type LiveState,
} from "./live-state.ts";
import { AccountRefusedView, LoginView } from "./LoginView.tsx";
import { MainNav } from "./MainNav.tsx";
import { addressOf, destinationOf, linkedChatIdOf, type Destination } from "./navigation.ts";
import { NewDeviceDialog } from "./NewDeviceDialog.tsx";
import { NoteConflicts } from "./NoteConflicts.tsx";
import { browserPage, reloadIfStale } from "./page-freshness.ts";
import type { ProblemAction } from "./problem-actions.ts";
import { ProblemNotices } from "./ProblemNotices.tsx";
import { ProjectView } from "./ProjectView.tsx";
import { ScheduleCardDialog } from "./ScheduleCardDialog.tsx";
import { schedulesChangedEvent } from "./SchedulesPanel.tsx";
import { SchedulesView } from "./SchedulesView.tsx";
import { SettingsView } from "./SettingsView.tsx";
import { TooltipLayer } from "./Tooltip.tsx";
import { AppSkeleton } from "./Loading.tsx";
import { SpecialDayProvider } from "./FestiveDay.tsx";
import { useLocationSharing } from "./LocationCard.tsx";
import { settingsHash } from "./settings-routes.ts";

/** Problems come with the status, not over the socket, so the page asks for them, and for the cards, again this often. */
const problemPollMs = 60_000;
/** While a setup step stops every chat, read the status this often, so a login done elsewhere unlocks the chat. */
const blockedPollMs = 5_000;
/** How long the notice of an allowed device shows the delighted face. */
const allowedFaceMs = 1_500;

export function App(): ReactElement {
  return (
    <ErrorToastProvider>
      <SpecialDayProvider>
        <EvaApp />
      </SpecialDayProvider>
      <TooltipLayer />
    </ErrorToastProvider>
  );
}

function EvaApp(): ReactElement {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  // A device that chose to share its location sends it while the person is logged in.
  useLocationSharing(authenticated === true);
  /** Why this Tailscale account cannot open this Eva, or null (#322). */
  const [refusal, setRefusal] = useState<string | null>(null);
  /** The server sends "settled" before its answer, so the notice keeps this request until the answer comes. */
  const [answeringDevice, setAnsweringDevice] = useState<DeviceLoginRequest | null>(null);
  const answering = useRef(false);
  const [screen, setScreen] = useState<Destination>(() => destinationOf(window.location.hash) ?? "chats");
  const [sessions, setSessions] = useState<ListedSession[]>([]);
  const [live, setLive] = useState<LiveState>(emptyLiveState);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  /** The sessions of the chat on screen. Their requests show as cards, so they need no notice. */
  const [shownSessionIds, setShownSessionIds] = useState<readonly string[]>([]);
  const [deviceRequests, setDeviceRequests] = useState<DeviceLoginRequest[]>([]);
  /** The request that the person just allowed. Its notice stays a moment, with the delighted face. */
  const [allowedDevice, setAllowedDevice] = useState<DeviceLoginRequest | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [problems, setProblems] = useState<EvaStatus["problemDetails"]>([]);
  const [syncState, setSyncState] = useState<VaultSyncState | null>(null);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const events = useRef<EventSubscription | null>(null);
  const [setupMissing, setSetupMissing] = useState(0);
  const [chatBlocker, setChatBlocker] = useState<ChatBlocker | null>(null);
  const [voiceNotes, setVoiceNotes] = useState(false);
  const [cards, setCards] = useState<ScheduleCard[]>([]);
  const [linkedChatId, setLinkedChatId] = useState(() => linkedChatIdOf(window.location.hash));
  const showError = useShowError();
  const linkedChat = sessions.find((session) => session.id === linkedChatId) ?? null;

  // The back button and a typed address both come here.
  useEffect(() => {
    const onHashChange = (): void => {
      const destination = destinationOf(window.location.hash);
      if (destination !== null) setScreen(destination);
      setLinkedChatId(linkedChatIdOf(window.location.hash));
      setSidebarOpen(false);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // The linked chat's destination opens when the chat is first in the list. A project chat stays under Projects.
  const linkedMode = linkedChat?.mode ?? null;
  useEffect(() => {
    if (linkedMode !== null) setScreen(linkedMode === "assistant" ? "chats" : "projects");
  }, [linkedChatId, linkedMode]);

  // The callback below reads the screen without a new identity at each change: the views run it from an effect.
  const screenRef = useRef(screen);
  screenRef.current = screen;

  /**
   * A view opened the linked chat: the link is used up. A view mounts again at each screen
   * change, so a kept link would undo the person's own choice. The address becomes that of the
   * destination in place, so the back button skips the used link, and the same link can open again.
   */
  const onLinkedChatOpened = useCallback((): void => {
    setLinkedChatId(null);
    window.history.replaceState(null, "", addressOf(screenRef.current));
  }, []);

  /** A new address adds a history entry, so the back button goes to the previous destination. */
  const openDestination = (destination: Destination): void => {
    setSidebarOpen(false);
    if (window.location.hash === addressOf(destination)) setScreen(destination);
    else window.location.hash = addressOf(destination);
  };

  // A waiting card is also a problem, so both come back together.
  const refreshProblems = useCallback(async (): Promise<void> => {
    try {
      const status = await api.status();
      // An older Eva sends only the texts: show nothing rather than break the page.
      setProblems((status as Partial<EvaStatus>).problemDetails ?? []);
      setSyncState(status.vaultSync);
      setSetupMissing(status.setupMissing);
      // An older Eva sends no blocker: the chats work as before.
      setChatBlocker((status as Partial<EvaStatus>).chatBlocker ?? null);
      // An older Eva does not say: the microphone stays hidden.
      setVoiceNotes((status as Partial<EvaStatus>).voiceNotes ?? false);
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
      if (read !== latestRead.current) return;
      setSessions(listed);
      setAuthenticated(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setAuthenticated(false);
      if (error instanceof ApiError && error.code === "tailscale_account_refused") setRefusal(error.message);
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
        latestRead.current += 1;
        const read = latestRead.current;
        const fresh = await api.sessions();
        // A newer read already set the list. This read still says whether the chat exists.
        if (read === latestRead.current) setSessions(fresh);
        if (fresh.some((session) => session.id === linkedChatId)) return;
        showError(new Error("That chat no longer exists."));
      } catch (caught) {
        showError(caught);
      }
      onLinkedChatOpened();
    })();
  }, [linkIsMissing, linkedChatId, showError, onLinkedChatOpened]);

  // The conflict can end elsewhere, such as with a pick from Telegram: the dialog then has nothing to show.
  const syncStatus = syncState?.status;
  useEffect(() => {
    // Not on "offline": a failed pull leaves the conflict open, and the picks still work.
    if (syncStatus === "ok") setConflictsOpen(false);
  }, [syncStatus]);

  const hasDialogOnTop = deviceRequests.length > 0;
  useEffect(() => {
    if (!conflictsOpen) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      // A device request shows on top, and Escape must not close the dialog under it.
      if (event.key === "Escape" && !hasDialogOnTop) setConflictsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [conflictsOpen, hasDialogOnTop]);

  // Another page has its own content: the dialog must not stay over it.
  useEffect(() => {
    setConflictsOpen(false);
  }, [screen]);

  // Recoveries overlap, such as on a visibility change and a reconnect: only the newest one sets the steps.
  const lastRecovery = useRef(0);
  /**
   * A phone drops the socket when it sleeps, so events are lost: a turn ends, or an approval
   * waits, with no event here. Read the state again, with the steps and drafts of the running turns, so
   * the answer that the person already read stays (#118).
   * A note goes: a lost event can hide the turn start that clears it.
   * A reconnect also follows a restart, such as after an update: a page with old code reloads.
   */
  const recover = useCallback(async (): Promise<void> => {
    // Not awaited: a slow answer must not hold the recovery.
    void reloadIfStale(browserPage());
    lastRecovery.current += 1;
    const id = lastRecovery.current;
    setLive((state) => startRecovery({ ...forgetTaskEvents(state), notes: {} }, id));
    try {
      const snapshot = await api.runningTurns();
      setLive((state) => withRunningTurns(state, id, snapshot));
    } catch {
      // An older Eva has no such route. The page shows the steps that come from now on.
      setLive((state) => withRunningTurns(state, id, null));
    }
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

  const isBlocked = chatBlocker !== null;
  useEffect(() => {
    if (authenticated !== true) return undefined;
    void refreshProblems();
    const timer = setInterval(() => void refreshProblems(), isBlocked ? blockedPollMs : problemPollMs);
    return () => clearInterval(timer);
  }, [authenticated, refreshProblems, isBlocked]);

  // A step done in Settings unlocks the chats as soon as the person goes back to them.
  useEffect(() => {
    if (authenticated === true && isBlocked) void refreshProblems();
  }, [authenticated, isBlocked, refreshProblems, screen]);

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
    const subscription = subscribeToEvents((event: SessionEvent | ScheduleCard | DeviceLoginEvent) => {
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
      const cue = cueOfEvent(event);
      if (cue !== null) playCue(cue);
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
      } else if (event.kind === "session_seen") {
        // The person read the chat here or on another device: the list drops its unread mark.
        void refreshSessions();
      } else if (event.kind === "turn_finished" || event.kind === "turn_failed") {
        void refreshSessions();
      } else if (event.kind === "message_received") {
        // A turn starts. Its first step can come much later, and the list already says that the chat works.
        void refreshSessions();
      }
    }, onConnectionChange);
    events.current = subscription;
    return () => {
      subscription.close();
      events.current = null;
    };
  }, [authenticated, refreshSessions, recover]);

  useEffect(() => {
    if (allowedDevice === null) return undefined;
    const timer = setTimeout(() => setAllowedDevice(null), allowedFaceMs);
    return () => clearTimeout(timer);
  }, [allowedDevice]);

  if (refusal !== null) return <AccountRefusedView reason={refusal} />;
  if (authenticated === null)
    return (
      <AppSkeleton
        page={screen === "chats" ? "chat" : screen === "projects" ? "list" : screen === "files" ? "files" : "cards"}
      />
    );
  if (!authenticated) return <LoginView onLoggedIn={() => void refreshSessions()} />;

  const answerApproval = async (requestId: string, answer: "allow" | "deny"): Promise<void> => {
    try {
      await api.answerApproval(requestId, answer);
      setApprovals((current) => current.filter((approval) => approval.requestId !== requestId));
    } catch (caught) {
      showError(caught);
    }
  };
  const chatApprovals = { pending: approvals, onAnswer: answerApproval, onShowChat: setShownSessionIds };
  // The open chat shows its own requests as cards. A request of any other chat gets a line that opens it.
  const elsewhere = approvalsOutside(approvals, shownSessionIds).map((approval) => ({
    requestId: approval.requestId,
    place: approvalPlace(sessions.find((session) => session.id === approval.sessionId)),
    open: () => {
      window.location.hash = `#/chat/${encodeURIComponent(rootChatId(approval.sessionId, sessions))}`;
    },
  }));

  /** A failed answer drops the request too: it expired, or another approver answered it. */
  const answerDevice = async (request: DeviceLoginRequest, answer: "allow" | "deny"): Promise<void> => {
    // The disabled buttons show only after a render, so two quick taps could send two answers.
    if (answering.current) return;
    answering.current = true;
    setAnsweringDevice(request);
    try {
      await api.answerDeviceRequest(request.id, answer);
      // Only a confirmed answer shows "Allowed": a slow phone link can still fail.
      if (answer === "allow") setAllowedDevice(request);
    } catch (caught) {
      showError(caught);
    } finally {
      setDeviceRequests((current) => current.filter((entry) => entry.id !== request.id));
      answering.current = false;
      setAnsweringDevice(null);
    }
  };
  const deviceRequest = allowedDevice ?? answeringDevice ?? deviceRequests[0];

  const answerCard = async (card: ScheduleCard, answer: "confirm" | "remove"): Promise<void> => {
    try {
      // The card itself asks "Remove?" before it calls this.
      if (answer === "confirm") await api.confirmScheduleCard(card);
      else await api.removeSchedule(card.scheduleId);
      setCards((current) => current.filter((entry) => entry.scheduleId !== card.scheduleId));
      window.dispatchEvent(new Event(schedulesChangedEvent));
    } catch (caught) {
      showError(caught);
    }
    // A card that changed meanwhile comes back with its new fields; the problem banner follows.
    await refreshProblems();
  };
  const card = cards[0];
  // A key of `live.steps` means that a turn runs. A session that the list does not know yet counts as Assistant mode.
  const runningTurns = { assistant: 0, project: 0 };
  for (const sessionId of Object.keys(live.steps)) {
    const mode = sessions.find((session) => session.id === sessionId)?.mode;
    runningTurns[mode === "project" ? "project" : "assistant"] += 1;
  }

  const runProblemAction = (action: ProblemAction): void => {
    if (action === "pick_version") setConflictsOpen(true);
    else if (action === "choose_template_version")
      window.location.hash = settingsHash({ section: "vault", item: "template-alignment" });
    else openDestination(action === "open_schedules" ? "schedules" : "settings");
  };
  const notices = (
    <ProblemNotices
      isConnected={isConnected}
      problems={problems}
      syncStatus={syncState?.status ?? "ok"}
      openPage={screen === "settings" || screen === "schedules" ? screen : null}
      onRetryNow={() => events.current?.retryNow()}
      onAction={runProblemAction}
    />
  );
  /** A pick changes the sync state, and the problem list follows. The dialog closes with the conflict. */
  const onConflictState = (state: VaultSyncState): void => {
    setSyncState(state);
    void refreshProblems();
  };

  return (
    <div className="app">
      {/* A badge, not a banner, says what is left to set up: a short phone screen keeps its room for the chats. */}
      <MainNav
        current={screen}
        onOpen={openDestination}
        approvals={approvals.length}
        setupMissing={setupMissing}
        isConnected={isConnected}
        problems={problems.length}
        chatBlocked={chatBlocker !== null}
        assistantTurns={runningTurns.assistant}
        projectTurns={runningTurns.project}
      />
      <div className="app-body">
        {/* The chat views put the notices in their main area, beside the list. */}
        {(screen === "settings" || screen === "schedules" || screen === "files") && notices}
        <ApprovalNotice entries={elsewhere} />
        {screen === "chats" && (
          <AssistantView
            sessions={sessions}
            live={live}
            sidebarOpen={sidebarOpen}
            onShowList={() => setSidebarOpen(true)}
            onChanged={refreshSessions}
            onNavigate={() => setSidebarOpen(false)}
            linkedChat={linkedChat}
            onLinkedChatOpened={onLinkedChatOpened}
            notices={notices}
            approvals={chatApprovals}
            blocker={chatBlocker}
            voiceNotes={voiceNotes}
          />
        )}
        {screen === "projects" && (
          <ProjectView
            sessions={sessions}
            live={live}
            sidebarOpen={sidebarOpen}
            onShowList={() => setSidebarOpen(true)}
            linkedChat={linkedChat}
            onLinkedChatOpened={onLinkedChatOpened}
            onChanged={refreshSessions}
            onNavigate={() => setSidebarOpen(false)}
            notices={notices}
            approvals={chatApprovals}
            blocker={chatBlocker}
            voiceNotes={voiceNotes}
          />
        )}
        {screen === "settings" && (
          <SettingsView onLoggedOut={() => setAuthenticated(false)} onSetupChanged={() => void refreshProblems()} />
        )}
        {screen === "schedules" && <SchedulesView />}
        {screen === "files" && <FilesView />}
      </div>
      {/* Before the other dialogs: a device request that comes meanwhile shows on top. */}
      {conflictsOpen && syncState !== null && (
        <div className="dialog-backdrop">
          <div className="dialog wide" role="dialog" aria-modal="true" aria-label="Note conflicts">
            <NoteConflicts state={syncState} onState={onConflictState} />
            <div className="message-actions">
              <button onClick={() => setConflictsOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {deviceRequest !== undefined && (
        <NewDeviceDialog
          request={deviceRequest}
          allowed={deviceRequest === allowedDevice}
          busy={answeringDevice !== null}
          onAnswer={(answer) => void answerDevice(deviceRequest, answer)}
        />
      )}
      {deviceRequest === undefined && card !== undefined && (
        <ScheduleCardDialog
          card={card}
          onConfirm={() => void answerCard(card, "confirm")}
          onRemove={() => void answerCard(card, "remove")}
        />
      )}
    </div>
  );
}
