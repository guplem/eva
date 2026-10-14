/** `eva status` and `eva projects`: short reads of the local API, as text for a terminal. */

export interface ClientOptions {
  readonly baseUrl: string;
  readonly token: string;
}

interface StatusBody {
  readonly vaultPath: string | null;
  readonly role: string;
  readonly vaultSync: {
    readonly status: string;
    readonly lastPushAt: string | null;
    readonly lastError: string | null;
  };
  readonly sessionCount: number;
  readonly busySessionIds: readonly string[];
}

interface ProjectBody {
  readonly id: string;
  readonly title: string;
  readonly frontMatter: { readonly status: string | null };
}

export async function describeStatus(options: ClientOptions, pairingCode: string | null = null): Promise<string> {
  const status = await getJson<StatusBody>(options, "/api/status");
  return [
    `Role: ${status.role}`,
    `Vault: ${status.vaultPath ?? "not configured"}`,
    `Vault sync: ${status.vaultSync.status}${status.vaultSync.lastError === null ? "" : ` (${status.vaultSync.lastError})`}`,
    `Last push: ${status.vaultSync.lastPushAt ?? "none since start"}`,
    `Chats: ${String(status.sessionCount)}, running now: ${String(status.busySessionIds.length)}`,
    ...(pairingCode === null ? [] : [`Telegram pairing code: send ${pairingCode} to your bot`]),
  ].join("\n");
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
