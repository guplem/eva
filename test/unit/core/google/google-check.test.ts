import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkGoogle, type GoogleCheckInputs } from "../../../../src/core/google/google-check.ts";
import { googleScopes } from "../../../../src/core/google/google-scopes.ts";
import { defaultConfig } from "../../../../src/core/settings/home.ts";
import { fakeGoogle, type FakeGoogle } from "../../../support/fake-google.ts";

const client = {
  clientId: "123456789012-clientid.apps.googleusercontent.com",
  clientSecret: "GOCSPX-client-secret-value",
};

let folder: string;
let google: FakeGoogle;
let inputs: GoogleCheckInputs;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-google-check-"));
  google = fakeGoogle();
  inputs = {
    config: { ...defaultConfig.google, email: "person@example.com" },
    client,
    credentialsFolder: folder,
    baseUrl: google.url,
    readServices: true,
  };
  saveLogin(googleScopes(defaultConfig.google));
});
afterEach(() => {
  google.stop();
  rmSync(folder, { recursive: true, force: true });
});

function saveLogin(scopes: readonly string[], clientId = client.clientId): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "person@example.com.json"),
    JSON.stringify({
      token: null,
      refresh_token: "the-refresh-token",
      token_uri: "https://oauth2.googleapis.com/token",
      client_id: clientId,
      client_secret: client.clientSecret,
      scopes,
      expiry: null,
    }),
  );
}

describe("checkGoogle", () => {
  test("refreshes the login, then reads each service once", async () => {
    const result = await checkGoogle(inputs);
    expect(result).toEqual({
      ok: true,
      detail: "Eva can read Calendar, Drive, Contacts and Tasks of person@example.com.",
    });
    expect(google.tokenRequests[0]?.get("grant_type")).toBe("refresh_token");
    expect(google.tokenRequests[0]?.get("refresh_token")).toBe("the-refresh-token");
    expect(google.apiRequests.toSorted()).toEqual([
      "/calendar/v3/calendars/primary/events",
      "/drive/v3/files",
      "/tasks/v1/users/@me/lists",
      "/v1/people/me/connections",
    ]);
  });

  test("without the service reads, it proves the login alone", async () => {
    const result = await checkGoogle({ ...inputs, readServices: false });
    expect(result).toEqual({ ok: true, detail: "The Google login of person@example.com works." });
    expect(google.apiRequests).toEqual([]);
  });

  test("a saved client id that is no client id says so, before any call to Google (#323)", async () => {
    const pasted = { ...client, clientId: `https://${client.clientId}/` };
    const result = await checkGoogle({ ...inputs, client: pasted });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("not a Google client id");
    expect(google.tokenRequests).toEqual([]);
  });

  test("each missing part names its step, before any call to Google", async () => {
    expect((await checkGoogle({ ...inputs, client: null })).detail).toContain("step 3");
    expect((await checkGoogle({ ...inputs, config: { ...inputs.config, email: null } })).detail).toContain("step 4");
    expect(
      (await checkGoogle({ ...inputs, config: { ...inputs.config, email: "other@example.com" } })).detail,
    ).toContain("No Google login for other@example.com on this machine");
    saveLogin(googleScopes(defaultConfig.google), "old-client");
    expect((await checkGoogle(inputs)).detail).toContain("another OAuth client");
    expect((await checkGoogle({ ...inputs, config: { ...inputs.config, services: [] } })).detail).toContain(
      "No Google service is on",
    );
    saveLogin(googleScopes(defaultConfig.google));
    expect(
      (await checkGoogle({ ...inputs, client: { ...client, clientSecret: "GOCSPX-new-secret-value" } })).detail,
    ).toContain("older client secret");
    const writes = {
      ...inputs,
      config: { ...inputs.config, access: { ...inputs.config.access, calendar: "full" as const } },
    };
    expect((await checkGoogle(writes)).detail).toContain("Log in to Google again");
    expect(google.tokenRequests).toEqual([]);
  });

  test("a login with more access than the person chose asks for a new login", async () => {
    const everything = { calendar: "full", drive: "full", contacts: "full", tasks: "full", gmail: "full" } as const;
    saveLogin(googleScopes({ ...defaultConfig.google, access: everything }));
    // A shell can use the login file directly, so a lower access needs a new login.
    expect((await checkGoogle(inputs)).detail).toContain("more access than you chose");
    expect(google.tokenRequests).toEqual([]);
  });

  test("a service that is off does not count, so a login from before the update stays good", async () => {
    saveLogin(googleScopes({ ...defaultConfig.google, services: [...defaultConfig.google.services, "gmail"] }));
    expect((await checkGoogle(inputs)).ok).toBe(true);
  });

  test("a scope that gives no service access, such as a short name of a base scope, never fails the check", async () => {
    saveLogin([...googleScopes(defaultConfig.google), "email", "profile"]);
    expect((await checkGoogle(inputs)).ok).toBe(true);
  });

  test("an API that is off names the API to turn on", async () => {
    google.disabled.add("drive");
    expect(await checkGoogle(inputs)).toEqual({ ok: false, detail: "Turn on the Google Drive API (step 1)." });
  });

  test("an expired login names the consent screen", async () => {
    google.tokenError = "invalid_grant";
    const result = await checkGoogle(inputs);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("In production");
  });
});

describe("checkGoogle when Google refuses a read", () => {
  test("a refused read asks for a new login", async () => {
    google.apiStatus = 401;
    expect((await checkGoogle(inputs)).detail).toBe(
      "Google refused to show Calendar. Log in to Google again (step 4).",
    );
  });

  test("another status says to try later", async () => {
    google.apiStatus = 500;
    expect((await checkGoogle(inputs)).detail).toBe("Google answered 500 for Calendar. Try again later.");
  });

  test("no connection names the machine's internet connection", async () => {
    google.stop();
    expect((await checkGoogle(inputs)).detail).toContain("Eva could not reach Google");
  });
});
