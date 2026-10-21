import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  credentialFileName,
  GoogleLogin,
  googleRedirectUri,
  readGoogleCredential,
} from "../../../../src/core/google/google-login.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { fakeGoogle, type FakeGoogle } from "../../../support/fake-google.ts";

const client = { clientId: "client-id.apps.googleusercontent.com", clientSecret: "GOCSPX-client-secret-value" };
const scopes = ["openid", "https://www.googleapis.com/auth/calendar.readonly"];

let folder: string;
let google: FakeGoogle;
let now: Date;
let login: GoogleLogin;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-google-login-"));
  google = fakeGoogle();
  now = new Date("2026-10-18T10:00:00Z");
  login = new GoogleLogin({ credentialsFolder: join(folder, "google"), now: () => now, baseUrl: google.url });
});
afterEach(() => {
  google.stop();
  rmSync(folder, { recursive: true, force: true });
});

/** The address that Google sends the browser to after the person allows the access. */
function returnAddress(url: string, code = "the-code"): string {
  const state = new URL(url).searchParams.get("state") ?? "";
  return `${googleRedirectUri}?state=${state}&code=${code}&scope=openid`;
}

describe("GoogleLogin.forget", () => {
  test("deletes the saved login, and a missing one is fine", async () => {
    const { url } = login.start(client.clientId, scopes);
    await login.finish(returnAddress(url), client);
    login.forget("person@example.com");
    expect(readGoogleCredential(join(folder, "google"), "person@example.com")).toBeNull();
    expect(() => login.forget("person@example.com")).not.toThrow();
  });

  test("a login that Eva cannot delete gives a google_failed error", () => {
    // A folder in the place of the file stands for a file that another program holds open.
    mkdirSync(join(folder, "google", credentialFileName("person@example.com"), "inside"), { recursive: true });
    let caught: unknown;
    try {
      login.forget("person@example.com");
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught) && caught.code === "google_failed").toBe(true);
  });
});

