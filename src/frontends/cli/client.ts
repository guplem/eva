/** `eva status` and `eva projects`: short reads of the local API, as text for a terminal. */
import type { EvaStatus } from "../../core/eva.ts";
import type { UpdateStatus } from "../../core/updates/updater.ts";
import type { VaultSyncState } from "../../core/vault/vault-sync.ts";

export interface ClientOptions {
  readonly baseUrl: string;
  readonly token: string;
}

interface ProjectBody {
  readonly id: string;
  readonly title: string;
  readonly frontMatter: { readonly status: string | null };
}

export async function describeStatus(options: ClientOptions, pairingCode: string | null = null): Promise<string> {
  const status = await getJson<EvaStatus>(options, "/api/status");
  return [
    `Eva ${status.version}, ${describeRole(status)}`,
    `Vault: ${status.vaultPath ?? "not configured"}`,
    describeSync(status.vaultSync),
    // Over JSON the date arrives as text; new Date reads both forms.
    `Last push: ${status.vaultSync.lastPushAt === null ? "none since start" : new Date(status.vaultSync.lastPushAt).toISOString()}`,
    ...heldBackLines(status.vaultSync.withheldFiles),
    `Chats: ${String(status.sessionCount)}, running now: ${String(status.busySessionIds.length)}`,
    describeLastTurn(status.lastTurn),
    ...(status.update === null ? [] : [describeUpdate(status.update)]),
    ...(pairingCode === null ? [] : [`Telegram pairing code: send ${pairingCode} to your bot`]),
  ].join("\n");
}

/** The files that the secret scan keeps out of the vault's commits (lesson 26), or nothing. */
export function heldBackLines(files: readonly string[]): string[] {
  return files.length === 0 ? [] : [`Held back from the vault, as they look like secrets: ${files.join(", ")}`];
}

/** One line with the last turn's tokens, so a broken prompt cache shows (lesson 120). */
export function describeLastTurn(lastTurn: EvaStatus["lastTurn"]): string {
  if (lastTurn === null) return "Last turn: none since start";
  return `Last turn: ${String(lastTurn.inputTokens)} in, ${String(lastTurn.outputTokens)} out, cache ${String(lastTurn.cacheReadTokens)} read, ${String(lastTurn.cacheWriteTokens)} written`;
}

/** `eva work`: starts project work, and names the chat that reports the result (plan §5.3). */
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

/** Which machine is the hub (plan §4.4), from this machine's view. */
export function describeRole(status: Pick<EvaStatus, "role" | "machine" | "hub">): string {
  if (status.role === "hub") return `hub: this machine (${status.machine})`;
  return `satellite: the hub is ${status.hub ?? "unknown"}; this machine is ${status.machine}`;
}

/** `eva hub` while Eva runs. */
export async function requestHub(options: ClientOptions): Promise<string> {
  const status = await postJson<EvaStatus>(options, "/api/hub", {});
  return `${status.machine} is now the hub. ${describeSync(status.vaultSync)}`;
}

/** One line about Eva's version and her updates. */
export function describeUpdate(update: UpdateStatus): string {
  const automatic = update.frequency === "off" ? "automatic updates off" : `checks ${update.frequency}`;
  if (update.lastError !== null) return `Updates: ${automatic}; the last check failed: ${update.lastError}`;
  if (update.phase === "waiting_for_idle")
    return `Updates: ${update.latest ?? "?"} installs when the running chats end`;
  if (update.phase === "updating" || update.phase === "restarting")
    return `Updates: installing ${update.latest ?? "?"}; Eva restarts in a moment`;
  if (update.current === null) return `Updates: ${automatic}; not checked yet`;
  return update.available
    ? `Updates: ${update.latest ?? "?"} is available (this is ${update.current}); ${automatic}`
    : `Updates: ${update.current} is the latest; ${automatic}`;
}

/** One line about the vault sync. */
export function describeSync(state: VaultSyncState): string {
  return `Vault sync: ${state.status}${state.lastError === null ? "" : ` (${state.lastError})`}`;
}

/** `eva update` and `eva update --check` while Eva runs: the running Eva does the work. */
export async function requestUpdate(options: ClientOptions, checkOnly: boolean): Promise<string> {
  return describeUpdate(await postJson<UpdateStatus>(options, checkOnly ? "/api/update/check" : "/api/update", {}));
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

export async function describeProjects(options: ClientOptions, query: string): Promise<string> {
  const path = query.trim() === "" ? "/api/projects" : `/api/projects?text=${encodeURIComponent(query)}`;
  const projects = await getJson<ProjectBody[]>(options, path);
  if (projects.length === 0) return "No project matches.";
  return projects.map((project) => `${project.id}  ${project.frontMatter.status ?? "?"}  ${project.title}`).join("\n");
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
