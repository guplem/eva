import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commitIdentity,
  loadGitHubAccount,
  refreshGitHubAccount,
  saveGitHubAccount,
} from "../../../../src/core/instance/commit-identity.ts";
import { defaultConfig, homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";

let home: string;
let paths: HomePaths;
let server: ReturnType<typeof Bun.serve> | null = null;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eva-identity-"));
  paths = homePaths(home);
});
afterEach(async () => {
  await server?.stop(true);
  server = null;
  rmSync(home, { recursive: true, force: true });
});

const account = { id: 1234, login: "example-user", name: "Example User" };

/** A fake GitHub API that answers `GET /user` with `body`. */
function fakeApi(status: number, body: unknown): string {
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json(body, { status }) });
  return `http://127.0.0.1:${String(server.port)}`;
}

describe("the GitHub account record", () => {
  test("a saved account reads back, and a null removes it", () => {
    saveGitHubAccount(paths, account);
    expect(loadGitHubAccount(paths)).toEqual(account);
    saveGitHubAccount(paths, null);
    expect(existsSync(paths.githubAccount)).toBe(false);
    expect(loadGitHubAccount(paths)).toBeNull();
  });

  test("a broken record reads as no account", () => {
    mkdirSync(paths.stateFolder, { recursive: true });
    writeFileSync(paths.githubAccount, "{ not json");
    expect(loadGitHubAccount(paths)).toBeNull();
    writeFileSync(paths.githubAccount, JSON.stringify({ login: "example-user" }));
    expect(loadGitHubAccount(paths)).toBeNull();
  });
});

describe("commitIdentity", () => {
  test("the GitHub account gives the name and GitHub's private email", () => {
    saveGitHubAccount(paths, account);
    expect(commitIdentity(paths, defaultConfig)).toEqual({
      name: "Example User",
      email: "1234+example-user@users.noreply.github.com",
    });
  });

  test("an account with no name gives its login as the name", () => {
    saveGitHubAccount(paths, { ...account, name: null });
    expect(commitIdentity(paths, defaultConfig).name).toBe("example-user");
  });

  test("the person's name and email win, each on its own", () => {
    saveGitHubAccount(paths, account);
    const config = { ...defaultConfig, git: { name: "Another Name", email: null } };
    expect(commitIdentity(paths, config)).toEqual({
      name: "Another Name",
      email: "1234+example-user@users.noreply.github.com",
    });
  });

  test("with no account and no setting, there is no identity, so git keeps its own", () => {
    expect(commitIdentity(paths, defaultConfig)).toEqual({ name: null, email: null });
  });

  test("a line break never reaches git's config", () => {
    const config = { ...defaultConfig, git: { name: "Two\nLines", email: "a@example.com\r\n" } };
    expect(commitIdentity(paths, config)).toEqual({ name: "Two Lines", email: "a@example.com" });
  });
});

describe("refreshGitHubAccount", () => {
  test("saves the token's account", async () => {
    const baseUrl = fakeApi(200, account);
    expect(await refreshGitHubAccount(paths, "secret-token", { baseUrl })).toBe(true);
    expect(loadGitHubAccount(paths)).toEqual(account);
  });

  test("a failed read keeps the old record", async () => {
    saveGitHubAccount(paths, account);
    const baseUrl = fakeApi(401, { message: "Bad credentials" });
    expect(await refreshGitHubAccount(paths, "secret-token", { baseUrl })).toBe(false);
    expect(loadGitHubAccount(paths)).toEqual(account);
  });

  test("a token that changed during the read saves nothing", async () => {
    const baseUrl = fakeApi(200, account);
    expect(await refreshGitHubAccount(paths, "secret-token", { baseUrl, isCurrent: () => false })).toBe(false);
    expect(loadGitHubAccount(paths)).toBeNull();
  });
});
