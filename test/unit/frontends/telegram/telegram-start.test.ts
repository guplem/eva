import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../../../src/core/eva.ts";
import { claimHub } from "../../../../src/core/instance/hub.ts";
import {
  createHomeFolders,
  defaultConfig,
  homePaths,
  saveConfig,
  saveSecrets,
  type EvaConfig,
  type HomePaths,
} from "../../../../src/core/settings/home.ts";
import { loadSettings } from "../../../../src/core/settings/settings.ts";
import { HttpTelegramApi } from "../../../../src/frontends/telegram/telegram-api.ts";
import { HubTelegram, startTelegram } from "../../../../src/frontends/telegram/telegram-start.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { FakeTelegram } from "../../../support/fake-telegram.ts";
import { createGitSandbox, gitEnvironment, gitHookTimeoutMs, type GitSandbox } from "../../../support/git-sandbox.ts";

let root: string;
let paths: HomePaths;
let telegram: FakeTelegram;
let eva: Eva | null;

function createEva(config: EvaConfig): Eva {
  eva = new Eva({
    paths,
    config,
    secrets: {},
    engines: [],
    runner: systemProcessRunner,
    processEnvironment: gitEnvironment,
    now: () => new Date("2026-10-18T10:00:00Z"),
    basePrompt: "Base.",
  });
  return eva;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-telegram-start-"));
  paths = homePaths(join(root, "home"));
  createHomeFolders(paths);
  telegram = new FakeTelegram();
  eva = null;
});
afterEach(async () => {
  await eva?.idle();
  eva?.stop();
  telegram.stop();
  rmSync(root, { recursive: true, force: true });
});

describe("startTelegram", () => {
  const api = (token: string): HttpTelegramApi => new HttpTelegramApi({ token, baseUrl: telegram.baseUrl });

  test("starts no bot without a bot token", () => {
    const lines: string[] = [];
    const bot = startTelegram({ paths, eva: createEva(defaultConfig), writeLine: (line) => lines.push(line), api });
    expect(bot).toBeNull();
    expect(lines).toEqual([]);
  });

  test("an unpaired bot gets a pairing code, and a pairing saves the chat and removes the code", async () => {
    saveSecrets(paths, { telegramBotToken: telegram.token });
    const lines: string[] = [];
    const logs: string[] = [];
    const bot = startTelegram({
      paths,
      eva: createEva(defaultConfig),
      writeLine: (line) => lines.push(line),
      logger: { log: (_level, message) => logs.push(message) },
      api,
    });
    expect(bot).not.toBeNull();
    const code = readFileSync(paths.telegramPairingCode, "utf-8");
    expect(code).toMatch(/^EVA-[0-9A-F]{8}$/);
    expect(lines).toEqual([`Telegram is not paired yet. Send ${code} to your bot.`]);
    telegram.sendText(4242, code);
    for (let round = 0; round < 400 && !logs.includes("Telegram paired."); round += 1) await Bun.sleep(5);
    await bot?.stop();
    expect(loadSettings(paths).config.telegram).toMatchObject({ allowedChatId: 4242, allowedUserId: 4242 });
    expect(existsSync(paths.telegramPairingCode)).toBe(false);
  });

  test("a paired bot needs no pairing code", async () => {
    saveSecrets(paths, { telegramBotToken: telegram.token });
    saveConfig(paths, { ...defaultConfig, telegram: { allowedChatId: 4242, allowedUserId: 4242 } });
    const lines: string[] = [];
    const bot = startTelegram({
      paths,
      eva: createEva(loadSettings(paths).config),
      writeLine: (line) => lines.push(line),
      api,
    });
    await bot?.stop();
    expect(bot).not.toBeNull();
    expect(lines).toEqual([]);
    expect(existsSync(paths.telegramPairingCode)).toBe(false);
  });
});

describe("HubTelegram", () => {
  let sandbox: GitSandbox;
  let vault: string;

  beforeEach(() => {
    sandbox = createGitSandbox();
    vault = sandbox.clone("vault");
  }, gitHookTimeoutMs);
  afterEach(() => {
    sandbox.dispose();
  });

  function recordingStart(steps: string[]): () => { stop: () => Promise<void> } {
    return () => {
      steps.push("start");
      return {
        stop: () => {
          steps.push("stop");
          return Promise.resolve();
        },
      };
    };
  }

  test("the hub runs the bot; it stops when another machine becomes the hub, and starts again after", async () => {
    claimHub(vault, "server", new Date("2026-10-18T09:00:00Z"));
    const core = createEva({ ...defaultConfig, vaultPath: vault, machineName: "server" });
    const steps: string[] = [];
    const hub = new HubTelegram(core, recordingStart(steps));
    await Bun.sleep(0);
    expect(steps).toEqual(["start"]);
    claimHub(vault, "laptop", new Date("2026-10-18T09:30:00Z"));
    await core.backgroundTick();
    await Bun.sleep(0);
    expect(steps).toEqual(["start", "stop"]);
    claimHub(vault, "server", new Date("2026-10-18T09:45:00Z"));
    await core.backgroundTick();
    expect(steps).toEqual(["start", "stop", "start"]);
    await hub.stop();
    expect(steps).toEqual(["start", "stop", "start", "stop"]);
  });

  test("a satellite starts no bot, and a stop with no bot does nothing", async () => {
    claimHub(vault, "laptop", new Date("2026-10-18T09:00:00Z"));
    const core = createEva({ ...defaultConfig, vaultPath: vault, machineName: "server" });
    const steps: string[] = [];
    const hub = new HubTelegram(core, recordingStart(steps));
    await hub.stop();
    expect(steps).toEqual([]);
  });
});
