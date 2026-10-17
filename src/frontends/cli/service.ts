/**
 * `eva service install`: starts Eva by herself, as a systemd user service on Linux (lesson 85)
 * or a logon task on Windows. Exit codes 2 (bad config) and 3 (second instance) never
 * restart (lesson 89, docs/plan.md §4.3).
 */

export interface ServiceTarget {
  /** The command that runs Eva, such as [bun, src/main.ts] before P8 or [eva] after it. */
  readonly executable: readonly string[];
  readonly home: string;
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

export function windowsTaskCommand(target: ServiceTarget): string[] {
  const command = [...target.executable.map((part) => `"${part}"`), "--home", `"${target.home}"`].join(" ");
  return ["schtasks", "/Create", "/F", "/SC", "ONLOGON", "/TN", "Eva", "/TR", command];
}
