import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  homePaths,
  loadConfig,
  saveConfig,
  defaultConfig,
  type HomePaths,
} from "../../../../src/core/settings/home.ts";
import { VaultSetup } from "../../../../src/core/vault/vault-setup.ts";
import { readVaultKey } from "../../../../src/core/vault/secret-state.ts";
import { unlockVaultKey } from "../../../../src/core/vault/vault-crypto.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { systemProcessRunner, type ProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, gitHookTimeoutMs, type GitSandbox } from "../../../support/git-sandbox.ts";

let sandbox: GitSandbox;
let paths: HomePaths;
let server: ReturnType<typeof Bun.serve> | null;
beforeEach(() => {
  sandbox = createGitSandbox();
  paths = homePaths(join(sandbox.root, "eva-home"));
  mkdirSync(paths.root, { recursive: true });
  server = null;
}, gitHookTimeoutMs);
afterEach(async () => {
  await server?.stop(true);
  sandbox.dispose();
}, gitHookTimeoutMs);

/** A fake GitHub API: the list holds the sandbox's remote, and a new repository is an empty bare one. */
function fakeApi(): { baseUrl: string; created: string[] } {
  const created: string[] = [];
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      if (request.method === "GET")
        return Response.json([{ full_name: "you/vault", clone_url: sandbox.remote, private: true }]);
      const { name } = (await request.json()) as { name: string };
      if (created.includes(name))
        return Response.json(
          { message: "Repository creation failed.", errors: [{ message: "name already exists" }] },
          {
            status: 422,
          },
        );
      created.push(name);
      const bare = join(sandbox.root, `${name}.git`);
      mkdirSync(bare);
      sandbox.git(bare, "init", "-q", "--bare");
      return Response.json({ full_name: `you/${name}`, clone_url: bare, private: true }, { status: 201 });
    },
  });
  return { baseUrl: `http://127.0.0.1:${String(server.port)}`, created };
}

function setup(baseUrl = "http://127.0.0.1:1", token: string | null = "a-token"): VaultSetup {
  return new VaultSetup({
    paths,
    runner: systemProcessRunner,
    savedVaultPath: () => loadConfig(paths).vaultPath,
    gitEnvironment: () => gitEnvironment,
    githubToken: () => token ?? undefined,
    githubApiBaseUrl: baseUrl,
    keyCost: { logN: 10 },
  });
}

