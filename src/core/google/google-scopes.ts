/**
 * The Google scopes that `workspace-mcp` asks for, copied from its `auth/permissions.py`. Eva runs the
 * login herself, so the server accepts her login only when it holds these scopes. Change this
 * list together with `workspaceMcpVersion`.
 */
import type { EvaConfig } from "../settings/home.ts";

type GoogleService = EvaConfig["google"]["services"][number];
type GoogleAccess = EvaConfig["google"]["access"];

const auth = "https://www.googleapis.com/auth/";

const baseScopes = [`${auth}userinfo.email`, `${auth}userinfo.profile`, "openid"];

/** The scopes that each level adds to the levels below it. */
const levelScopes: { readonly [S in GoogleService]: Readonly<Record<GoogleAccess[S], readonly string[]>> } = {
  calendar: {
    readonly: [`${auth}calendar.readonly`],
    full: [`${auth}calendar`, `${auth}calendar.events`],
  },
  drive: {
    readonly: [`${auth}drive.readonly`],
    full: [`${auth}drive`, `${auth}drive.file`],
  },
  contacts: {
    readonly: [`${auth}contacts.readonly`],
    full: [`${auth}contacts`],
  },
  tasks: {
    readonly: [`${auth}tasks.readonly`],
    manage: [`${auth}tasks`],
    full: [],
  },
  gmail: {
    readonly: [`${auth}gmail.readonly`],
    organize: [`${auth}gmail.labels`, `${auth}gmail.modify`],
    drafts: [`${auth}gmail.compose`],
    send: [`${auth}gmail.send`],
    full: [`${auth}gmail.settings.basic`],
  },
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

export function googleScopes(google: Pick<EvaConfig["google"], "services" | "access">): string[] {
  return [...new Set([...baseScopes, ...google.services.flatMap((service) => serviceScopes(service, google.access))])];
}

/** The scopes of a service's level and of each level below it. */
function serviceScopes(service: GoogleService, access: GoogleAccess): string[] {
  const levels: Readonly<Record<string, readonly string[]>> = levelScopes[service];
  const scopes: string[] = [];
  for (const [level, added] of Object.entries(levels)) {
    scopes.push(...added);
    if (level === access[service]) break;
  }
  return scopes;
}

/**
 * The granted scopes of the services that are on, above their chosen levels. A scope that Eva does
 * not know, such as a short name for a base scope, never counts: it would fail every new login too.
 * A service that is off does not count either, so a login from before an update stays good.
 */
export function extraScopes(
  granted: readonly string[],
  google: Pick<EvaConfig["google"], "services" | "access">,
): string[] {
  const needed = new Set(googleScopes(google));
  const known = new Set(
    google.services.flatMap((service) => {
      const levels: Readonly<Record<string, readonly string[]>> = levelScopes[service];
      return Object.values(levels).flat();
    }),
  );
  return granted.filter((scope) => known.has(scope) && !needed.has(scope));
}

/** True when the granted scopes hold every needed scope. */
export function coversScopes(granted: readonly string[], needed: readonly string[]): boolean {
  const expanded = new Set(granted.flatMap((scope) => [scope, ...(coveredScopes[scope] ?? [])]));
  return needed.every((scope) => expanded.has(scope));
}
