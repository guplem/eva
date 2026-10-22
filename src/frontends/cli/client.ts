/** `eva status` and `eva projects`: short reads of the local API, as text for a terminal. */
import type { EvaStatus, EvaVersions } from "../../core/eva.ts";
import type { ProgressStep } from "../../core/setup/progress.ts";
import type { ToolVersion } from "../../core/tool-versions.ts";
import { setupSteps } from "../../core/remote-access/steps.ts";
import type { EngineUpdateStatus } from "../../core/updates/engine-update.ts";
import type { UpdateStatus } from "../../core/updates/updater.ts";
import type { VaultSyncState, WithheldFile, WithheldReason } from "../../core/vault/vault-sync.ts";
import type { LogEntry } from "../../shared/logger.ts";
import { scanCodeLines } from "./network-setup.ts";

export interface ClientOptions {
  readonly baseUrl: string;
  readonly token: string;
}

interface ProjectBody {
  readonly id: string;
  readonly title: string;
  readonly frontMatter: { readonly status: string | null; readonly tags: readonly string[] };
  readonly warnings: readonly string[];
}

export async function describeStatus(options: ClientOptions, pairingCode: string | null = null): Promise<string> {
  const status = await getJson<EvaStatus>(options, "/api/status");
  const versions = await getJson<EvaVersions>(options, "/api/versions");
  return statusText(status, versions.tools, pairingCode);
}

/** The text of `eva status`. */
export function statusText(status: EvaStatus, tools: readonly ToolVersion[], pairingCode: string | null): string {
  const url = status.remoteAccess?.url ?? null;
  return [
    ...describeStatusLines(status),
    describeToolVersions(tools),
    ...(pairingCode === null ? [] : [`Telegram pairing code: send ${pairingCode} to your bot`]),
    // Only the terminal gets the code: Telegram does not keep the shape of the blocks.
    ...(url === null ? [] : scanCodeLines(url)),
  ].join("\n");
}

/** The status for `eva status` and Telegram /status: a verdict first, then the problems, then the details. */
export function describeStatusLines(status: EvaStatus): string[] {
  const count = status.problems.length;
  return [
    count === 0 ? "All good" : `${String(count)} ${count === 1 ? "problem" : "problems"}`,
    ...status.problems.map((problem) => `• ${problem}`),
    `Eva ${status.version}, ${describeRole(status)}`,
    ...(status.setupMissing > 0
      ? [
          `Setup: ${String(status.setupMissing)} ${status.setupMissing === 1 ? "step" : "steps"} left. Open Settings on Eva's page to see them.`,
        ]
      : []),
    `Vault: ${status.vaultPath ?? "not configured"}`,
    describeSync(status.vaultSync),
    // An older Eva sends no field: read it as on.
    ...(status.vaultPath !== null && (status as Partial<EvaStatus>).vaultAutoSync === false
      ? ["Automatic sync is off. Send /sync, or run eva sync, to send the notes."]
      : []),
    // Over JSON the date arrives as text; new Date reads both forms.
    `Last push: ${status.vaultSync.lastPushAt === null ? "none since start" : new Date(status.vaultSync.lastPushAt).toISOString()}`,
    ...heldBackLines(status.vaultSync.withheldFiles),
    `Chats: ${String(status.sessionCount)}, running now: ${String(status.busySessionIds.length)}`,
    describeLastTurn(status.lastTurn),
    ...(status.update === null ? [] : [describeUpdate(status.update)]),
    ...describeRemoteAccess(status.remoteAccess),
  ];
}

/** One line with the version of each tool that is there. `eva doctor` names the missing ones. */
export function describeToolVersions(tools: readonly ToolVersion[]): string {
  const found = tools.filter((tool) => tool.version !== null);
  if (found.length === 0) return "Tools: none found";
  return `Tools: ${found.map((tool) => `${tool.program} ${tool.version ?? ""}`).join(", ")}`;
}

/** One line for each log entry: the time (UTC), the level, the message and its details. */
export function describeLogEntries(entries: readonly LogEntry[]): string {
  if (entries.length === 0) return "No warnings or errors in the log.";
  return entries
    .map(
      (entry) =>
        `${entry.at.slice(0, 16).replace("T", " ")} ${entry.level} ${entry.message}${entry.summary === "" ? "" : ` (${entry.summary})`}`,
    )
    .join("\n");
}

