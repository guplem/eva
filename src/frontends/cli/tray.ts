/**
 * Eva's icon in the Windows system tray (#457). The start at logon runs Eva with no window, so
 * this icon shows that she runs, with her face for her state, and a menu to open, restart or
 * quit her. A PowerShell script draws the icon and its menu. It is only a view: this file
 * decides what it shows, and what each menu choice does.
 */
import type { EvaStatus } from "../../core/eva.ts";
import type { LineProcess, LineProcessStarter } from "../../shared/line-process.ts";
import { navVisorState } from "../web/client/nav-visor.ts";
import { stateFaces, type Face } from "../web/client/visor-faces.ts";
import trayScript from "./tray.ps1" with { type: "text" };

/** What the supervisor knows of Eva, apart from her own status. */
export type TrayPhase =
  | { readonly kind: "starting" }
  | { readonly kind: "running" }
  | { readonly kind: "waiting"; readonly afterMs: number }
  | { readonly kind: "stopped"; readonly settingsNeedYou: boolean };

export interface TrayInput {
  readonly instance: string;
  readonly phase: TrayPhase;
  /** Eva's last status, or null when she did not answer. */
  readonly status: EvaStatus | null;
}

/** One state of the icon: the script draws `face`, and shows `tooltip` and `title`. */
export interface TrayView {
  readonly face: Face;
  readonly tooltip: string;
  /** The first line of the menu, which names this Eva among the others on the computer. */
  readonly title: string;
  /** False while Eva cannot open her page, so the Open item is grey. */
  readonly canOpen: boolean;
}

/** The faces that tray.ps1 can draw. */
export const trayFaces: readonly Face[] = [
  "neutral",
  "thinking",
  "listening",
  "focused",
  "firm",
  "worried",
  "sad",
  "error",
  "asleep",
];

/** Windows refuses a tooltip longer than this. */
const tooltipLimit = 63;

export function trayView(input: TrayInput): TrayView {
  const title = `Eva (${input.instance})`;
  const view = (face: Face, words: string, canOpen: boolean): TrayView => {
    const tooltip = `${title}\n${words}`;
    return {
      face,
      tooltip: tooltip.length > tooltipLimit ? `${tooltip.slice(0, tooltipLimit - 1)}…` : tooltip,
      title,
      canOpen,
    };
  };
  const phase = input.phase;
  if (phase.kind === "stopped")
    return phase.settingsNeedYou
      ? view(stateFaces.broken, "Stopped: her settings need you", false)
      : view(stateFaces.resting, "Stopped. Restart Eva starts her.", false);
  if (phase.kind === "waiting")
    return view(
      stateFaces.failed,
      `Stopped on an error. Starts in ${String(Math.ceil(phase.afterMs / 1000))} s.`,
      false,
    );
  if (input.status === null)
    return phase.kind === "starting"
      ? view(stateFaces.waiting, "Eva starts", false)
      : view(stateFaces.offline, "Eva does not answer", false);
  const state = navVisorState({
    isConnected: true,
    // The status has no count of approvals: the page and the phone show those.
    approvals: 0,
    problems: input.status.problems.length,
    assistantTurns: input.status.busySessionIds.length,
    projectTurns: 0,
    chatBlocked: input.status.chatBlocker !== null,
  });
  return view(state.face, state.words, true);
}

/**
 * The command that runs the tray script. `-EncodedCommand` carries the script itself, so no
 * file and no execution policy matter. `-Sta` is the thread model that WinForms needs.
 */
export function trayCommand(systemRoot: string): string[] {
  const encoded = Buffer.from(trayScript, "utf16le").toString("base64");
  return [
    `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    "-NoProfile",
    "-NonInteractive",
    "-Sta",
    "-WindowStyle",
    "Hidden",
    "-EncodedCommand",
    encoded,
  ];
}

export type TrayChoice = "open" | "restart" | "quit";

export interface TrayOptions {
  readonly start: LineProcessStarter;
  readonly command: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly instance: string;
  /** Eva's status, or null when she does not answer. It never throws. */
  readonly readStatus: () => Promise<EvaStatus | null>;
  readonly onChoice: (choice: TrayChoice) => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (message: string) => void;
}

export interface Tray {
  /** Tells the icon what the supervisor knows. */
  setPhase(phase: TrayPhase): void;
  /** Removes the icon, and stops reading Eva's status. */
  close(): Promise<void>;
}

/** How often the icon reads Eva's status while she runs. */
export const trayPollMs = 5_000;
const trayCloseTimeoutMs = 5_000;

/** Shows the icon. Returns null when the icon cannot start: Eva runs on without it. */
export function startTray(options: TrayOptions): Tray | null {
  let child: LineProcess;
  try {
    child = options.start(options.command, { cwd: options.cwd, environment: options.environment });
  } catch (error) {
    options.log(`The tray icon did not start: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const state: { phase: TrayPhase; status: EvaStatus | null; shown: string; closed: boolean } = {
    phase: { kind: "starting" },
    status: null,
    shown: "",
    closed: false,
  };
  const show = (): void => {
    if (state.closed) return;
    const line = JSON.stringify(trayView({ instance: options.instance, phase: state.phase, status: state.status }));
    // The same line again would only redraw the icon.
    if (line === state.shown) return;
    state.shown = line;
    child.send(line);
  };
  show();

  void (async () => {
    for await (const line of child.lines) {
      if (line === "open" || line === "restart" || line === "quit") options.onChoice(line);
    }
    if (!state.closed) {
      const reason = child.stderrTail().trim();
      options.log(`The tray icon stopped${reason === "" ? "." : `: ${reason}`}`);
    }
  })();

  // A function, so the loop reads a close that happens while it awaits.
  const isClosed = (): boolean => state.closed;
  void (async () => {
    while (!isClosed()) {
      if (state.phase.kind === "starting" || state.phase.kind === "running") {
        const status = await options.readStatus();
        if (isClosed()) return;
        state.status = status;
        // The first answer shows that Eva runs; a lost answer later shows that she hangs.
        if (status !== null) state.phase = { kind: "running" };
        show();
      }
      await options.sleep(trayPollMs);
    }
  })();

  return {
    setPhase: (phase) => {
      state.phase = phase;
      // A new start must not show the status of the Eva before it.
      if (phase.kind !== "running") state.status = null;
      show();
    },
    close: async () => {
      state.closed = true;
      await child.close(trayCloseTimeoutMs);
    },
  };
}
