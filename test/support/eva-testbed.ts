/**
 * The shared setup of the `test/unit/core/eva*.test.ts` files: a vault clone with its remote, a home
 * folder, a clock, and a helper that starts one Eva. The tests of Eva were one file, and it took
 * 400 s on a Windows runner, so they are now several files that run in parallel (#1043).
 *
 * Each file calls `useEvaTestbed()` once. The tests read `vault`, `home`, `sandbox` and `clock`
 * directly: these are live bindings, so each test sees the values of its own `beforeEach`.
 */
import { afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva, type EvaOptions } from "../../src/core/eva.ts";
import { defaultConfig, homePaths, type EvaConfig } from "../../src/core/settings/home.ts";
import { systemProcessRunner } from "../../src/shared/process-runner.ts";
import { FakeEngine } from "./fake-engine.ts";
import { fakeGh } from "./fake-gh.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "./git-sandbox.ts";
import { testVaultKeyText } from "./vault-key.ts";

export let sandbox: GitSandbox;
export let vault: string;
export let home: string;
export let eva: Eva | null;
export let clock: Date;

/** Makes `instance` the Eva that the next `afterEach` stops, and returns it. */
export function setEva<Instance extends Eva | null>(instance: Instance): Instance {
  eva = instance;
  return instance;
}

export function setClock(now: Date): void {
  clock = now;
}

// The turn sync runs git many times, and git is slow on Windows (#203). A test of the sync turns it on.
export const syncOff = { ...defaultConfig.sync, enabled: false };
export const syncOn = { ...defaultConfig.sync, enabled: true };

export function config(overrides: Partial<EvaConfig> = {}): EvaConfig {
  return { ...defaultConfig, vaultPath: vault, timeZone: "Europe/Madrid", sync: syncOff, ...overrides };
}

export function start(engine: FakeEngine, overrides: Partial<EvaConfig> = {}, options: Partial<EvaOptions> = {}): Eva {
  eva = new Eva({
    ...options,
    paths: homePaths(home),
    config: config(overrides),
    secrets: options.secrets ?? { claudeOauthToken: "oauth-token-value-for-tests" },
    engines: [engine],
    // A real gh asks GitHub about the local test remote. On a slow runner, the project work report
    // waited up to its 20-second timeout, so the test that waits for the report failed.
    runner: options.runner ?? fakeGh(systemProcessRunner),
    processEnvironment: gitEnvironment,
    now: () => clock,
    basePrompt: "Base.",
    gatherMs: 5,
  });
  // A clone of a local test remote is unknown to the trust store: answer its trust question with no.
  const instance = eva;
  instance.sessions.subscribe((event) => {
    if (event.kind === "approval_needed") instance.sessions.answerApproval(event.requestId, "deny");
  });
  return instance;
}

/** An engine whose chats answer "ok", and whose model calls say that every chat has finished. */
export function finishingEngine(): FakeEngine {
  return new FakeEngine((request) => FakeEngine.answer(request, request.mode === "model-call" ? "FINISHED" : "ok"));
}

export async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
    await Bun.sleep(10);
  }
}

/** Gives each test of the calling file a fresh vault, home and clock, and stops its Eva after it. */
export function useEvaTestbed(): void {
  beforeEach(() => {
    sandbox = createGitSandbox();
    vault = sandbox.clone("vault");
    sandbox.write(vault, ".eva/assistant.md", "# You are Eva\n");
    sandbox.write(vault, ".eva/vault-key.json", testVaultKeyText);
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
}
