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

/** The allowlisted variables of `source`, plus `extra`, which wins on a clash. */
export function buildChildEnvironment(
  source: EnvironmentMap,
  allowlist: readonly string[],
  extra: EnvironmentMap = {},
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of allowlist) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  for (const [name, value] of Object.entries(extra)) {
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}