describe("GoogleLogin", () => {
  test("the consent address asks for offline access with PKCE, for a loopback address", () => {
    const { url } = login.start(client.clientId, scopes);
    const query = new URL(url).searchParams;
    expect(url.startsWith(`${google.url}/o/oauth2/v2/auth?`)).toBe(true);
    expect(query.get("client_id")).toBe(client.clientId);
    expect(query.get("redirect_uri")).toBe(googleRedirectUri);
    expect(query.get("scope")).toBe(scopes.join(" "));
    expect(query.get("access_type")).toBe("offline");
    expect(query.get("prompt")).toBe("consent");
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.get("state")?.length).toBeGreaterThan(20);
  });

  test("the pasted address gives a credential file that workspace-mcp reads", async () => {
    const { url } = login.start(client.clientId, scopes);
    expect(await login.finish(returnAddress(url), client)).toEqual({ email: "person@example.com" });

    const exchange = google.tokenRequests[0];
    expect(exchange?.get("grant_type")).toBe("authorization_code");
    expect(exchange?.get("code")).toBe("the-code");
    expect(exchange?.get("redirect_uri")).toBe(googleRedirectUri);
    expect(exchange?.get("code_verifier")?.length).toBeGreaterThan(42);
    const file = JSON.parse(readFileSync(join(folder, "google", "person@example.com.json"), "utf-8")) as Record<
      string,
      unknown
    >;
    expect(file).toEqual({
      token: null,
      refresh_token: "the-refresh-token",
      token_uri: "https://oauth2.googleapis.com/token",
      client_id: client.clientId,
      client_secret: client.clientSecret,
      scopes: ["openid", "https://www.googleapis.com/auth/calendar.readonly"],
      expiry: null,
    });
    expect(readGoogleCredential(join(folder, "google"), "person@example.com")?.refresh_token).toBe("the-refresh-token");
  });

  test("a bare code works too, and a login is used once", async () => {
    login.start(client.clientId, scopes);
    await login.finish("  the-code  ", client);
    expect(google.tokenRequests[0]?.get("code")).toBe("the-code");
    expect(await failureOf(login.finish("the-code", client))).toContain("Start the Google login");
  });

  test("a code copied from the address bar is decoded", async () => {
    login.start(client.clientId, scopes);
    await login.finish("4%2F0Abc", client);
    expect(google.tokenRequests[0]?.get("code")).toBe("4/0Abc");
  });

  test("a failed exchange keeps the login, so Finish works again after a fix", async () => {
    const { url } = login.start(client.clientId, scopes);
    google.tokenError = "invalid_client";
    await failureOf(login.finish(returnAddress(url), client));
    google.tokenError = null;
    expect(await login.finish(returnAddress(url), client)).toEqual({ email: "person@example.com" });
  });

  test("a code that Google refuses asks for a new login, not for the consent screen", async () => {
    google.tokenError = "invalid_grant";
    const { url } = login.start(client.clientId, scopes);
    const message = await failureOf(login.finish(returnAddress(url), client));
    expect(message).toContain("Start the Google login again");
    expect(message).not.toContain("7 days");
  });

  test("a login without every box ticked is refused, and saves nothing", async () => {
    google.grantedScope = "openid";
    const { url } = login.start(client.clientId, scopes);
    expect(await failureOf(login.finish(returnAddress(url), client))).toContain("Allow every box");
    expect(readGoogleCredential(join(folder, "google"), "person@example.com")).toBeNull();
  });

  test("a login that Eva cannot save asks for a new login: Google used the code", async () => {
    writeFileSync(join(folder, "blocked"), "a file, not a folder");
    const blocked = new GoogleLogin({
      credentialsFolder: join(folder, "blocked", "google"),
      now: () => now,
      baseUrl: google.url,
    });
    const { url } = blocked.start(client.clientId, scopes);
    expect(await failureOf(blocked.finish(returnAddress(url), client))).toContain("Start the Google login again");
  });

  test("an answer that is not JSON says that Google has a problem", async () => {
    google.tokenOutage = 503;
    const { url } = login.start(client.clientId, scopes);
    expect(await failureOf(login.finish(returnAddress(url), client))).toContain("Google answered 503");
  });

  test("an address of another login, a refusal and a late paste each say what to do", async () => {
    login.start(client.clientId, scopes);
    expect(await failureOf(login.finish(`${googleRedirectUri}?state=other&code=x`, client))).toContain("older login");
    expect(await failureOf(login.finish(`${googleRedirectUri}?error=access_denied`, client))).toContain("Allow");
    const { url } = login.start(client.clientId, scopes);
    now = new Date(now.getTime() + 31 * 60_000);
    expect(await failureOf(login.finish(returnAddress(url), client))).toContain("Start the Google login");
  });

  test("Google's refusal names the step to fix, with the google_failed code", async () => {
    google.tokenError = "invalid_client";
    const { url } = login.start(client.clientId, scopes);
    const failure = await login.finish(returnAddress(url), client).catch((error: unknown) => error);
    expect(isEvaError(failure, "google_failed")).toBe(true);
    expect(String(failure)).toContain("client id or secret");

    google.tokenError = "redirect_uri_mismatch";
    const second = login.start(client.clientId, scopes);
    expect(await failureOf(login.finish(returnAddress(second.url), client))).toContain("Desktop app");
  });
});

describe("credentialFileName", () => {
  test("encodes the email as workspace-mcp does", () => {
    expect(credentialFileName("person@example.com")).toBe("person@example.com.json");
    expect(credentialFileName("first+last@example.com")).toBe("first%2Blast@example.com.json");
    expect(credentialFileName("odd'name~x@example.com")).toBe("odd%27name~x@example.com.json");
  });
});

/** The message of a promise that must fail. */
async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("The promise did not fail.");
}
