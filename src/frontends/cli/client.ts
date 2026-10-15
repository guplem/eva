/** `eva status` and `eva projects`: short reads of the local API, as text for a terminal. */
import type { EvaStatus } from "../../core/eva.ts";

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
    `Eva ${status.version}, role: ${status.role}`,
    `Vault: ${status.vaultPath ?? "not configured"}`,
    `Vault sync: ${status.vaultSync.status}${status.vaultSync.lastError === null ? "" : ` (${status.vaultSync.lastError})`}`,
    // Over JSON the date arrives as text; new Date reads both forms.
    `Last push: ${status.vaultSync.lastPushAt === null ? "none since start" : new Date(status.vaultSync.lastPushAt).toISOString()}`,
    `Chats: ${String(status.sessionCount)}, running now: ${String(status.busySessionIds.length)}`,
    describeLastTurn(status.lastTurn),
    ...(pairingCode === null ? [] : [`Telegram pairing code: send ${pairingCode} to your bot`]),
  ].join("\n");
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

export async function describeProjects(options: ClientOptions, query: string): Promise<string> {
  const path = query.trim() === "" ? "/api/projects" : `/api/projects?text=${encodeURIComponent(query)}`;
  const projects = await getJson<ProjectBody[]>(options, path);
  if (projects.length === 0) return "No project matches.";
  return projects.map((project) => `${project.id}  ${project.frontMatter.status ?? "?"}  ${project.title}`).join("\n");
}

async function getJson<Body>(options: ClientOptions, path: string): Promise<Body> {
  const response = await fetch(`${options.baseUrl}${path}`, { headers: { authorization: `Bearer ${options.token}` } });
  if (!response.ok) throw new Error(`Eva answered ${String(response.status)}: ${await response.text()}`);
  return (await response.json()) as Body;
}
