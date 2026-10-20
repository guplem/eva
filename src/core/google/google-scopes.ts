/**
 * The Google scopes that `workspace-mcp` asks for, copied from its `auth/scopes.py`. Eva runs the
 * login herself, so the server accepts her login only when it holds these scopes. Change this
 * list together with `workspaceMcpVersion`.
 */
import type { EvaConfig } from "../settings/home.ts";

type GoogleService = EvaConfig["google"]["services"][number];

const auth = "https://www.googleapis.com/auth/";

const baseScopes = [`${auth}userinfo.email`, `${auth}userinfo.profile`, "openid"];

const fullScopes: Readonly<Record<GoogleService, readonly string[]>> = {
  calendar: [`${auth}calendar`, `${auth}calendar.readonly`, `${auth}calendar.events`],
  drive: [`${auth}drive`, `${auth}drive.readonly`, `${auth}drive.file`],
  contacts: [`${auth}contacts`, `${auth}contacts.readonly`],
  tasks: [`${auth}tasks`, `${auth}tasks.readonly`],
  gmail: [
    `${auth}gmail.readonly`,
    `${auth}gmail.send`,
    `${auth}gmail.compose`,
    `${auth}gmail.modify`,
    `${auth}gmail.labels`,
    `${auth}gmail.settings.basic`,
  ],
};

const readOnlyScopes: Readonly<Record<GoogleService, readonly string[]>> = {
  calendar: [`${auth}calendar.readonly`],
  drive: [`${auth}drive.readonly`],
  contacts: [`${auth}contacts.readonly`],
  tasks: [`${auth}tasks.readonly`],
  gmail: [`${auth}gmail.readonly`],
};

/** Google treats a broad scope as each narrower scope that it lists. */
const coveredScopes: Readonly<Record<string, readonly string[]>> = {
  [`${auth}gmail.modify`]: [
    `${auth}gmail.readonly`,
    `${auth}gmail.send`,
    `${auth}gmail.compose`,
    `${auth}gmail.labels`,
  ],
  [`${auth}drive`]: [`${auth}drive.readonly`, `${auth}drive.file`],
  [`${auth}calendar`]: [`${auth}calendar.readonly`, `${auth}calendar.events`],
  [`${auth}tasks`]: [`${auth}tasks.readonly`],
  [`${auth}contacts`]: [`${auth}contacts.readonly`],
};

export function googleScopes(google: Pick<EvaConfig["google"], "services" | "readOnly">): string[] {
  const map = google.readOnly ? readOnlyScopes : fullScopes;
  return [...new Set([...baseScopes, ...google.services.flatMap((service) => map[service])])];
}

/** True when the granted scopes hold every needed scope. */
export function coversScopes(granted: readonly string[], needed: readonly string[]): boolean {
  const expanded = new Set(granted.flatMap((scope) => [scope, ...(coveredScopes[scope] ?? [])]));
  return needed.every((scope) => expanded.has(scope));
}
