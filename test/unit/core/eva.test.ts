import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../../src/core/eva.ts";
import { defaultConfig, homePaths, type EvaConfig } from "../../../src/core/instance/home.ts";
import type { SessionEvent } from "../../../src/shared/events.ts";
import { systemProcessRunner } from "../../../src/shared/process-runner.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../support/git-sandbox.ts";

let sandbox: GitSandbox;
let vault: string;
let home: string;
let eva: Eva | null;
let clock: Date;

function config(overrides: Partial<EvaConfig> = {}): EvaConfig {
  return { ...defaultConfig, vaultPath: vault, timeZone: "Europe/Madrid", ...overrides };
}

function start(engine: FakeEngine, overrides: Partial<EvaConfig> = {}): Eva {
  eva = new Eva({
    paths: homePaths(home),
    config: config(overrides),
    secrets: { claudeOauthToken: "oauth-token-value-for-tests" },
    engines: [engine],
    runner: systemProcessRunner,
    processEnvironment: gitEnvironment,
    now: () => clock,
    basePrompt: "Base.",
    gatherMs: 5,
  });
  return eva;
}

async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
    await Bun.sleep(10);
  }
}

beforeEach(() => {
  sandbox = createGitSandbox();
  vault = sandbox.clone("vault");
  sandbox.write(vault, ".eva/assistant.md", "# You are Eva\n");
  sandbox.git(vault, "add", "-A");
  sandbox.git(vault, "commit", "-q", "-m", "eva files");
  sandbox.git(vault, "push", "-q", "origin", "main");
  home = mkdtempSync(join(tmpdir(), "eva-home-"));
  eva = null;
  clock = new Date("2026-10-14T10:30:00Z");
}, gitHookTimeoutMs);
afterEach(async () => {
  await eva?.idle();
  eva?.stop();
  sandbox.dispose();
  rmSync(home, { recursive: true, force: true });
}, gitHookTimeoutMs);

