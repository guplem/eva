/**
 * `eva service install`: starts Eva by herself, as a systemd user service on Linux (lesson 85)
 * or a start at logon on Windows. The start at logon runs Eva's own supervisor, which restarts her
 * after a crash as systemd does. Exit codes 2 (bad config) and 3 (second instance) never
 * restart (lesson 89). This file also holds `eva supervise`, and how Eva starts again after an update.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runningInstancePid } from "../../core/instance/instance-lock.ts";
import { hardExitGraceMs, shutdownDeadlineMs } from "../../core/instance/shutdown.ts";
import {
  superviseEva,
  supervisedVariable,
  type Supervisor,
  type SupervisorPhase,
} from "../../core/instance/supervisor.ts";
import { createHomeFolders, instanceNameOf, type HomePaths } from "../../core/settings/home.ts";
import { baseEnvironmentAllowlist, buildChildEnvironment } from "../../shared/environment.ts";
import { exitCodes } from "../../shared/exit-codes.ts";
import type { LineProcessStarter } from "../../shared/line-process.ts";
import { FileLogger } from "../../shared/logger.ts";
import type { LongProcessStarter } from "../../shared/long-process.ts";
import type { ProcessResult } from "../../shared/process-runner.ts";
import { Redactor } from "../../shared/redaction.ts";
import { requestApprovalCount, requestRestart, requestStatus } from "./client.ts";
import { openLoggedIn } from "./devices.ts";
import { childEnvironment, evaCommand, writeLine, type CliHost } from "./host.ts";
import { runningClient } from "./local-commands.ts";
import { startTray, trayCommand, type Tray, type TrayChoice, type TrayReading } from "./tray.ts";

const serviceStepTimeoutMs = 30_000;

export interface ServiceTarget {
  /** The command that runs Eva, from `evaCommand`: [bun, src/main.ts] or [eva]. */
  readonly executable: readonly string[];
  /** The name of the Eva that the service runs. */
  readonly instance: string;
}

/** The service's name, `eva-<name>`, so each Eva on the same machine has her own service. */
export function serviceName(paths: HomePaths): string {
  return `eva-${instanceNameOf(paths)}`;
}

/**
 * The PATH for the service file, without the folders that `bun run` adds for one run only
 * (a temporary `bun-node-*` folder and `node_modules/.bin`), which a service must never depend on.
 */
export function servicePath(path: string, separator = ":"): string {
  return path
    .split(separator)
    .filter((folder) => folder !== "" && !/bun-node-|node_modules/.test(folder))
    .filter((folder, index, folders) => folders.indexOf(folder) === index)
    .join(separator);
}

/**
 * How Eva starts again after an update. systemd and Eva's own supervisor restart her on exit
 * code 4; anywhere else, such as a terminal, she starts a new copy of herself first.
 */
export function restartMethod(
  environment: Readonly<Record<string, string | undefined>>,
  isProcessAlive: (pid: number) => boolean,
  parentPid: number,
): "supervisor" | "new-copy" {
  // systemd sets INVOCATION_ID for each run of a unit.
  if (environment["INVOCATION_ID"] !== undefined) return "supervisor";
  const supervisor = Number(environment[supervisedVariable]);
  // Another process can get a dead supervisor's pid. On Linux, an orphan also gets a new parent.
  return Number.isSafeInteger(supervisor) && supervisor > 0 && supervisor === parentPid && isProcessAlive(supervisor)
    ? "supervisor"
    : "new-copy";
}

/** `configFolder`: the XDG_CONFIG_HOME of the install, so the service finds the same Evas as the terminal. */
export function systemdUnit(
  target: ServiceTarget & { readonly path: string; readonly configFolder: string | undefined },
): string {
  return `[Unit]
Description=Eva, a personal super harness
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${[...target.executable, "--instance", target.instance].join(" ")}
Environment=PATH=${target.path}${target.configFolder === undefined ? "" : `\nEnvironment=XDG_CONFIG_HOME=${target.configFolder}`}
Restart=on-failure
RestartSec=5
RestartPreventExitStatus=2 3

[Install]
WantedBy=default.target
`;
}

/** Windows runs each value of this key at the user's logon. A normal user may write it: no administrator. */
const windowsRunKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

