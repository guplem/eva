/**
 * The Google login, run by Eva so that a phone can finish it. `workspace-mcp` sends Google back to
 * a local address on the machine, which a phone cannot open. Here Google sends the browser to a
 * loopback address that does not load. The person pastes that address into the web app, and
 * Eva trades its code for a login. PKCE (a one-time proof key) makes a stolen code useless.
 * Eva writes the login where `workspace-mcp` reads it, in its own file format.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { HomePaths } from "../settings/home.ts";

/** A "Desktop app" client accepts any loopback address. Nothing listens here: the person copies it. */
export const googleRedirectUri = "http://127.0.0.1/eva-google-login";

/** Where Eva and `workspace-mcp` keep the Google login of an instance. */
export function googleCredentialsFolder(paths: HomePaths): string {
  return join(paths.enginesFolder, "google");
}

/** Google's addresses. A test points them all at one fake server. */
export interface GoogleUrls {
  readonly consent: string;
  readonly token: string;
  /** Calendar, Drive, Tasks and Gmail. */
  readonly api: string;
  /** Contacts. */
  readonly people: string;
}

export function googleUrls(baseUrl?: string): GoogleUrls {
  if (baseUrl !== undefined)
    return { consent: `${baseUrl}/o/oauth2/v2/auth`, token: `${baseUrl}/token`, api: baseUrl, people: baseUrl };
  return {
    consent: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    api: "https://www.googleapis.com",
    people: "https://people.googleapis.com",
  };
}

export interface GoogleClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** The login file of `workspace-mcp` 2.1.0 (`auth/credential_store.py`). Change it with `workspaceMcpVersion`. */
export interface GoogleCredential {
  /** Null: `workspace-mcp` gets a fresh access token at its first call. */
  readonly token: string | null;
  readonly refresh_token: string;
  readonly token_uri: string;
  readonly client_id: string;
  readonly client_secret: string;
  readonly scopes: readonly string[];
  readonly expiry: string | null;
}

export interface GoogleLoginOptions {
  /** `<home>/engines/google`, the `WORKSPACE_MCP_CREDENTIALS_DIR` of the server. */
  readonly credentialsFolder: string;
  readonly now: () => Date;
  /** Google's address; a test points it at a fake server. */
  readonly baseUrl?: string;
}

interface PendingLogin {
  readonly state: string;
  readonly verifier: string;
  readonly expiresAtMs: number;
}

/** Time to make the client, allow the access and paste the address. */
const pendingLifetimeMs = 30 * 60_000;
const requestTimeoutMs = 30_000;

export class GoogleLogin {
  private readonly options: GoogleLoginOptions;
  private readonly urls: GoogleUrls;
  /** One person, so one login at a time: a new start replaces it. */
  private pending: PendingLogin | null;

  constructor(options: GoogleLoginOptions) {
    this.options = options;
    this.urls = googleUrls(options.baseUrl);
    this.pending = null;
  }

