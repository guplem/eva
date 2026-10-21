import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDriveFolder, type GoogleDriveInputs } from "../../../../src/core/google/google-drive.ts";
import { googleScopes } from "../../../../src/core/google/google-scopes.ts";
import { defaultConfig } from "../../../../src/core/settings/home.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { fakeGoogle, type FakeGoogle } from "../../../support/fake-google.ts";

const client = { clientId: "client-id.apps.googleusercontent.com", clientSecret: "GOCSPX-client-secret-value" };
const driveFull = {
  ...defaultConfig.google,
  email: "person@example.com",
  access: { ...defaultConfig.google.access, drive: "full" as const },
};

let folder: string;
let google: FakeGoogle;
let inputs: GoogleDriveInputs;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-google-drive-"));
  google = fakeGoogle();
  inputs = { config: driveFull, client, credentialsFolder: folder, baseUrl: google.url };
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "person@example.com.json"),
    JSON.stringify({
      token: null,
      refresh_token: "the-refresh-token",
      token_uri: "https://oauth2.googleapis.com/token",
      client_id: client.clientId,
      client_secret: client.clientSecret,
      scopes: googleScopes(driveFull),
      expiry: null,
    }),
  );
});
afterEach(() => {
  google.stop();
  rmSync(folder, { recursive: true, force: true });
});

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isEvaError(error, "google_failed")) return error.message;
    throw error;
  }
  throw new Error("The call did not fail.");
}

describe("createDriveFolder", () => {
  test("creates a folder in Drive and gives its link", async () => {
    const link = await createDriveFolder(inputs, "Example app");

    expect(link).toBe("https://drive.google.com/drive/folders/folder-1");
    expect(google.driveFolders).toEqual(["Example app"]);
  });

  test("Drive with read-only access fails before any call to Google", async () => {
    const message = await failure(
      createDriveFolder({ ...inputs, config: { ...driveFull, access: defaultConfig.google.access } }, "Example app"),
    );

    expect(message).toContain("full access");
    expect(google.tokenRequests).toHaveLength(0);
  });

  test("Drive turned off fails before any call to Google", async () => {
    const message = await failure(
      createDriveFolder({ ...inputs, config: { ...driveFull, services: ["calendar"] } }, "Example app"),
    );

    expect(message).toContain("Turn on Google Drive");
    expect(google.tokenRequests).toHaveLength(0);
  });

  test("a missing login names its step", async () => {
    const message = await failure(createDriveFolder({ ...inputs, client: null }, "Example app"));

    expect(message).toContain("step 3");
  });

  test("a refusal from Google says so", async () => {
    google.apiStatus = 403;

    const message = await failure(createDriveFolder(inputs, "Example app"));

    expect(message).toContain("403");
  });
});