/**
 * The program and arguments that run the supervisor at logon. conhost.exe is a GUI program, so
 * Windows opens no window for it, and `--headless` gives Eva a console that nobody sees (#407).
 * The supervisor restarts Eva after a crash, and never stops on battery or after some days.
 */
function windowsHiddenStart(
  target: ServiceTarget,
  systemRoot: string,
): { readonly program: string; readonly arguments: string } {
  const eva = [...target.executable.map((part) => `"${part}"`), "supervise", "--instance", target.instance];
  return { program: `${systemRoot}\\System32\\conhost.exe`, arguments: ["--headless", ...eva].join(" ") };
}

/** Saves the start at logon of this Eva, under the name of her old logon task. */
export function windowsRunKeyCommand(target: ServiceTarget, name: string, systemRoot: string): string[] {
  const start = windowsHiddenStart(target, systemRoot);
  const line = `"${start.program}" ${start.arguments}`;
  return ["reg", "add", windowsRunKey, "/v", windowsTaskName(name), "/t", "REG_SZ", "/d", line, "/f"];
}

/**
 * Starts the same command now. A child of the process runner gets NUL as its input, and then
 * `conhost --headless` stops at once. Start-Process gives it no input handle, as Windows does at logon.
 */
export function windowsStartNowCommand(target: ServiceTarget, systemRoot: string): string[] {
  const start = windowsHiddenStart(target, systemRoot);
  const quoted = (text: string): string => `'${text.replaceAll("'", "''")}'`;
  return [
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Start-Process -FilePath ${quoted(start.program)} -ArgumentList ${quoted(start.arguments)} -ErrorAction Stop`,
  ];
}

/**
 * The logon task of an older Eva, which only an administrator could make. It keeps working, so
 * setup removes it only to avoid a second supervisor at logon.
 */
export function windowsOldTaskCommands(name: string): {
  readonly query: string[];
  readonly remove: string[];
  readonly run: string[];
} {
  const task = windowsTaskName(name);
  return {
    query: ["schtasks", "/Query", "/TN", task],
    remove: ["schtasks", "/Delete", "/TN", task, "/F"],
    run: ["schtasks", "/Run", "/TN", task],
  };
}

function windowsTaskName(name: string): string {
  return `Eva-${name.slice("eva-".length)}`;
}

function windowsSystemRoot(host: CliHost): string {
  return host.environment["SystemRoot"] ?? host.environment["SYSTEMROOT"] ?? "C:\\Windows";
}

/** `eva service install` on Windows: the start at logon, then a start now. */
async function installWindowsStart(
  host: CliHost,
  paths: HomePaths,
  runStep: (step: readonly string[]) => Promise<ProcessResult>,
): Promise<number> {
  const name = serviceName(paths);
  const target = { executable: evaCommand(host), instance: instanceNameOf(paths) };
  const systemRoot = windowsSystemRoot(host);
  const oldTask = windowsOldTaskCommands(name);
  const isRunning =
    runningInstancePid(paths.lock, { bootId: host.bootId, isProcessAlive: host.isProcessAlive }) !== null;
  if ((await runStep(oldTask.query)).exitCode === 0 && (await runStep(oldTask.remove)).exitCode !== 0) {
    writeLine(host, "Eva starts when you log in, with her scheduled task.");
    if (isRunning) return exitCodes.clean;
    const started = await runStep(oldTask.run);
    writeLine(host, started.exitCode === 0 ? "She runs now." : `She did not start now: ${started.stderr.trim()}`);
    return exitCodes.clean;
  }
  const saved = await runStep(windowsRunKeyCommand(target, name, systemRoot));
  if (saved.exitCode !== 0) {
    writeLine(host, `Windows did not save the start at logon: ${saved.stderr.trim()}`);
    return exitCodes.crash;
  }
  // A running Eva keeps the lock, so a new supervisor's Eva would only exit 3.
  if (isRunning) {
    writeLine(host, "Eva now starts when you log in, and she already runs.");
    writeLine(host, "If she runs in a terminal window, close it, then run `eva service install` again.");
    return exitCodes.clean;
  }
  const started = await runStep(windowsStartNowCommand(target, systemRoot));
  writeLine(
    host,
    started.exitCode === 0
      ? "Eva now starts when you log in, and she runs now."
      : `Eva now starts when you log in. She did not start now: ${started.stderr.trim()}`,
  );
  return exitCodes.clean;
}

/** `eva service install`: installs and starts the service, or the start at logon on Windows. */
export async function installService(host: CliHost, paths: HomePaths): Promise<number> {
  const runStep = (step: readonly string[]): Promise<ProcessResult> =>
    host.runner.run(step, { cwd: paths.root, environment: childEnvironment(host), timeoutMs: serviceStepTimeoutMs });
  if (host.platform === "win32") return installWindowsStart(host, paths, runStep);
  const executable = evaCommand(host);
  const name = serviceName(paths);
  const instance = instanceNameOf(paths);
  const unitPath = join(host.userHome, ".config", "systemd", "user", `${name}.service`);
  mkdirSync(dirname(unitPath), { recursive: true });
  writeFileSync(
    unitPath,
    systemdUnit({
      executable,
      instance,
      path: servicePath(host.environment["PATH"] ?? "/usr/bin:/bin"),
      configFolder: host.environment["XDG_CONFIG_HOME"],
    }),
  );
  for (const step of [
    ["systemctl", "--user", "daemon-reload"],
    ["systemctl", "--user", "enable", "--now", `${name}.service`],
  ]) {
    const result = await runStep(step);
    if (result.exitCode !== 0) {
      writeLine(host, `${step.join(" ")} failed: ${result.stderr.trim()}`);
      return exitCodes.crash;
    }
  }
  writeLine(host, `Installed ${unitPath}. Eva runs now.`);
  // Linger keeps the user's services running after logout (lesson 85); Eva works without it.
  const linger = await runStep(["loginctl", "enable-linger"]);
  writeLine(
    host,
    linger.exitCode === 0
      ? "Eva keeps running when you log out."
      : `loginctl enable-linger failed: ${linger.stderr.trim()}. Eva stops when you log out until an administrator runs \`sudo loginctl enable-linger ${host.userName}\`.`,
  );
  return exitCodes.clean;
}

