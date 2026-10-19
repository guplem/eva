/**
 * `eva service install`: starts Eva by herself, as a systemd user service on Linux (lesson 85)
 * or a logon task on Windows. The logon task runs Eva's own supervisor, which restarts her
 * after a crash as systemd does. Exit codes 2 (bad config) and 3 (second instance) never
 * restart (lesson 89). This file also holds `eva supervise`, and how Eva starts again after an update.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runningInstancePid } from "../../core/instance/instance-lock.ts";
import { hardExitGraceMs, shutdownDeadlineMs } from "../../core/instance/shutdown.ts";
import { superviseEva, supervisedVariable } from "../../core/instance/supervisor.ts";
import { createHomeFolders, instanceNameOf, type HomePaths } from "../../core/settings/home.ts";
import { exitCodes } from "../../shared/exit-codes.ts";
import { FileLogger } from "../../shared/logger.ts";
import type { LongProcessStarter } from "../../shared/long-process.ts";
import type { ProcessResult } from "../../shared/process-runner.ts";
import { Redactor } from "../../shared/redaction.ts";
import { childEnvironment, evaCommand, writeLine, type CliHost } from "./host.ts";

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

/** The logon task runs the supervisor, because Task Scheduler cannot restart Eva after a crash. */
export function windowsTaskCommand(target: ServiceTarget, name: string): string[] {
  const command = [...target.executable.map((part) => `"${part}"`), "supervise", "--instance", target.instance].join(
    " ",
  );
  return ["schtasks", "/Create", "/F", "/SC", "ONLOGON", "/TN", windowsTaskName(name), "/TR", command];
}

/**
 * Lifts the limits that `schtasks /Create` sets on each task. Windows stops a task after three
 * days, and when a laptop switches to its battery. Either stop would end the supervisor.
 * The new settings replace all of the task's settings: the other defaults suit Eva too.
 */
export function windowsTaskSettingsCommand(name: string): string[] {
  const settings =
    "New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries";
  // The task name comes from serviceName, which keeps only letters, digits and dashes, so the quotes are safe.
  return [
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Set-ScheduledTask -TaskName '${windowsTaskName(name)}' -Settings (${settings}) -ErrorAction Stop | Out-Null`,
  ];
}

/** Starts the logon task now, so Eva runs without a new logon. */
export function windowsRunTaskCommand(name: string): string[] {
  return ["schtasks", "/Run", "/TN", windowsTaskName(name)];
}

function windowsTaskName(name: string): string {
  return `Eva-${name.slice("eva-".length)}`;
}

/** `eva service install`: installs and starts the service, or the logon task on Windows. */
export async function installService(host: CliHost, paths: HomePaths): Promise<number> {
  const executable = evaCommand(host);
  const name = serviceName(paths);
  const instance = instanceNameOf(paths);
  const runStep = (step: readonly string[]): Promise<ProcessResult> =>
    host.runner.run(step, { cwd: paths.root, environment: childEnvironment(host), timeoutMs: serviceStepTimeoutMs });
  if (host.platform === "win32") {
    const created = await runStep(windowsTaskCommand({ executable, instance }, name));
    if (created.exitCode !== 0) {
      writeLine(host, `schtasks failed: ${created.stderr.trim()}`);
      writeLine(host, "If it says that access is denied, open the terminal with Run as administrator, then try again.");
      return exitCodes.crash;
    }
    const settings = await runStep(windowsTaskSettingsCommand(name));
    if (settings.exitCode !== 0)
      writeLine(host, `Windows may stop Eva after three days, or on battery: ${settings.stderr.trim()}`);
    // A running Eva keeps the lock, so the new task's Eva would only exit 3.
    if (runningInstancePid(paths.lock, { bootId: host.bootId, isProcessAlive: host.isProcessAlive }) !== null) {
      writeLine(
        host,
        "Eva now starts when you log in. She already runs, so the new task takes over at your next logon.",
      );
      writeLine(host, `To switch now, stop her, then run: ${windowsRunTaskCommand(name).join(" ")}`);
      return exitCodes.clean;
    }
    const started = await runStep(windowsRunTaskCommand(name));
    writeLine(
      host,
      started.exitCode === 0
        ? "Eva now starts when you log in, and she runs now."
        : `Eva now starts when you log in. She did not start now: ${started.stderr.trim()}`,
    );
    return exitCodes.clean;
  }
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

/** `eva supervise`: runs Eva as a child, and starts her again after a crash or an update. */
export function supervise(host: CliHost, paths: HomePaths, start: LongProcessStarter): Promise<number> {
  createHomeFolders(paths);
  const logger = new FileLogger({ folder: paths.logsFolder, redactor: new Redactor(), now: () => new Date() });
  const supervisor = superviseEva({
    command: [...evaCommand(host), "--instance", instanceNameOf(paths)],
    cwd: paths.root,
    // The child is Eva herself, not an agent, so she gets the whole environment (lesson 96 covers agents).
    environment: Object.fromEntries(
      Object.entries(host.environment).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    start,
    now: () => Date.now(),
    sleep: host.sleep,
    // A warning, so the restart shows in `/logs` on the phone, and a line for a person at the console.
    log: (message) => {
      logger.log("warn", message);
      writeLine(host, message);
    },
    stopTimeoutMs: shutdownDeadlineMs + hardExitGraceMs,
    pid: host.pid,
  });
  host.onStopSignal(() => {
    supervisor.stop();
  });
  return supervisor.done;
}

/** How Eva starts again after an update. It reads the parent at the restart: the supervisor may have died. */
export function restartMethodNow(host: CliHost): "supervisor" | "new-copy" {
  return restartMethod(host.environment, host.isProcessAlive, host.parentPid());
}