/** The files that the sync keeps out of the vault's commits (lesson 26), one line per reason, or nothing. */
export function heldBackLines(files: readonly WithheldFile[]): string[] {
  const reasons: readonly (readonly [WithheldReason, string])[] = [
    ["secret", "as they look like secrets"],
    ["too_large", "as they are over 50 MB"],
  ];
  return reasons.flatMap(([reason, because]) => {
    const paths = files.filter((file) => file.reason === reason).map((file) => file.path);
    return paths.length === 0 ? [] : [`Held back from the vault, ${because}: ${paths.join(", ")}`];
  });
}

/** One line with the last turn's tokens, so a broken prompt cache shows (lesson 120). */
export function describeLastTurn(lastTurn: EvaStatus["lastTurn"]): string {
  if (lastTurn === null) return "Last turn: none since start";
  return `Last turn: ${String(lastTurn.inputTokens)} in, ${String(lastTurn.outputTokens)} out, cache ${String(lastTurn.cacheReadTokens)} read, ${String(lastTurn.cacheWriteTokens)} written`;
}

/** `eva work`: starts project work, and names the chat that reports the result. */
export async function startProjectWork(
  options: ClientOptions,
  input: { projectId: string; request: string; reportToSessionId: string | null },
): Promise<string> {
  const response = await fetch(`${options.baseUrl}/api/projects/${encodeURIComponent(input.projectId)}/work`, {
    method: "POST",
    headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      request: input.request,
      ...(input.reportToSessionId === null ? {} : { reportToSessionId: input.reportToSessionId }),
    }),
  });
  if (!response.ok) throw new Error(`Eva answered ${String(response.status)}: ${await response.text()}`);
  const started = (await response.json()) as { sessionId: string; clone: string };
  return input.reportToSessionId === null
    ? `Started the work in clone ${started.clone}, chat ${started.sessionId}.`
    : `Started the work in clone ${started.clone}, chat ${started.sessionId}. Its result arrives in this chat as a new message when it ends.`;
}

/** Which machine is the hub, from this machine's view. */
export function describeRole(status: Pick<EvaStatus, "role" | "machine" | "hub">): string {
  if (status.role === "hub") return `hub: this machine (${status.machine})`;
  return `satellite: the hub is ${status.hub ?? "unknown"}; this machine is ${status.machine}`;
}

/** The web UI's address for the phone, or the next setup step; nothing when phone access is off. */
export function describeRemoteAccess(remote: EvaStatus["remoteAccess"]): string[] {
  if (remote === null) return [];
  if (remote.url !== null) return [`Phone access: ${remote.url}`];
  const next = setupSteps(remote)[0];
  return [`Phone access: not ready.${next === undefined ? "" : ` ${next.text}`} Run \`eva link\` for every step.`];
}

/** The running Eva's status. */
export function requestStatus(options: ClientOptions): Promise<EvaStatus> {
  return getJson<EvaStatus>(options, "/api/status");
}

/** `eva hub` while Eva runs. */
export async function requestHub(options: ClientOptions): Promise<string> {
  const status = await postJson<EvaStatus>(options, "/api/hub", {});
  return `${status.machine} is now the hub. ${describeSync(status.vaultSync)}`;
}

/** The warning before an update across a major version, in every front end. */
export const majorUpdateWarning =
  "This is a major update. It can break things that work today. It should be safe, but read the breaking changes first.";

/**
 * The share of the new version that Eva downloaded, from 0 to 1. Null when the size is unknown,
 * or when an older Eva sends no download.
 */
export function downloadShare(download: UpdateStatus["download"] | undefined): number | null {
  if (download === undefined || download === null) return null;
  if (download.totalBytes === null || download.totalBytes <= 0) return null;
  return Math.min(1, download.receivedBytes / download.totalBytes);
}

