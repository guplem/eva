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

/** What the supervisor knows of Eva, apart from her own answers. */
export type TrayPhase =
  | { readonly kind: "starting" }
  | { readonly kind: "running" }
  | { readonly kind: "waiting"; readonly afterMs: number }
  | { readonly kind: "stopped"; readonly settingsNeedYou: boolean };

/** What a running Eva answers: her status, and how many approvals wait. */
export interface TrayReading {
  /** An older Eva sends no `problemDetails`: then every problem counts as unread. */
  readonly status: Pick<EvaStatus, "problems" | "busySessionIds" | "chatBlocker"> &
    Partial<Pick<EvaStatus, "problemDetails">>;
  readonly approvals: number;
}

export interface TrayInput {
  readonly instance: string;
  readonly phase: TrayPhase;
  /** Eva's last answer, or null when she did not answer. */
  readonly reading: TrayReading | null;
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
  if (input.reading === null)
    return phase.kind === "starting"
      ? view(stateFaces.waiting, "Eva starts", false)
      : view(stateFaces.offline, "Eva does not answer", false);
  const { status, approvals } = input.reading;
  const state = navVisorState({
    isConnected: true,
    approvals,
    problems: status.problems.length,
    unreadProblems: status.problemDetails?.filter((problem) => !problem.hidden).length ?? status.problems.length,
    assistantTurns: status.busySessionIds.length,
    // The status does not split the turns by mode, so every turn shows as thinking.
    projectTurns: 0,
    chatBlocked: status.chatBlocker !== null,
  });
  return view(state.face, state.words, true);
}

/**
 * The command that runs the tray script. `-EncodedCommand` carries the script itself, so no
 * file and no execution policy matter. `-Sta` is the thread model that WinForms needs.
 * `-InputFormat None`: the script gets its views from a file, so PowerShell waits for no input.
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
    "-InputFormat",
    "None",
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
  /** Where the newest view waits for the script. */
  readonly viewFile: string;
  readonly instance: string;
  /** Eva's answer, or null when she does not answer. */
  readonly read: () => Promise<TrayReading | null>;
  readonly onChoice: (choice: TrayChoice) => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (message: string) => void;
}

export interface Tray {
  /** Tells the icon what the supervisor knows. */
  setPhase(phase: TrayPhase): void;
  /** False after the script ended, by itself or by a close. */
  alive(): boolean;
  /** Settles when the script ends. */
  readonly ended: Promise<void>;
  /** Removes the icon, and stops reading Eva's answers. */
  close(): Promise<void>;
}

/** How often the icon reads Eva's status while she runs. */
export const trayPollMs = 5_000;
/** After this many reads with no answer, about a minute, the icon shows a start as a hang. */
export const startPolls = 12;
const trayCloseTimeoutMs = 5_000;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Shows the icon. Returns null when the icon cannot start: Eva keeps running without it. */
export function startTray(options: TrayOptions): Tray | null {
  let child: LineProcess;
  try {
    child = options.start(options.command, {
      cwd: options.cwd,
      environment: options.environment,
      lineFile: options.viewFile,
    });
  } catch (error) {
    options.log(`The tray icon did not start: ${reasonOf(error)}`);
    return null;
  }
  const state: {
    phase: TrayPhase;
    // Each setPhase adds one, so a read that started before it never overwrites it.
    phaseCount: number;
    reading: TrayReading | null;
    shown: string;
    closed: boolean;
    ended: boolean;
  } = { phase: { kind: "starting" }, phaseCount: 0, reading: null, shown: "", closed: false, ended: false };
  const show = (): void => {
    if (state.closed) return;
    const line = JSON.stringify(trayView({ instance: options.instance, phase: state.phase, reading: state.reading }));
    // The same line again would only redraw the icon.
    if (line === state.shown) return;
    // A failed write keeps the old line as shown, so the next poll writes the view again.
    if (child.publish(line)) state.shown = line;
  };
  show();

  const ended = (async () => {
    try {
      for await (const line of child.lines) {
        if (line !== "open" && line !== "restart" && line !== "quit") continue;
        // One failed choice must not end the icon.
        try {
          options.onChoice(line);
        } catch (error) {
          options.log(`The tray menu choice ${line} failed: ${reasonOf(error)}`);
        }
      }
    } catch (error) {
      options.log(`The tray icon failed: ${reasonOf(error)}`);
    }
    state.ended = true;
    if (state.closed) return;
    // A script whose output ended may still show a frozen icon: it must go.
    await child.close(trayCloseTimeoutMs);
    await child.exited;
    const reason = child.stderrTail().trim();
    options.log(`The tray icon stopped${reason === "" ? "." : `: ${reason}`}`);
  })();

  // A function, so the loop reads an end that happens while it awaits.
  const isOver = (): boolean => state.closed || state.ended;
  void (async () => {
    // The reads with no answer since the last start.
    let unanswered = 0;
    while (!isOver()) {
      if (state.phase.kind === "starting" || state.phase.kind === "running") {
        const count = state.phaseCount;
        const reading = await options.read().catch((error: unknown) => {
          options.log(`The tray icon could not read Eva's status: ${reasonOf(error)}`);
          return null;
        });
        if (isOver()) return;
        if (count === state.phaseCount) {
          unanswered = reading === null ? unanswered + 1 : 0;
          state.reading = reading;
          // The first answer shows that Eva runs; a lost answer later shows that she hangs. A start
          // with no answer for a long time is a hang too.
          if (reading !== null || unanswered >= startPolls) state.phase = { kind: "running" };
          show();
        } else unanswered = 0;
      }
      await options.sleep(trayPollMs);
    }
  })();

  return {
    setPhase: (phase) => {
      state.phase = phase;
      state.phaseCount += 1;
      // A new start must not show the answer of the Eva before it.
      if (phase.kind !== "running") state.reading = null;
      show();
    },
    alive: () => !isOver(),
    ended,
    close: async () => {
      state.closed = true;
      await child.close(trayCloseTimeoutMs);
    },
  };
}
