/**
 * Builds the environment of a child process from an explicit allowlist (lesson 96).
 * A child process never inherits Eva's whole environment, so Eva's own secrets never
 * reach an agent through it.
 */

/** Variables every child process needs to run at all, on Windows and on Linux. */
export const baseEnvironmentAllowlist: readonly string[] = [
  "PATH",
  "Path",
  "PATHEXT",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "ProgramFiles",
  "USERNAME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "TERM",
  "SHELL",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
];

/** The person's proxy and certificate settings, for a child that downloads, such as an installer. */
export const proxyEnvironmentAllowlist: readonly string[] = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
];

export type EnvironmentMap = Readonly<Record<string, string | undefined>>;

/**
 * The allowlisted variables of `source`, plus `extra`, which wins on a clash.
 * On Windows, a name is case-insensitive, so the child gets one key for each name (#430).
 */
export function buildChildEnvironment(
  source: EnvironmentMap,
  allowlist: readonly string[],
  extra: EnvironmentMap = {},
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  // Bun's process.env on Windows gives the value of `Path` for `PATH` too. Two keys for one
  // variable keep git from finding sh.exe, and git then fails with no message.
  const keyOf = (name: string): string => (platform === "win32" ? name.toLowerCase() : name);
  const variables = new Map<string, readonly [string, string]>();
  for (const name of allowlist) {
    const value = source[name];
    if (value !== undefined && !variables.has(keyOf(name))) variables.set(keyOf(name), [name, value]);
  }
  for (const [name, value] of Object.entries(extra)) {
    if (value !== undefined) variables.set(keyOf(name), [name, value]);
  }
  return Object.fromEntries(variables.values());
}

/** The desktop session's variables, for a child that opens a window, such as the default browser. */
export const desktopEnvironmentAllowlist: readonly string[] = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "DBUS_SESSION_BUS_ADDRESS",
  "XDG_CURRENT_DESKTOP",
  "XDG_SESSION_TYPE",
  "XDG_DATA_DIRS",
  "BROWSER",
];