/** One line about Eva's version and her updates. */
export function describeUpdate(update: UpdateStatus): string {
  const automatic = update.frequency === "off" ? "automatic updates off" : `checks ${update.frequency}`;
  if (update.lastError !== null)
    return `Updates: ${automatic}; the last ${update.failedStep ?? "check"} failed: ${update.lastError}`;
  const next = update.target ?? update.latest ?? "?";
  if (update.phase === "waiting_for_idle") return `Updates: ${next} installs when the running chats end`;
  if (update.phase === "updating") {
    const share = downloadShare(update.download);
    return share === null
      ? `Updates: installing ${next}`
      : `Updates: installing ${next} (${String(Math.round(share * 100))}% downloaded)`;
  }
  // The restart waits for the running chats, which can take hours (lesson 92).
  if (update.phase === "restarting")
    return `Updates: ${update.latest ?? "?"} is installed; Eva restarts when no chat runs`;
  if (update.current === null) return `Updates: ${automatic}; not checked yet`;
  const heldBack =
    update.heldBack === null ? "" : `; ${update.heldBack} is held back by the update policy (${update.install})`;
  return update.available
    ? `Updates: ${next} is available (this is ${update.current})${heldBack}; ${automatic}`
    : heldBack === ""
      ? `Updates: ${update.current} is the latest; ${automatic}`
      : `Updates: this is ${update.current}${heldBack}; ${automatic}`;
}

/** In a terminal, a held-back version comes with the command that installs it. */
export function describeUpdateWithHint(update: UpdateStatus): string {
  const line = describeUpdate(update);
  if (update.heldBack === null || update.phase !== "idle") return line;
  return `${line}\nRun \`eva update ${update.heldBack}\` to install it.`;
}

/**
 * What the jump to a chosen version brings, with the major-update warning first. Null when the
 * version is not a newer release.
 */
export function describeRelease(update: UpdateStatus, version: string): string | null {
  const release = update.releases.find((each) => each.version === version);
  if (release === undefined) return null;
  const warning = release.level === "major" ? `\n\n${majorUpdateWarning}` : "";
  const moveOn = policyMovesOn(update, version);
  return `Eva ${update.current ?? "?"} → ${version}${warning}\n\n${release.summary}${moveOn === null ? "" : `\n\n${moveOn}`}`;
}

/**
 * A version below the policy's pick does not last: the first check after the restart installs
 * the pick. Null when the chosen version is at or above it.
 */
export function policyMovesOn(update: UpdateStatus, version: string): string | null {
  // The releases come newest first, so a target before the chosen one is newer.
  const index = update.releases.findIndex((each) => each.version === version);
  const targetIndex = update.releases.findIndex((each) => each.version === update.target);
  if (index === -1 || targetIndex === -1 || targetIndex >= index) return null;
  return `The update policy (${update.install}) installs ${update.target ?? "?"} after the restart. To stay on ${version}, change the policy first.`;
}

/** One line about the engine update of the settings page. */
export function describeEngineUpdate(update: EngineUpdateStatus): string {
  if (update.phase === "waiting_for_idle")
    return "Claude Code: the update starts when the running chats and Eva's own update end";
  if (update.phase === "updating") return "Claude Code: updating…";
  const last = update.last;
  if (last === null) return "Claude Code: no update has run yet";
  if (last.outcome === "failed") return `Claude Code: the update failed: ${last.detail ?? "unknown reason."}`;
  if (last.outcome === "up_to_date") return `Claude Code: ${last.after ?? "?"} is the latest`;
  return `Claude Code: updated from ${last.before ?? "?"} to ${last.after ?? "?"}; the next turn uses it`;
}

/** One line about the vault sync. */
export function describeSync(state: VaultSyncState): string {
  return `Vault sync: ${state.status}${state.lastError === null ? "" : ` (${state.lastError})`}`;
}

/**
 * `eva update [version]` and `eva update --check` while Eva runs: the running Eva does the work.
 * Without a version, she installs what the update policy allows. With one, the text first says
 * what the jump brings.
 */
export async function requestUpdate(
  options: ClientOptions,
  checkOnly: boolean,
  version: string | null = null,
): Promise<string> {
  const checked = await postJson<UpdateStatus>(options, "/api/update/check", {});
  if (checkOnly) return describeUpdateWithHint(checked);
  const release = version === null ? null : describeRelease(checked, version);
  const update = await postJson<UpdateStatus>(options, "/api/update", version === null ? {} : { version });
  return release === null ? describeUpdateWithHint(update) : `${release}\n\n${describeUpdate(update)}`;
}

/** `eva sync` while Eva runs. */
export async function requestSync(options: ClientOptions): Promise<string> {
  return describeSync(await postJson<VaultSyncState>(options, "/api/vault/sync", {}));
}