async function failure(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

const answers = {
  name: "Sam",
  language: "English",
  notesLanguage: "",
  topics: ["work", "music"],
  password: "a long vault password",
};

describe("VaultSetup", () => {
  test("lists the repositories with the saved token, and asks for a token when none is saved", async () => {
    const api = fakeApi();
    expect(await setup(api.baseUrl).repositories()).toEqual([
      { fullName: "you/vault", cloneUrl: sandbox.remote, private: true },
    ]);
    const refused = await failure(setup(api.baseUrl, null).repositories());
    expect(isEvaError(refused, "github_failed")).toBe(true);
    expect((refused as Error).message).toContain("GitHub token");
  });

  test("clones the picked repository into the home's vault folder, and saves the folder", async () => {
    const result = await setup().clone(sandbox.remote);
    const folder = join(paths.root, "vault");
    expect(result).toEqual({ folder, repository: sandbox.remote, problem: null });
    expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toContain("# Vault");
    expect(loadConfig(paths).vaultPath).toBe(folder);
  });

  test("a saved empty folder takes the clone, and a folder with a vault refuses a second one", async () => {
    const folder = join(sandbox.root, "notes");
    saveConfig(paths, { ...defaultConfig, port: 4321, vaultPath: folder });
    await setup().clone(sandbox.remote);
    expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toContain("# Vault");
    // The other machine settings stay as they were.
    expect(loadConfig(paths).port).toBe(4321);
    const refused = await failure(setup().clone(sandbox.remote));
    expect(isEvaError(refused, "vault_not_found")).toBe(true);
  });

  test("an owner/name becomes a GitHub address, and a bare word is refused before git sees it", async () => {
    const unreadable = await failure(setup().clone("nobody-here/missing-vault"));
    expect(isEvaError(unreadable, "git_failed")).toBe(true);
    expect((unreadable as Error).message).toContain("https://github.com/nobody-here/missing-vault.git");
    const word = await failure(setup().clone("vault"));
    expect(isEvaError(word, "config_invalid")).toBe(true);
    // No folder is saved for a vault that never came.
    expect(loadConfig(paths).vaultPath).toBeNull();
  });

  test("creates a new vault from the template, then a private repository, and pushes the vault to it", async () => {
    const api = fakeApi();
    const result = await setup(api.baseUrl).create({ ...answers, repository: "my-vault" });
    const folder = join(paths.root, "vault");
    expect(result).toEqual({ folder, repository: join(sandbox.root, "my-vault.git"), problem: null });
    expect(readFileSync(join(folder, "Life", "About me.md"), "utf8")).toContain("Sam");
    // An empty answer keeps the recommended language for notes.
    expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toContain("**Write all notes in English**");
    expect(loadConfig(paths).vaultPath).toBe(folder);
    expect(sandbox.git(join(sandbox.root, "my-vault.git"), "log", "--oneline", "main")).toContain("template");
    expect(await setup(api.baseUrl).needsPush()).toBe(false);
  });

  test("a failed create keeps the local vault, and a push later puts it on GitHub", async () => {
    const api = fakeApi();
    api.created.push("taken");
    const result = await setup(api.baseUrl).create({ ...answers, repository: "taken" });
    expect(result.repository).toBeNull();
    expect(result.problem).toContain("name already exists");
    expect(loadConfig(paths).vaultPath).toBe(join(paths.root, "vault"));
    expect(await setup(api.baseUrl).needsPush()).toBe(true);
    expect(await setup(api.baseUrl).push("free")).toMatchObject({ repository: join(sandbox.root, "free.git") });
    expect(await setup(api.baseUrl).needsPush()).toBe(false);
  });

  test("a new vault with no token stays local, with a reason", async () => {
    const result = await setup("http://127.0.0.1:1", null).create({ ...answers, repository: "" });
    expect(result.repository).toBeNull();
    expect(result.problem).toContain("GitHub token");
    expect(readFileSync(join(paths.root, "vault", "AGENTS.md"), "utf8").length).toBeGreaterThan(0);
  });

  test("a push to an address needs no new repository", async () => {
    const vault = join(paths.root, "vault");
    await setup().create({ ...answers, repository: "" });
    const bare = join(sandbox.root, "empty.git");
    mkdirSync(bare);
    sandbox.git(bare, "init", "-q", "--bare");
    expect(await setup().push(bare)).toEqual({ folder: vault, repository: bare, problem: null });
  });

  test("runs one vault setup at a time", async () => {
    const first = setup();
    const running = first.clone(sandbox.remote);
    const second = await failure(first.clone(sandbox.remote));
    expect(isEvaError(second, "vault_setup_busy")).toBe(true);
    await running;
  });

  test("a folder that holds other files is never used", async () => {
    const folder = join(paths.root, "vault");
    mkdirSync(folder);
    writeFileSync(join(folder, "note.md"), "mine");
    saveConfig(paths, { ...defaultConfig, vaultPath: folder });
    expect(isEvaError(await failure(setup().create({ ...answers, repository: "" })), "vault_not_found")).toBe(true);
    expect(await setup().needsPush()).toBe(false);
  });
});

describe("a failed vault setup", () => {
  /** The system runner, but the git step named `step` fails after it runs, as a kill by the timeout would. */
  const failingAt =
    (step: string): ProcessRunner["run"] =>
    async (command, options) => {
      const result = await systemProcessRunner.run(command, options);
      return command.includes(step) ? { ...result, exitCode: 1, stderr: `${step} was stopped` } : result;
    };
  const withRunner = (run: ProcessRunner["run"]): VaultSetup =>
    new VaultSetup({
      paths,
      runner: { run },
      savedVaultPath: () => loadConfig(paths).vaultPath,
      gitEnvironment: () => gitEnvironment,
      githubToken: () => undefined,
    });

  test("a failed commit of a new vault leaves no half vault, so the page offers the step again", async () => {
    const refused = await failure(withRunner(failingAt("commit")).create({ ...answers, repository: "" }));
    expect(isEvaError(refused, "git_failed")).toBe(true);
    expect(existsSync(join(paths.root, "vault"))).toBe(false);
    expect(loadConfig(paths).vaultPath).toBeNull();
    await setup().create({ ...answers, repository: "" });
  });

  test("a stopped clone leaves the saved empty folder empty, and keeps it", async () => {
    const folder = join(sandbox.root, "notes");
    mkdirSync(folder);
    saveConfig(paths, { ...defaultConfig, vaultPath: folder });
    const refused = await failure(withRunner(failingAt("clone")).clone(sandbox.remote));
    expect(isEvaError(refused, "git_failed")).toBe(true);
    expect(readdirSync(folder)).toEqual([]);
    await setup().clone(sandbox.remote);
    expect(readdirSync(folder).length).toBeGreaterThan(0);
  });

  test("files that another program writes during the clone stay, when the clone refuses the folder", async () => {
    const folder = join(paths.root, "vault");
    const run: ProcessRunner["run"] = (command, options) => {
      // `eva setup` in a terminal fills the folder while the page's clone checks the address.
      if (command.includes("ls-remote")) {
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "note.md"), "mine");
      }
      return systemProcessRunner.run(command, options);
    };
    const refused = await failure(withRunner(run).clone(sandbox.remote));
    expect(isEvaError(refused, "vault_not_found")).toBe(true);
    expect(readFileSync(join(folder, "note.md"), "utf8")).toBe("mine");
  });

  test("a saved vault folder that is a file is refused with a reason", async () => {
    const file = join(sandbox.root, "not-a-folder");
    writeFileSync(file, "text");
    saveConfig(paths, { ...defaultConfig, vaultPath: file });
    expect(isEvaError(await failure(setup().clone(sandbox.remote)), "vault_not_found")).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("text");
  });
});

describe("VaultSetup: the vault password (#707)", () => {
  test("a new vault starts with its key in its first commit, and the password opens it", async () => {
    await setup().create({ ...answers, repository: "" });
    const vault = join(paths.root, "vault");
    const key = readVaultKey(vault);
    expect(key).not.toBeNull();
    if (key !== null) expect(await unlockVaultKey(key, answers.password)).toBeDefined();
    expect(sandbox.git(vault, "show", "--name-only", "--format=", "HEAD")).toContain(".eva/vault-key.json");
  });

  test("a short password makes no vault at all", async () => {
    const refused = await failure(setup().create({ ...answers, password: "short", repository: "" }));
    expect(isEvaError(refused, "vault_password_invalid")).toBe(true);
    expect(existsSync(join(paths.root, "vault"))).toBe(false);
  });
});
