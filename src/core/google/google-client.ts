/**
 * The person's own Google OAuth client, as they paste it. A phone can copy the client id as a
 * link, with `https://` before it and `/` after it, and Google then refuses the login with
 * "invalid_client" on its own page, where Eva never sees it (#323). So Eva cleans the value when it
 * is saved, and refuses one that is still not a client id.
 */
import { googleStep } from "./google-steps.ts";

const clientIdForm = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

/** Removes spaces, quotes, a scheme and slashes around a pasted client id. */
export function cleanGoogleClientId(raw: string): string {
  return withoutQuotes(raw)
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .trim();
}

/** Removes spaces and quotes around a pasted client secret. */
export function cleanGoogleClientSecret(raw: string): string {
  return withoutQuotes(raw);
}

/** What is wrong with a client id, or null. */
export function googleClientIdProblem(clientId: string): string | null {
  if (clientIdForm.test(clientId)) return null;
  return `This is not a Google client id. A client id looks like 123456789012-abc123.apps.googleusercontent.com. Copy it again from the OAuth client (step ${String(googleStep.client)}).`;
}

function withoutQuotes(raw: string): string {
  return raw
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
}