/** `eva settings set` while Eva runs, so the running Eva uses the change too. */
export async function requestSettingsChange(
  options: ClientOptions,
  change: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  const response = await fetch(`${options.baseUrl}/api/settings`, {
    method: "PUT",
    headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
    body: JSON.stringify(change),
  });
  if (!response.ok) throw new Error(`Eva answered ${String(response.status)}: ${await response.text()}`);
  return ((await response.json()) as { restartNeeded: boolean }).restartNeeded;
}

/**
 * `eva devices allow`: lets in the browser that waits with this code. Returns its label, or null
 * when no browser waits with it. The device token stays with that browser.
 */
export async function requestDeviceAllow(options: ClientOptions, code: string): Promise<string | null> {
  const response = await fetch(`${options.baseUrl}/api/devices/allow`, {
    method: "POST",
    headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Eva answered ${String(response.status)}: ${await response.text()}`);
  return ((await response.json()) as { label: string }).label;
}

/** The setup progress list of the running Eva, one line per step, as the page shows it. */
export async function describeSetupProgress(options: ClientOptions): Promise<string[]> {
  const state = await getJson<{ progress: readonly ProgressStep[] }>(options, "/api/settings/setup");
  // Plain ASCII, as in the rest of setup, so an old Windows console shows the marks too.
  const marks = { done: "[ok]", missing: "[to do]", optional: "[optional]" } as const;
  return [
    "Where each step stands, also in Settings on Eva's page:",
    ...state.progress.map((step) => `  ${marks[step.state]} ${step.title}: ${step.detail}`),
  ];
}

/** True when the running Eva's page answers, as it does a few seconds after her start. */
export async function isAnswering(options: ClientOptions): Promise<boolean> {
  try {
    const response = await fetch(`${options.baseUrl}/api/status`, {
      headers: { authorization: `Bearer ${options.token}` },
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Restarts the running Eva, so she reads the files that setup changed. */
export async function requestRestart(options: ClientOptions): Promise<void> {
  const response = await fetch(`${options.baseUrl}/api/restart`, {
    method: "POST",
    headers: { authorization: `Bearer ${options.token}` },
  });
  if (!response.ok) throw new Error(`Eva answered ${String(response.status)}: ${await response.text()}`);
}

export async function describeProjects(options: ClientOptions, query: string): Promise<string> {
  const path = query.trim() === "" ? "/api/projects" : `/api/projects?text=${encodeURIComponent(query)}`;
  const projects = await getJson<ProjectBody[]>(options, path);
  return describeProjectLines(projects).join("\n");
}

/** One line per project for `eva projects` and Telegram /projects, each warning under its project. */
export function describeProjectLines(projects: readonly ProjectBody[]): string[] {
  if (projects.length === 0) return ["No project matches."];
  return projects.flatMap((project) => [
    [project.id, project.frontMatter.status ?? "?", project.title, ...hashTags(project.frontMatter.tags)].join("  "),
    ...project.warnings.map((warning) => `  ⚠ ${warning}`),
  ]);
}

function hashTags(tags: readonly string[]): string[] {
  return tags.length === 0 ? [] : [tags.map((tag) => `#${tag}`).join(" ")];
}

async function postJson<Body>(options: ClientOptions, path: string, body: unknown): Promise<Body> {
  const response = await fetch(`${options.baseUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Eva answered ${String(response.status)}: ${await response.text()}`);
  return (await response.json()) as Body;
}

async function getJson<Body>(options: ClientOptions, path: string): Promise<Body> {
  const response = await fetch(`${options.baseUrl}${path}`, { headers: { authorization: `Bearer ${options.token}` } });
  if (!response.ok) throw new Error(`Eva answered ${String(response.status)}: ${await response.text()}`);
  return (await response.json()) as Body;
}

/** A new login link from the running Eva, for `eva open`. Only the local token may ask (#407). */
export async function requestLoginLink(options: ClientOptions): Promise<{ secret: string; expiresAt: string }> {
  const response = await fetch(`${options.baseUrl}/api/devices/link`, {
    method: "POST",
    headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`Eva answered ${String(response.status)}: ${await response.text()}`);
  return (await response.json()) as { secret: string; expiresAt: string };
}