/** The starters of the supervisor's children: Eva herself, and on Windows her tray icon. */
export interface SuperviseStarters {
  readonly startLongProcess: LongProcessStarter;
  readonly startLineProcess: LineProcessStarter;
}

/** How long the tray icon waits for Eva's status before it reads her as not answering. */
const trayStatusWaitMs = 4_000;

/**
 * `eva supervise`: runs Eva as a child, and starts her again after a crash or an update.
 * On Windows, it also shows her tray icon (#457). After she stops for good, the icon stays,
 * so the person sees that she stopped, and can start her again.
 */
export async function supervise(host: CliHost, paths: HomePaths, starters: SuperviseStarters): Promise<number> {
  createHomeFolders(paths);
  const logger = new FileLogger({ folder: paths.logsFolder, redactor: new Redactor(), now: () => new Date() });
  // A warning, so the restart shows in `/logs` on the phone, and a line for a person at the console.
  const log = (message: string): void => {
    logger.log("warn", message);
    writeLine(host, message);
  };
  const state: { supervisor: Supervisor | null; quit: boolean; next: PromiseWithResolvers<"restart" | "quit"> } = {
    supervisor: null,
    quit: false,
    next: Promise.withResolvers(),
  };
  const quit = (): void => {
    state.quit = true;
    state.supervisor?.stop();
    state.next.resolve("quit");
  };
  const onChoice = (choice: TrayChoice): void => {
    if (choice === "quit") quit();
    else if (choice === "restart") {
      if (state.supervisor === null) state.next.resolve("restart");
      else {
        // The old Eva can take a while to stop: meanwhile, the icon shows a start, not a hang.
        tray?.setPhase({ kind: "starting" });
        state.supervisor.restart();
      }
    } else openFromTray(host, paths, log);
  };
  const tray =
    host.platform === "win32" ? startWindowsTray(host, paths, starters.startLineProcess, log, onChoice) : null;
  host.onStopSignal(quit);
  for (;;) {
    state.supervisor = superviseOnce(host, paths, starters.startLongProcess, log, tray);
    const exitCode = await state.supervisor.done;
    state.supervisor = null;
    // After a second instance, the other copy of this Eva runs, with her own icon. With no
    // icon, nobody could ask for a restart, so the supervisor ends.
    if (tray === null || !tray.alive() || state.quit || exitCode === exitCodes.secondInstance) {
      await tray?.close();
      return exitCode;
    }
    tray.setPhase({ kind: "stopped", settingsNeedYou: exitCode === exitCodes.badConfig });
    const iconGone = tray.ended.then(() => "quit" as const);
    if ((await Promise.race([state.next.promise, iconGone])) === "quit") {
      await tray.close();
      return exitCode;
    }
    state.next = Promise.withResolvers();
  }
}