describe("Eva", () => {
  test("a schedule fires in a fresh Assistant chat named after it, and starts with the background work", async () => {
    const engine = new FakeEngine();
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({ version: 1, schedules: [{ id: "lunch", name: "Lunch", at: "12:45", prompt: "Lunch ideas?" }] }),
    );
    const instance = start(engine);
    instance.startBackgroundWork();
    instance.startBackgroundWork();
    await instance.schedules?.tick();
    clock = new Date("2026-10-14T10:45:00Z");
    await instance.schedules?.tick();
    await waitFor(() => engine.requests.length === 1);
    await instance.idle();
    const [session] = instance.sessions.list();
    expect(session).toMatchObject({ title: "Lunch", source: "schedule", mode: "assistant" });
    expect(engine.requests[0]?.prompt).toEndWith("Lunch ideas?");
  });

  test("with no vault there is no scheduler", () => {
    expect(start(new FakeEngine(), { vaultPath: null }).schedules).toBeNull();
  });

  test("an Assistant chat runs at the vault root and saves what the turn wrote", async () => {
    const engine = new FakeEngine((request) => {
      writeFileSync(join(request.startFolder, "Methods", "New.md"), "A new note.\n");
      return FakeEngine.answer(request, "Stored it.");
    });
    mkdirSync(join(vault, "Methods"));
    const instance = start(engine);
    const session = instance.createAssistantSession({ source: "cli", model: "default" });
    await instance.sessions.send(session.id, "Store a note.");

    expect(engine.requests[0]?.startFolder).toBe(vault);
    expect(engine.requests[0]?.prompt).toBe("[Local time: 2026-10-14 12:30, Europe/Madrid]\n\nStore a note.");
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).toContain("Methods/New.md");
    expect(instance.status().vaultSync.status).toBe("ok");
  });

  test("the engine gets an allowlisted environment with the Claude token, and no other secret (lesson 96)", async () => {
    const engine = new FakeEngine();
    const instance = start(engine);
    const session = instance.createAssistantSession({ source: "cli", model: "default" });
    await instance.sessions.send(session.id, "hi");
    const environment = engine.requests[0]?.environment ?? {};
    expect(environment["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("oauth-token-value-for-tests");
    expect(Object.keys(environment).some((name) => name.startsWith("GIT_AUTHOR"))).toBe(false);
  });

  test("an extra instance on the same OS user gets its own Claude config folder (plan §4.4)", async () => {
    const engine = new FakeEngine();
    const instance = start(engine, {
      engines: { ...defaultConfig.engines, claudeCode: { ...defaultConfig.engines.claudeCode, ownConfigFolder: true } },
    });
    await instance.sessions.send(instance.createAssistantSession({ source: "cli", model: "default" }).id, "hi");
    expect(engine.requests[0]?.environment["CLAUDE_CONFIG_DIR"]).toBe(join(home, "engines", "claude"));
  });

  test("a Project chat runs in a clone, which Eva creates when the project has none", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const engine = new FakeEngine();
    const instance = start(engine, { trust: { trustedRepositoryOwners: [] } });
    const session = await instance.createProjectSession({
      projectId: "2025-03-02-1015-example-app",
      source: "cli",
      model: "default",
    });
    expect(session.clone).toBe("remote-0");
    await instance.sessions.send(session.id, "fix it");
    expect(engine.requests[0]).toMatchObject({
      mode: "project",
      startFolder: join(vault, "Projects", "2025-03-02-1015-example-app", "repos", "remote-0"),
      appendSystemPrompt: null,
      trusted: false,
    });
  });

  test("a Project chat reuses a free clone, and skips a clone where a session runs", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n`,
    );
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request, turn) {
      if (turn === 1) await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine);
    const first = await instance.createProjectSession({
      projectId: "2025-03-02-1015-example-app",
      source: "cli",
      model: "default",
    });
    const running = instance.sessions.send(first.id, "long task");
    await waitFor(() => engine.requests.length >= 1);
    const second = await instance.createProjectSession({
      projectId: "2025-03-02-1015-example-app",
      source: "cli",
      model: "default",
    });
    expect([first.clone, second.clone]).toEqual(["remote-0", "remote-1"]);
    release();
    await running;
    const third = await instance.createProjectSession({
      projectId: "2025-03-02-1015-example-app",
      source: "cli",
      model: "default",
    });
    expect(third.clone).toBe("remote-0");
  });

  test("an unknown project is an EvaError", async () => {
    const instance = start(new FakeEngine());
    const error: unknown = await instance
      .createProjectSession({ projectId: "2020-01-01-0000-missing", source: "cli", model: "default" })
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toContain("2020-01-01-0000-missing");
  });

  test("lists and searches the vault's projects", () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      "---\ncreated: 2025-03-02T10:15\nstatus: active\n---\n# Example app\n",
    );
    const instance = start(new FakeEngine());
    expect(instance.projects({ text: "example" }).map((project) => project.id)).toEqual([
      "2025-03-02-1015-example-app",
    ]);
  });

  test("the idle sweep saves a change made outside a turn", async () => {
    const instance = start(new FakeEngine());
    sandbox.write(vault, "Life/Diary/2026-10-14.md", "Written by hand.\n");
    await instance.sweep();
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).toContain("Life/Diary/2026-10-14.md");
  });

  test("the idle sweep removes Scratch files older than a week (plan §9)", async () => {
    sandbox.write(vault, "Scratch/old.pdf", "old");
    const instance = start(new FakeEngine());
    clock = new Date(Date.now() + 8 * 24 * 60 * 60_000);
    await instance.sweep();
    expect(existsSync(join(vault, "Scratch", "old.pdf"))).toBe(false);
  });

  test("voice notes stay off until a whisper model is configured", () => {
    expect(start(new FakeEngine()).transcribe).toBeNull();
    const voice = { ...defaultConfig.voice, modelPath: "/models/ggml-base.bin" };
    expect(start(new FakeEngine(), { voice }).transcribe).toBeInstanceOf(Function);
  });

  test("the idle sweep waits while an Assistant turn runs (lessons 22, 30)", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine);
    const session = instance.createAssistantSession({ source: "cli", model: "default" });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    sandbox.write(vault, "half.md", "half written\n");
    expect(await instance.sweep()).toBe("skipped");
    release();
    await turn;
  });

  test("events reach a subscriber", async () => {
    const instance = start(new FakeEngine());
    const events: SessionEvent[] = [];
    instance.sessions.subscribe((event) => events.push(event));
    await instance.sessions.send(instance.createAssistantSession({ source: "cli", model: "default" }).id, "hi");
    expect(events.map((event) => event.kind)).toEqual(["text", "turn_finished"]);
  });

  test("with no vault configured, Eva still starts and says so", () => {
    eva = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: null },
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      gatherMs: 5,
    });
    expect(eva.status().vaultPath).toBeNull();
    expect(() => eva?.createAssistantSession({ source: "cli", model: "default" })).toThrow("vault");
  });
});
