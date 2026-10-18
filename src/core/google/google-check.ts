/**
 * The Google check, for the Test button and `eva doctor`. It checks the saved parts first, with no
 * network call, then gets a fresh access token, then reads each enabled service once. Each
 * failure names the step of the setup guide that fixes it.
 */
import { isEvaError } from "../../shared/errors.ts";
import type { EvaConfig } from "../settings/home.ts";
import { googleUrls, postToken, readGoogleCredential, type GoogleClient, type GoogleUrls } from "./google-login.ts";
import { coversScopes, googleScopes } from "./google-scopes.ts";
import { googleStep } from "./google-steps.ts";

type GoogleService = EvaConfig["google"]["services"][number];

export interface GoogleCheckInputs {
  readonly config: EvaConfig["google"];
  /** Null when `secrets.json` holds no OAuth client. */
  readonly client: GoogleClient | null;
  readonly credentialsFolder: string;
  /** Google's address; a test points it at a fake server. */
  readonly baseUrl?: string;
  /** False proves the login alone, with one call: `eva doctor` stays quick. */
  readonly readServices: boolean;
}

export interface GoogleCheckResult {
  readonly ok: boolean;
  readonly detail: string;
}

const serviceLabels: Readonly<Record<GoogleService, string>> = {
  calendar: "Calendar",
  drive: "Drive",
  contacts: "Contacts",
  tasks: "Tasks",
  gmail: "Gmail",
};

/** The API names in Google Cloud's library, for the "turn on" step. */
const apiNames: Readonly<Record<GoogleService, string>> = {
  calendar: "Google Calendar API",
  drive: "Google Drive API",
  contacts: "People API",
  tasks: "Google Tasks API",
  gmail: "Gmail API",
};

/** One cheap read for each service. */
function serviceAddress(service: GoogleService, urls: GoogleUrls): string {
  switch (service) {
    case "calendar":
      return `${urls.api}/calendar/v3/calendars/primary/events?maxResults=1`;
    case "drive":
      return `${urls.api}/drive/v3/files?pageSize=1`;
    case "contacts":
      return `${urls.people}/v1/people/me/connections?pageSize=1&personFields=names`;
    case "tasks":
      return `${urls.api}/tasks/v1/users/@me/lists?maxResults=1`;
    case "gmail":
      return `${urls.api}/gmail/v1/users/me/labels`;
  }
}

const requestTimeoutMs = 30_000;

export async function checkGoogle(inputs: GoogleCheckInputs): Promise<GoogleCheckResult> {
  const { config, client } = inputs;
  if (config.services.length === 0) return failed("No Google service is on. Set google.services on the machine.");
  if (client === null)
    return failed(`No OAuth client is saved. Paste its client id and secret (step ${String(googleStep.client)}).`);
  if (config.email === null)
    return failed(`No Google account is logged in. Log in to Google (step ${String(googleStep.login)}).`);
  const credential = readGoogleCredential(inputs.credentialsFolder, config.email);
  if (credential === null)
    return failed(
      `No Google login for ${config.email} on this machine. Log in to Google (step ${String(googleStep.login)}).`,
    );
  if (credential.client_id !== client.clientId)
    return failed(
      `The login belongs to another OAuth client. Log in to Google again (step ${String(googleStep.login)}).`,
    );
  // The refresh uses the secret in the login file, as `workspace-mcp` does, so a new secret needs a new login.
  if (credential.client_secret !== client.clientSecret)
    return failed(`The login uses an older client secret. Log in to Google again (step ${String(googleStep.login)}).`);
  if (!coversScopes(credential.scopes, googleScopes(config)))
    return failed(
      `The login gives less access than Eva needs now. This happens after a change of access or of the services. Log in to Google again (step ${String(googleStep.login)}).`,
    );

  const urls = googleUrls(inputs.baseUrl);
  let accessToken: string;
  try {
    const answer = await postToken(urls.token, "refresh", {
      grant_type: "refresh_token",
      refresh_token: credential.refresh_token,
      client_id: credential.client_id,
      client_secret: credential.client_secret,
    });
    if (typeof answer.access_token !== "string")
      return failed(`Google sent no access token. Log in again (step ${String(googleStep.login)}).`);
    accessToken = answer.access_token;
  } catch (error) {
    if (isEvaError(error, "google_failed")) return failed(error.message);
    throw error;
  }
  if (!inputs.readServices) return { ok: true, detail: `The Google login of ${config.email} works.` };

  // At once, so that the Test takes one request time, not one for each service.
  const problems = await Promise.all(config.services.map((service) => readService(service, urls, accessToken)));
  const problem = problems.find((found) => found !== null);
  if (problem !== undefined) return failed(problem);
  const labels = config.services.map((service) => serviceLabels[service]);
  return { ok: true, detail: `Eva can read ${listText(labels)} of ${config.email}.` };
}

/** Null when the read works, or the step that fixes it. */
async function readService(service: GoogleService, urls: GoogleUrls, accessToken: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(serviceAddress(service, urls), {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch {
    return "Eva could not reach Google. Check the machine's internet connection.";
  }
  if (response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (isServiceDisabled(body)) return `Turn on the ${apiNames[service]} (step ${String(googleStep.apis)}).`;
  if (response.status === 401 || response.status === 403)
    return `Google refused to show ${serviceLabels[service]}. Log in to Google again (step ${String(googleStep.login)}).`;
  return `Google answered ${String(response.status)} for ${serviceLabels[service]}. Try again later.`;
}

/** Google names a turned-off API with a reason code in the error details. */
function isServiceDisabled(body: unknown): boolean {
  const error = (body as { error?: { details?: unknown; errors?: unknown } } | null)?.error;
  const reasons = [error?.details, error?.errors]
    .flatMap((list) => (Array.isArray(list) ? (list as unknown[]) : []))
    .map((entry) => (entry as { reason?: unknown } | null)?.reason);
  return reasons.includes("SERVICE_DISABLED") || reasons.includes("accessNotConfigured");
}

function listText(items: readonly string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

function failed(detail: string): GoogleCheckResult {
  return { ok: false, detail };
}