/** One run of the supervisor, until Eva stops for good or a stop. */
function superviseOnce(
  host: CliHost,
  paths: HomePaths,
  start: LongProcessStarter,
  log: (message: string) => void,
  tray: Tray | null,
): Supervisor {
  return superviseEva({
    command: [...evaCommand(host), "--instance", instanceNameOf(paths)],
    cwd: paths.root,
    // The child is Eva herself, not an agent, so she gets the whole environment (lesson 96 covers agents).
    environment: Object.fromEntries(
      Object.entries(host.environment).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    start,
    now: () => Date.now(),
    sleep: host.sleep,
    log,
    stopTimeoutMs: shutdownDeadlineMs + hardExitGraceMs,
    pid: host.pid,
    ...(tray === null
      ? {}
      : {
          // Windows has no gentle signal for another process, so Eva gets a restart request,
          // and stops by herself. While the supervisor stops, it does not start her again.
          askStop: async () => {
            const client = runningClient(host, paths);
            if (client !== null) await requestRestart(client);
          },
          // The icon shows Eva as running only after her first answer.
          onPhase: (phase: SupervisorPhase) => {
            tray.setPhase(
              phase.kind === "started" ? { kind: "starting" } : { kind: "waiting", afterMs: phase.afterMs },
            );
          },
        }),
  });
}

/** This Eva's tray icon, or null when it cannot start. */
function startWindowsTray(
  host: CliHost,
  paths: HomePaths,
  start: LineProcessStarter,
  log: (message: string) => void,
  onChoice: (choice: TrayChoice) => void,
): Tray | null {
  // A hung Eva never answers, and the wait for her ends before her request does. One request at
  // a time keeps such requests from piling up.
  let open: Promise<TrayReading | null> | null = null;
  return startTray({
    start,
    command: trayCommand(windowsSystemRoot(host)),
    cwd: paths.root,
    // No PSModulePath: one from PowerShell 7 breaks the modules of Windows PowerShell, which finds its own.
    environment: buildChildEnvironment(host.environment, baseEnvironmentAllowlist),
    instance: instanceNameOf(paths),
    // A broken settings file throws here. The read then counts as no answer, and the supervisor keeps running.
    read: async () => {
      if (open === null) {
        const client = runningClient(host, paths);
        if (client === null) return null;
        const reading = Promise.all([requestStatus(client), requestApprovalCount(client)]).then(
          ([status, approvals]) => ({ status, approvals }),
          () => null,
        );
        open = reading;
        void reading.finally(() => {
          open = null;
        });
      }
      return Promise.race([open, host.sleep(trayStatusWaitMs).then(() => null)]);
    },
    onChoice,
    sleep: host.sleep,
    log,
  });
}

/** Open Eva in the tray menu: her page in this computer's browser, logged in, as `eva open` does. */
function openFromTray(host: CliHost, paths: HomePaths, log: (message: string) => void): void {
  // Async, so a broken settings file in runningClient becomes a log line, not a crash of the supervisor.
  void (async () => {
    const client = runningClient(host, paths);
    if (client !== null) await openLoggedIn(host, client, null);
  })().catch((error: unknown) => {
    log(`Eva's page did not open: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/** How Eva starts again after an update. It reads the parent at the restart: the supervisor may have died. */
export function restartMethodNow(host: CliHost): "supervisor" | "new-copy" {
  return restartMethod(host.environment, host.isProcessAlive, host.parentPid());
}
