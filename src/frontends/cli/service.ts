/**
 * `eva service install`: starts Eva by herself, as a systemd user service on Linux (lesson 85)
 * or a logon task on Windows. The logon task runs Eva's own supervisor, which restarts her
 * after a crash as systemd does. Exit codes 2 (bad config) and 3 (second instance) never
 * restart (lesson 89).
 */

import { basename } from "node:path";
import { supervisedVariable } from "../../core/instance/supervisor.ts";

export interface ServiceTarget {
  /** The command that runs Eva, from `serviceCommand`: [bun, src/main.ts] or [eva]. */
  readonly executable: readonly string[];
  readonly home: string;
}

/**
 * The service's name: `eva` for the default home, and `eva-<folder>` for any other, so a second
 * instance on the same machine never replaces the first one's service.
 */
export function serviceName(home: string, defaultHome: string): string {
  if (home === defaultHome) return "eva";
  const folder = basename(home)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `eva-${folder === "" ? "instance" : folder}`;
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
): "supervisor" | "new-copy" {
  // systemd sets INVOCATION_ID for each run of a unit.
  if (environment["INVOCATION_ID"] !== undefined) return "supervisor";
  const supervisor = Number(environment[supervisedVariable]);
  return Number.isSafeInteger(supervisor) && supervisor > 0 && isProcessAlive(supervisor) ? "supervisor" : "new-copy";
}

export function systemdUnit(target: ServiceTarget & { readonly path: string }): string {
  return `[Unit]
Description=Eva, a personal super harness
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${[...target.executable, "--home", target.home].join(" ")}
Environment=PATH=${target.path}
Restart=on-failure
RestartSec=5
RestartPreventExitStatus=2 3

[Install]
WantedBy=default.target
`;
}

/**
 * The command that the service runs. The single executable runs itself: its code lives in Bun's
 * embedded file system, which only that executable can read.
 */
export function serviceCommand(inputs: {
  readonly standalone: boolean;
  readonly execPath: string;
  readonly mainScript: string;
}): string[] {
  return inputs.standalone ? [inputs.execPath] : [inputs.execPath, inputs.mainScript];
}

/** The logon task runs the supervisor, because Task Scheduler cannot restart Eva after a crash. */
export function windowsTaskCommand(target: ServiceTarget, name = "eva"): string[] {
  const command = [...target.executable.map((part) => `"${part}"`), "supervise", "--home", `"${target.home}"`].join(
    " ",
  );
  return ["schtasks", "/Create", "/F", "/SC", "ONLOGON", "/TN", windowsTaskName(name), "/TR", command];
}

/** Starts the logon task now, so Eva runs without a new logon. */
export function windowsRunTaskCommand(name = "eva"): string[] {
  return ["schtasks", "/Run", "/TN", windowsTaskName(name)];
}

function windowsTaskName(name: string): string {
  return name === "eva" ? "Eva" : `Eva-${name.slice("eva-".length)}`;
}
