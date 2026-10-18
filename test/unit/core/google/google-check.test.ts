import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkGoogle, type GoogleCheckInputs } from "../../../../src/core/google/google-check.ts";
import { googleScopes } from "../../../../src/core/google/google-scopes.ts";
import { defaultConfig } from "../../../../src/core/settings/home.ts";
import { fakeGoogle, type FakeGoogle } from "../../../support/fake-google.ts";

const client = { clientId: "client-id.apps.googleusercontent.com", clientSecret: "GOCSPX-client-secret-value" };

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
    expect(google.apiRequests).toEqual([
      "/calendar/v3/calendars/primary/events",
      "/drive/v3/files",
      "/v1/people/me/connections",
      "/tasks/v1/users/@me/lists",
    ]);
  });

  test("without the service reads, it proves the login alone", async () => {
    const result = await checkGoogle({ ...inputs, readServices: false });
    expect(result).toEqual({ ok: true, detail: "The Google login of person@example.com works." });
    expect(google.apiRequests).toEqual([]);
  });

  test("each missing part names its step, before any call to Google", async () => {
    expect((await checkGoogle({ ...inputs, client: null })).detail).toContain("step 3");
    expect((await checkGoogle({ ...inputs, config: { ...inputs.config, email: null } })).detail).toContain("step 4");
    expect(
      (await checkGoogle({ ...inputs, config: { ...inputs.config, email: "other@example.com" } })).detail,
    ).toContain("No Google login for other@example.com on this machine");
    saveLogin(googleScopes(defaultConfig.google), "old-client");
    expect((await checkGoogle(inputs)).detail).toContain("another OAuth client");
    saveLogin(googleScopes(defaultConfig.google));
    const writes = { ...inputs, config: { ...inputs.config, readOnly: false } };
    expect((await checkGoogle(writes)).detail).toContain("Log in to Google again");
    expect(google.tokenRequests).toEqual([]);
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