  /** The address of Google's consent page. */
  start(clientId: string, scopes: readonly string[]): { url: string } {
    const verifier = randomBytes(48).toString("base64url");
    const state = randomBytes(24).toString("base64url");
    this.pending = { state, verifier, expiresAtMs: this.options.now().getTime() + pendingLifetimeMs };
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: googleRedirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      // Without both, a second login gets no refresh token.
      access_type: "offline",
      prompt: "consent",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state,
    });
    return { url: `${this.urls.consent}?${query.toString()}` };
  }

  /**
   * Trades the pasted address, or its code alone, for a login, and saves it. A wrong `state`
   * means an address that someone else sent: it would log Eva in to their account.
   */
  async finish(pasted: string, client: GoogleClient): Promise<{ email: string }> {
    const answer = parsePasted(pasted);
    if (answer.error !== null) {
      throw new EvaError(
        "google_failed",
        answer.error === "access_denied"
          ? "Google did not get your permission. Start the Google login again, and press Allow."
          : `Google refused the login (${answer.error}). Start the Google login again.`,
      );
    }
    const pending = this.pending;
    if (pending === null || pending.expiresAtMs <= this.options.now().getTime())
      throw new EvaError("google_failed", "No Google login is waiting. Start the Google login again.");
    if (answer.state !== null && !sameText(answer.state, pending.state))
      throw new EvaError("google_failed", "This address is from an older login. Use the address of the last login.");
    if (answer.code === null)
      throw new EvaError("google_failed", "The pasted text holds no code. Paste the whole address.");
    this.pending = null;

    const body = await postToken(this.urls.token, {
      grant_type: "authorization_code",
      code: answer.code,
      redirect_uri: googleRedirectUri,
      code_verifier: pending.verifier,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    if (typeof body.refresh_token !== "string")
      throw new EvaError("google_failed", "Google sent no lasting login. Start the Google login again.");
    const email = idTokenEmail(body.id_token);
    if (email === null) throw new EvaError("google_failed", "Google did not say which account logged in.");
    const credential: GoogleCredential = {
      token: null,
      refresh_token: body.refresh_token,
      token_uri: "https://oauth2.googleapis.com/token",
      client_id: client.clientId,
      client_secret: client.clientSecret,
      // The scopes that the person allowed: Google lets them untick some.
      scopes: typeof body.scope === "string" ? body.scope.split(" ").filter((scope) => scope !== "") : [],
      expiry: null,
    };
    mkdirSync(this.options.credentialsFolder, { recursive: true, mode: 0o700 });
    // mkdirSync keeps the mode of a folder that exists, and `workspace-mcp` may have made it first.
    chmodSync(this.options.credentialsFolder, 0o700);
    writeFileAtomic(
      join(this.options.credentialsFolder, credentialFileName(email)),
      JSON.stringify(credential, null, 2) + "\n",
    );
    return { email };
  }
}

/** The answer of a token request. */
export interface TokenAnswer {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly id_token?: unknown;
  readonly scope?: unknown;
}

/** Posts to Google's token endpoint. Each OAuth error names the step to fix. */
export async function postToken(url: string, form: Readonly<Record<string, string>>): Promise<TokenAnswer> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch {
    throw new EvaError("google_failed", "Eva could not reach Google. Check the machine's internet connection.");
  }
  const body = (await response.json().catch(() => ({}))) as TokenAnswer & { error?: unknown };
  if (response.ok) return body;
  throw new EvaError("google_failed", tokenErrorText(typeof body.error === "string" ? body.error : "unknown"));
}

function tokenErrorText(error: string): string {
  switch (error) {
    case "invalid_client":
    case "unauthorized_client":
      return "Google refused the client id or secret. Copy both again from the OAuth client (step 3).";
    case "redirect_uri_mismatch":
      return 'Google refused the login address. The OAuth client must be of type "Desktop app" (step 3).';
    case "invalid_grant":
      return "Google refused the login: it expired or was taken back. With the consent screen in Testing, a login ends after 7 days: set it to In production (step 2), then log in again.";
    default:
      return `Google refused the login (${error}). Log in again.`;
  }
}

/** The login file name of `workspace-mcp`: Python's `quote(email, safe="@._-")` plus `.json`. */
export function credentialFileName(email: string): string {
  const quoted = [...Buffer.from(email, "utf-8")]
    .map((byte) => {
      const character = String.fromCharCode(byte);
      return /[A-Za-z0-9@._~-]/.test(character) ? character : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
  return `${quoted}.json`;
}

/** The saved login of an account, or null when it is missing or broken. */
export function readGoogleCredential(folder: string, email: string): GoogleCredential | null {
  const read = readJsonTolerant(join(folder, credentialFileName(email)));
  if (!read.ok || typeof read.value !== "object" || read.value === null) return null;
  const value = read.value as Partial<GoogleCredential>;
  return typeof value.refresh_token === "string" &&
    typeof value.client_id === "string" &&
    typeof value.client_secret === "string" &&
    Array.isArray(value.scopes)
    ? (value as GoogleCredential)
    : null;
}

interface PastedAnswer {
  readonly code: string | null;
  readonly state: string | null;
  readonly error: string | null;
}

/** The whole address, its query, or the code alone. */
function parsePasted(pasted: string): PastedAnswer {
  const text = pasted.trim();
  if (!text.includes("=")) return { code: text === "" ? null : text, state: null, error: null };
  const query = new URLSearchParams(text.includes("?") ? text.slice(text.indexOf("?") + 1) : text);
  return { code: query.get("code"), state: query.get("state"), error: query.get("error") };
}

/** The email of an ID token. It came straight from Google over HTTPS, so its signature needs no check. */
function idTokenEmail(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf-8")) as {
      email?: unknown;
    };
    return typeof payload.email === "string" && payload.email !== "" ? payload.email : null;
  } catch {
    return null;
  }
}

function sameText(first: string, second: string): boolean {
  const a = Buffer.from(first);
  const b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
}
