import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeTailscale, needsLoginStatus, runningStatus } from "../../../support/fake-tailscale.ts";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva, type EvaOptions } from "../../../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../../../src/core/settings/home.ts";
import type { RemoteAccess, RemoteAccessControl } from "../../../../src/core/remote-access/remote-access.ts";
import { HttpTelegramApi, TelegramError, type TelegramApi } from "../../../../src/frontends/telegram/telegram-api.ts";
import { TelegramBot, type TelegramBotOptions } from "../../../../src/frontends/telegram/telegram-bot.ts";
import type { LogLevel } from "../../../../src/shared/logger.ts";
import { type ProcessRunner, systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { FakeEngine, type FakeTurnScript } from "../../../support/fake-engine.ts";
import type { EngineEventPayload } from "../../../../src/shared/events.ts";
import { FakeTelegram } from "../../../support/fake-telegram.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

const owner = 4242;
const readNote = {
  kind: "tool_started",
  toolUseId: "t1",
  name: "Read",
  category: "tool",
  summary: "Read Methods/Plan.md",
} as const;
let sandbox: GitSandbox;
let home: string;
let telegram: FakeTelegram;
let engine: FakeEngine;
let eva: Eva;
let paired: number[];
let clock: Date;
let sleeps: number[];
let logs: { level: LogLevel; message: string }[];

function createEva(
  script?: FakeTurnScript,
  runner: ProcessRunner = systemProcessRunner,
  extra: Partial<EvaOptions> = {},
): void {
  engine = new FakeEngine(script);
  eva = new Eva({
    ...extra,
    paths: homePaths(home),
    // The turn sync runs git many times, and git is slow on Windows (#203).
    // The sync tests of the bot use /sync and /conflicts, which run with the setting off too.
    config: {
      ...defaultConfig,
      vaultPath: sandbox.root + "/vault",
      timeZone: "UTC",
      sync: { ...defaultConfig.sync, enabled: false },
    },
    secrets: extra.secrets ?? {},
    engines: [engine],
    runner,
    processEnvironment: gitEnvironment,
    now: () => clock,
    basePrompt: "Base.",
    gatherMs: 5,
  });
}

function createBot(allowedChatId: number | null = owner, extra: Partial<TelegramBotOptions> = {}): TelegramBot {
  // A bot can still retry an alert after its test ends. It must record into its own test's lists,
  // or it changes the result of the next test.
  const ownSleeps = sleeps;
  const ownLogs = logs;
  return new TelegramBot({
    api: new HttpTelegramApi({ token: telegram.token, baseUrl: telegram.baseUrl }),
    eva,
    statePath: join(home, "state", "telegram.json"),
    allowedChatId,
    allowedUserId: null,
    pairingCode: "PAIR-1234",
    onPaired: (chatId) => paired.push(chatId),
    pollTimeoutSeconds: 0,
    typingIntervalMs: 20,
    clock: { now: () => clock },
    sleep: (ms) => {
      ownSleeps.push(ms);
      return Promise.resolve();
    },
    logger: { log: (level, message) => ownLogs.push({ level, message }) },
    ...extra,
  });
}

/** Runs the poll loop until a condition holds, then stops it. */
async function runUntil(bot: TelegramBot, until: () => boolean): Promise<void> {
  const running = bot.run();
  for (let round = 0; round < 400 && !until(); round += 1) await Bun.sleep(5);
  await bot.stop();
  await running;
  if (!until()) throw new Error("the poll loop never reached the expected state");
}

/**
 * The wait for a Telegram call. A turn chain with git on a busy Windows runner can take more than
 * 5 seconds, so the limit is a time below the 30-second test timeout, not a count of polls.
 */
const settleLimitMs = 20_000;

async function settle(bot: TelegramBot, until: () => boolean): Promise<void> {
  const deadline = Date.now() + settleLimitMs;
  while (Date.now() < deadline && !until()) {
    await bot.pollOnce();
    await Bun.sleep(10);
  }
  if (!until()) throw new Error("the expected Telegram call never came");
}

beforeEach(() => {
  sandbox = createGitSandbox();
  const vault = sandbox.clone("vault");
  sandbox.write(vault, ".eva/assistant.md", "# You are Eva\n");
  sandbox.git(vault, "add", "-A");
  sandbox.git(vault, "commit", "-q", "-m", "eva");
  sandbox.git(vault, "push", "-q", "origin", "main");
  home = mkdtempSync(join(tmpdir(), "eva-telegram-"));
  telegram = new FakeTelegram();
  paired = [];
  sleeps = [];
  logs = [];
  clock = new Date("2026-10-14T10:30:00Z");
  createEva();
}, gitHookTimeoutMs);
afterEach(async () => {
  await eva.idle();
  eva.stop();
  telegram.stop();
  sandbox.dispose();
  rmSync(home, { recursive: true, force: true });
}, gitHookTimeoutMs);

describe("access (lessons 63, 127)", () => {
  test("a stranger's chat gets only its chat id, and starts nothing", async () => {
    const bot = createBot();
    telegram.sendText(999, "hello");
    await settle(bot, () => telegram.sentTexts().length > 0);
    expect(telegram.sentTexts()[0]).toContain("999");
    expect(eva.sessions.list()).toEqual([]);
  });

  test("with no chat allowed yet, the pairing code allows the chat that sends it", async () => {
    const bot = createBot(null);
    telegram.sendText(owner, "hello");
    telegram.sendText(owner, "PAIR-1234");
    await settle(bot, () => paired.length > 0);
    // A person on a phone finds the code on Eva's page, not with a terminal command.
    expect(telegram.sentTexts()[0]).toContain("Settings, Connections");
    expect(paired).toEqual([owner]);
    expect(telegram.sentTexts().at(-1)).toContain("Paired");
    telegram.sendText(owner, "now I am in");
    await settle(bot, () => engine.requests.length > 0);
  });
});

describe("device login", () => {
  function deviceQuestion(): { text: string; buttons: string } | undefined {
    const call = telegram.callsTo("sendMessage").find((sent) => String(sent.params["text"]).startsWith("A browser"));
    return call === undefined
      ? undefined
      : { text: String(call.params["text"]), buttons: JSON.stringify(call.params["reply_markup"]) };
  }

  test("a request asks the paired chat with the code and the account, and Allow lets the browser in", async () => {
    const bot = createBot();
    expect(eva.deviceLogins.canApprove()).toBe(true);
    const request = eva.deviceLogins.request("owner@example.com", "owner@example.com, a phone");
    await settle(bot, () => deviceQuestion() !== undefined);
    expect(deviceQuestion()?.text).toBe(
      `A browser wants to open Eva (code ${request.code}, account owner@example.com). Allow?`,
    );
    expect(deviceQuestion()?.buttons).toContain(`l:${request.id}:allow`);
    expect(deviceQuestion()?.buttons).toContain(`l:${request.id}:deny`);
    telegram.pressButton(owner, `l:${request.id}:allow`);
    await settle(bot, () => telegram.callsTo("editMessageText").length === 1);
    expect(String(telegram.callsTo("editMessageText")[0]?.params["text"])).toEndWith("\n\nAllowed");
    expect(telegram.callsTo("answerCallbackQuery")[0]?.params["text"]).toBe("Allowed");
    expect(eva.deviceLogins.check(request.id, "owner@example.com").state).toBe("allowed");
  });

  test("Deny refuses the browser", async () => {
    const bot = createBot();
    const request = eva.deviceLogins.request("owner@example.com", "x");
    await settle(bot, () => deviceQuestion() !== undefined);
    telegram.pressButton(owner, `l:${request.id}:deny`);
    await settle(bot, () => telegram.callsTo("editMessageText").length === 1);
    expect(String(telegram.callsTo("editMessageText")[0]?.params["text"])).toEndWith("\n\nDenied");
    expect(eva.deviceLogins.check(request.id, "owner@example.com")).toEqual({ state: "denied" });
  });

  test("a press after the request expired says so, and lets nobody in", async () => {
    const bot = createBot();
    const request = eva.deviceLogins.request("owner@example.com", "x");
    await settle(bot, () => deviceQuestion() !== undefined);
    clock = new Date(clock.getTime() + 6 * 60_000);
    telegram.pressButton(owner, `l:${request.id}:allow`);
    await settle(bot, () => telegram.callsTo("editMessageText").length === 1);
    expect(String(telegram.callsTo("editMessageText")[0]?.params["text"])).toEndWith("\n\nThis request expired.");
    expect(eva.deviceLogins.check(request.id, "owner@example.com")).toEqual({ state: "expired" });
  });

  for (const [answer, shown] of [
    ["allow", "Allowed"],
    ["deny", "Denied"],
  ] as const) {
    test(`${answer} from another approver, such as the web page, closes the question`, async () => {
      const bot = createBot();
      const request = eva.deviceLogins.request("owner@example.com", "x");
      await settle(bot, () => deviceQuestion() !== undefined);
      eva.deviceLogins.answer(request.id, answer);
      await settle(bot, () => telegram.callsTo("editMessageText").length === 1);
      expect(String(telegram.callsTo("editMessageText")[0]?.params["text"])).toEndWith(`\n\n${shown}`);
      expect(JSON.stringify(telegram.callsTo("editMessageText")[0]?.params)).not.toContain("inline_keyboard");
    });
  }

  test("a stranger's press lets nobody in", async () => {
    const bot = createBot();
    const request = eva.deviceLogins.request("owner@example.com", "x");
    await settle(bot, () => deviceQuestion() !== undefined);
    telegram.pressButton(999, `l:${request.id}:allow`);
    await settle(bot, () => telegram.callsTo("answerCallbackQuery").length === 1);
    expect(eva.deviceLogins.check(request.id, "owner@example.com")).toEqual({ state: "pending" });
  });

  test("a bot with no paired chat, or a stopped bot, cannot confirm a device", async () => {
    const unpaired = createBot(null);
    expect(eva.deviceLogins.canApprove()).toBe(false);
    await unpaired.stop();
    const paired = createBot();
    expect(eva.deviceLogins.canApprove()).toBe(true);
    await paired.stop();
    expect(eva.deviceLogins.canApprove()).toBe(false);
  });

  test("an error text in the chat is redacted (lesson 95)", async () => {
    const secretShaped = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const bot = createBot(owner, { transcribe: () => Promise.reject(new Error(`whisper read ${secretShaped}`)) });
    telegram.sendFile(owner, "voice", new Uint8Array([1]));
    await settle(bot, () => telegram.sentTexts().length >= 1);
    expect(telegram.sentTexts()[0]).toBe("The voice note could not be transcribed: whisper read [redacted]");
  });
});

/** The last word of each version read in `tool-versions.ts`. */
const versionReads = new Set(["--version", "-version", "--help", "version"]);

describe("a group chat (security review)", () => {
  test("pairing keeps the person who paired, and only that person may act or press a button", async () => {
    // The reply to /status waits for the version of each tool. The real tools can take more than
    // 12 seconds on the Windows runner, and this test is about access, not versions.
    createEva(undefined, {
      run: (command, options) =>
        versionReads.has(command.at(-1) ?? "")
          ? Promise.resolve({ exitCode: 0, stdout: "1.0.0\n", stderr: "" })
          : systemProcessRunner.run(command, options),
    });
    const group = -1001;
    const bot = createBot(null);
    telegram.sendText(group, "PAIR-1234", undefined, owner);
    await settle(bot, () => paired.length > 0);
    telegram.sendText(group, "do something", undefined, 777);
    telegram.pressButton(group, "s:morning", undefined, 777);
    telegram.sendText(group, "/status", undefined, owner);
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("Vault sync")));
    expect(engine.requests).toEqual([]);
    expect(telegram.sentTexts().filter((text) => text.includes("No schedule"))).toEqual([]);
  });
});

describe("chats", () => {
  test("a message in the main chat starts an Assistant chat, and the answer comes back as HTML", async () => {
    createEva((request) => FakeEngine.answer(request, "**Done**: stored it."));
    const bot = createBot();
    telegram.sendText(owner, "Store a note");
    await settle(bot, () =>
      telegram.callsTo("sendMessage").some((call) => String(call.params["text"]).includes("<b>Done</b>")),
    );
    const session = eva.sessions.list()[0];
    expect(session).toMatchObject({ mode: "assistant", source: "telegram" });
    expect(telegram.callsTo("sendMessage").at(-1)?.params).toMatchObject({ chat_id: owner, parse_mode: "HTML" });
  });

  test("each answer block goes out while the turn still runs (issue #40)", async () => {
    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    createEva((request) =>
      (async function* () {
        const [, end] = FakeEngine.answer(request, "Second part.");
        yield { kind: "text" as const, text: "First part.", messageId: "m1" };
        yield readNote;
        await finished;
        yield { kind: "text" as const, text: "Second part.", messageId: "m2" };
        if (end !== undefined) yield end;
      })(),
    );
    const bot = createBot();
    telegram.sendText(owner, "Tell me");
    await settle(bot, () => telegram.sentTexts().includes("First part."));
    expect(telegram.sentTexts()).not.toContain("Second part.");
    finish();
    await settle(bot, () => telegram.sentTexts().includes("Second part."));
  });

  test("only the block that ends the turn rings the phone, as the whole answer did", async () => {
    createEva((request) => {
      const [, end] = FakeEngine.answer(request, "done");
      return [
        { kind: "text", text: "Let me look.", messageId: "m1" },
        readNote,
        { kind: "text", text: "Still on it.", messageId: "m2" },
        { kind: "tool_finished", toolUseId: "t1", isError: false },
        { kind: "text", text: "Here is the answer.", messageId: "m3" },
        ...(end === undefined ? [] : [end]),
      ];
    });
    const bot = createBot();
    telegram.sendText(owner, "Look");
    await settle(bot, () => telegram.sentTexts().includes("Here is the answer."));
    const quiet = (text: string): unknown =>
      telegram.callsTo("sendMessage").find((call) => call.params["text"] === text)?.params["disable_notification"];
    expect(quiet("Let me look.")).toBe(true);
    expect(quiet("Still on it.")).toBe(true);
    expect(quiet("Here is the answer.")).toBeUndefined();
  });

  test("ignores the streamed pieces, which never release a held block early (issue 117)", async () => {
    createEva((request) => {
      const [, end] = FakeEngine.answer(request, "done");
      return [
        { kind: "text_delta", text: "Here is " },
        { kind: "text", text: "Here is the answer.", messageId: "m1" },
        { kind: "text_delta", text: "stray piece " },
        ...(end === undefined ? [] : [end]),
      ];
    });
    const bot = createBot();
    telegram.sendText(owner, "Look");
    await settle(bot, () => telegram.sentTexts().includes("Here is the answer."));
    const answer = telegram.callsTo("sendMessage").find((call) => call.params["text"] === "Here is the answer.");
    expect(answer?.params["disable_notification"]).toBeUndefined();
    expect(telegram.sentTexts().join("\n")).not.toContain("Here is \n");
    expect(telegram.sentTexts().join("\n")).not.toContain("stray");
  });

  test("a chat that the web app marks as seen never releases a held block early (issue 381)", async () => {
    createEva((request, turnNumber) => {
      const [, end] = FakeEngine.answer(request, "done");
      if (turnNumber === 1) return FakeEngine.answer(request, "First answer.");
      return (async function* () {
        yield { kind: "text", text: "Second answer.", messageId: "m2" } as const;
        // The person reads the first answer in the web app while this turn runs.
        await Bun.sleep(0);
        const [session] = eva.sessions.list();
        eva.sessions.markSeen(session?.id ?? "", 1);
        if (end !== undefined) yield end;
      })();
    });
    const bot = createBot();
    telegram.sendText(owner, "One");
    await settle(bot, () => telegram.sentTexts().includes("First answer."));
    telegram.sendText(owner, "Two");
    await settle(bot, () => telegram.sentTexts().includes("Second answer."));
    const answer = telegram.callsTo("sendMessage").find((call) => call.params["text"] === "Second answer.");
    expect(answer?.params["disable_notification"]).toBeUndefined();
  });

  test("a quiet block stays quiet when Telegram refuses its HTML (lesson 58)", async () => {
    createEva((request) => {
      const [, end] = FakeEngine.answer(request, "done");
      return [
        { kind: "text", text: "Let me look.", messageId: "m1" },
        readNote,
        { kind: "text", text: "Done.", messageId: "m2" },
        ...(end === undefined ? [] : [end]),
      ];
    });
    const bot = createBot();
    telegram.failNext("sendMessage", 400, "Bad Request: can't parse entities");
    telegram.sendText(owner, "Look");
    await settle(bot, () => telegram.sentTexts().includes("Done."));
    const plain = telegram
      .callsTo("sendMessage")
      .find((call) => call.params["text"] === "Let me look." && call.params["parse_mode"] === undefined);
    expect(plain?.params["disable_notification"]).toBe(true);
  });

  test("a failed turn says so after the blocks it already sent", async () => {
    createEva(() => [
      { kind: "text", text: "Working on it.", messageId: "m1" },
      { kind: "turn_failed", reason: "boom" },
    ]);
    const bot = createBot();
    telegram.sendText(owner, "Try");
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("boom")));
    const texts = telegram.sentTexts();
    expect(texts.indexOf("Working on it.")).toBeLessThan(texts.indexOf("The turn failed: boom"));
  });

  test("a notice, such as an MCP server that did not start, comes before the answer", async () => {
    const notice = 'Eva could not start the MCP server "google": spawn_uvx *ENOENT*';
    createEva((request) => [{ kind: "notice", text: notice }, ...FakeEngine.answer(request, "No calendar today.")]);
    const bot = createBot();
    telegram.sendText(owner, "What is on my calendar?");
    await settle(bot, () => telegram.sentTexts().includes("No calendar today."));
    const texts = telegram.sentTexts();
    expect(texts.indexOf(notice)).toBeGreaterThan(-1);
    expect(texts.indexOf(notice)).toBeLessThan(texts.indexOf("No calendar today."));
    // Only the block that ends the turn rings the phone (issue #40).
    const sent = telegram.callsTo("sendMessage").find((call) => call.params["text"] === notice);
    expect(sent?.params["disable_notification"]).toBe(true);
  });

  test("a second message continues the same chat", async () => {
    const bot = createBot();
    telegram.sendText(owner, "one");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    telegram.sendText(owner, "two");
    await settle(bot, () => telegram.sentTexts().length >= 2);
    expect(eva.sessions.list()).toHaveLength(1);
    expect(engine.requests[1]?.history.kind).toBe("continue");
  });

  test("a thread id without is_topic_message is the main chat (lesson 60)", async () => {
    const bot = createBot();
    telegram.calls.length = 0;
    telegram.sendText(owner, "hello");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    expect(telegram.callsTo("sendMessage")[0]?.params["message_thread_id"]).toBeUndefined();
  });

  test("an answer that Telegram cannot parse is sent again as plain text (lesson 58)", async () => {
    const bot = createBot();
    telegram.failNext("sendMessage", 400, "Bad Request: can't parse entities");
    telegram.sendText(owner, "hello");
    await settle(bot, () => telegram.callsTo("sendMessage").length >= 2);
    expect(telegram.callsTo("sendMessage")[1]?.params["parse_mode"]).toBeUndefined();
  });

  test("an answer that Telegram refuses for another reason is not sent again as plain text", async () => {
    createEva((request) => FakeEngine.answer(request, "**Done**"));
    const bot = createBot();
    telegram.failNext("sendMessage", 400, "Bad Request: message thread not found");
    telegram.sendText(owner, "hello");
    await settle(bot, () => telegram.callsTo("sendMessage").length >= 1);
    await eva.idle();
    telegram.sendText(owner, "/help");
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("/new")));
    expect(telegram.sentTexts().filter((text) => text.includes("Done"))).toHaveLength(1);
    expect(logs.some((log) => log.level === "warn")).toBe(true);
  });

  test("a message refused with 429 waits the time Telegram asks for, at most 30 seconds, then goes again", async () => {
    const bot = createBot();
    telegram.failNext("sendMessage", 429, "Too Many Requests: retry after 120", 1, 120);
    telegram.sendText(owner, "/help");
    await settle(bot, () => telegram.callsTo("sendMessage").length >= 2);
    expect(sleeps).toEqual([30_000]);
    expect(telegram.sentTexts()[1]).toBe(telegram.sentTexts()[0]);
  });

  test("a message gives up after three retries", async () => {
    const bot = createBot();
    telegram.failNext("sendMessage", 429, "Too Many Requests", 10, 2);
    telegram.sendText(owner, "/help");
    await settle(bot, () => telegram.callsTo("sendMessage").length >= 4);
    telegram.sendText(owner, "/help");
    await settle(bot, () => telegram.callsTo("sendMessage").length >= 8);
    expect(sleeps.slice(0, 3)).toEqual([2_000, 2_000, 2_000]);
    expect(logs.some((log) => log.message.includes("Telegram call failed"))).toBe(true);
  });

  test("a message that hits a network error goes again after a short wait", async () => {
    const http = new HttpTelegramApi({ token: telegram.token, baseUrl: telegram.baseUrl });
    let failures = 2;
    const flaky: TelegramApi = {
      call: <Result>(method: string, params?: Readonly<Record<string, unknown>>): Promise<Result> => {
        if (method === "sendMessage" && failures > 0) {
          failures -= 1;
          return Promise.reject(new TelegramError(method, 0, "TypeError"));
        }
        return http.call<Result>(method, params);
      },
      upload: (method, params, file) => http.upload(method, params, file),
      download: (filePath) => http.download(filePath),
    };
    const bot = createBot(owner, { api: flaky });
    telegram.sendText(owner, "/help");
    await settle(bot, () => telegram.callsTo("sendMessage").length >= 1);
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  test("a long answer is split into messages under Telegram's limit", async () => {
    createEva((request) =>
      FakeEngine.answer(
        request,
        Array.from({ length: 120 }, (_, index) => `line ${String(index)} ${"z".repeat(60)}`).join("\n"),
      ),
    );
    const bot = createBot();
    telegram.sendText(owner, "long please");
    await settle(bot, () => telegram.callsTo("sendMessage").length >= 2);
    for (const text of telegram.sentTexts()) expect(text.length).toBeLessThanOrEqual(4096);
  });

  test("an update is handled once: the offset moves on and is kept on disk", async () => {
    const bot = createBot();
    // /help answers at once. /status first runs each tool for its version, which took over 5 seconds on Windows CI.
    telegram.sendText(owner, "/help");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    await bot.pollOnce();
    await bot.pollOnce();
    expect(telegram.sentTexts()).toHaveLength(1);
    const restarted = createBot();
    await restarted.pollOnce();
    expect(telegram.sentTexts()).toHaveLength(1);
  });
});

describe("topics", () => {
  test("/new opens a topic and asks for the model first (lesson 41)", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/new");
    await settle(bot, () => telegram.callsTo("sendMessage").some((call) => call.params["reply_markup"] !== undefined));
    const picker = telegram.callsTo("sendMessage").find((call) => call.params["reply_markup"] !== undefined);
    expect(picker?.params["message_thread_id"]).toBe(500);
    const session = eva.sessions.list()[0]!;
    expect(session.telegramTopicId).toBe(500);

    telegram.pressButton(owner, `m:${session.id}:haiku`, 500);
    await settle(bot, () => eva.sessions.get(session.id).modelAlias === "haiku");
    expect(telegram.callsTo("answerCallbackQuery")).toHaveLength(1);
  });

  test("the first message renames a topic that Eva opened (lesson 125)", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/new");
    await settle(bot, () => eva.sessions.list().length === 1);
    telegram.sendText(owner, "Plan the trip to Rome", 500);
    await settle(bot, () => telegram.callsTo("editForumTopic").length === 1);
    expect(telegram.callsTo("editForumTopic")[0]?.params).toMatchObject({
      message_thread_id: 500,
      name: "Plan the trip to Rome",
    });
  });

  test("a model's chat name renames only a topic that Eva opened (issue 50, lesson 125)", async () => {
    mkdirSync(join(sandbox.root, "vault", ".eva"), { recursive: true });
    writeFileSync(join(sandbox.root, "vault", ".eva", "chat-names.md"), "Lead with an emoji.\n");
    createEva((request, turnNumber) =>
      FakeEngine.answer(request, request.mode === "model-call" ? "🇮🇹 Rome trip" : `answer ${String(turnNumber)}`),
    );
    const bot = createBot();
    telegram.sendText(owner, "/new");
    await settle(bot, () => eva.sessions.list().length === 1);
    telegram.sendText(owner, "Plan the trip to Rome", 500);
    await settle(bot, () => telegram.callsTo("editForumTopic").length === 2);
    expect(telegram.callsTo("editForumTopic").map((call) => call.params["name"])).toEqual([
      "Plan the trip to Rome",
      "🇮🇹 Rome trip",
    ]);

    // A topic that the person opened keeps the person's name; only the chat takes the model's.
    telegram.sendText(owner, "Plan the trip to Paris", 600);
    await settle(bot, () =>
      eva.sessions.list().some((session) => session.telegramTopicId === 600 && session.title === "🇮🇹 Rome trip"),
    );
    // The bot handles the rename event after the store changes. A person's rename in the same topic
    // comes after it, so once that one arrives, a wrong automatic rename would have arrived too.
    const topic600 = eva.sessions.list().find((session) => session.telegramTopicId === 600);
    eva.sessions.rename(topic600!.id, "Paris");
    await settle(bot, () => telegram.callsTo("editForumTopic").length === 3);
    expect(telegram.callsTo("editForumTopic").map((call) => call.params["name"])).toEqual([
      "Plan the trip to Rome",
      "🇮🇹 Rome trip",
      "Paris",
    ]);
  });

  test("/rename renames the chat and its topic, and the first message keeps that name (issue 46)", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/new");
    await settle(bot, () => eva.sessions.list().length === 1);
    telegram.sendText(owner, "/rename Trip plans", 500);
    await settle(bot, () => telegram.callsTo("editForumTopic").length === 1);
    expect(telegram.callsTo("editForumTopic")[0]?.params).toMatchObject({ message_thread_id: 500, name: "Trip plans" });
    expect(eva.sessions.list()[0]?.title).toBe("Trip plans");

    telegram.sendText(owner, "Plan the trip to Rome", 500);
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("answer")));
    expect(telegram.callsTo("editForumTopic")).toHaveLength(1);
    expect(eva.sessions.list()[0]?.title).toBe("Trip plans");
  });

  test("a rename from another front end renames the chat's topic too (issue 46)", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/new");
    await settle(bot, () => eva.sessions.list().length === 1);
    eva.sessions.rename(eva.sessions.list()[0]!.id, "Trip plans");
    await settle(bot, () => telegram.callsTo("editForumTopic").length === 1);
    expect(telegram.callsTo("editForumTopic")[0]?.params).toMatchObject({ message_thread_id: 500, name: "Trip plans" });
  });

  test("a topic that Telegram refuses to rename says so in the chat, so the phone sees it", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/new");
    await settle(bot, () => eva.sessions.list().length === 1);
    telegram.failNext("editForumTopic", 400, "Bad Request: not enough rights to manage topics");
    telegram.sendText(owner, "/rename Trip plans", 500);
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("did not rename this topic")));
    const notice = telegram.callsTo("sendMessage").find((call) => String(call.params["text"]).includes("did not"));
    expect(notice?.params["message_thread_id"]).toBe(500);
    expect(String(notice?.params["text"])).toContain("not enough rights");
  });

  test("the same /rename again retries a refused topic, and a topic that has the name already is fine", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/new");
    await settle(bot, () => eva.sessions.list().length === 1);
    telegram.failNext("editForumTopic", 400, "Bad Request: not enough rights to manage topics");
    telegram.sendText(owner, "/rename Trip plans", 500);
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("did not rename this topic")));
    telegram.sendText(owner, "/rename Trip plans", 500);
    await settle(bot, () => telegram.callsTo("editForumTopic").length === 2);

    telegram.failNext("editForumTopic", 400, "Bad Request: TOPIC_NOT_MODIFIED");
    telegram.sendText(owner, "/rename Trip plans", 500);
    await settle(bot, () => telegram.sentTexts().filter((text) => text.includes("now called")).length === 3);
    await bot.pollOnce();
    expect(telegram.sentTexts().filter((text) => text.includes("did not rename this topic"))).toHaveLength(1);
    expect(logs.filter((entry) => entry.message === "A Telegram call failed.")).toHaveLength(1);
  });

  test("/rename with no title says how to use it, and with no chat says so", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/rename");
    await settle(bot, () => telegram.sentTexts().length === 1);
    expect(telegram.sentTexts()[0]).toContain("/rename <title>");
    telegram.sendText(owner, "/rename Trip plans");
    await settle(bot, () => telegram.sentTexts().length === 2);
    expect(telegram.sentTexts()[1]).toContain("no chat");
    expect(eva.sessions.list()).toEqual([]);
  });

  test("/rename in the main chat renames its chat, and no topic", async () => {
    const bot = createBot();
    telegram.sendText(owner, "hello");
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("answer")));
    telegram.sendText(owner, "/rename Main notes");
    await settle(bot, () => eva.sessions.list()[0]?.title === "Main notes");
    await bot.pollOnce();
    expect(telegram.callsTo("editForumTopic")).toEqual([]);
  });

  test("when Telegram refuses a topic, the chat stays in the main chat (lesson 61)", async () => {
    const bot = createBot();
    telegram.failNext("createForumTopic", 400, "Bad Request: the chat is not a forum");
    telegram.sendText(owner, "/new");
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("Topics are not available")));
    expect(eva.sessions.list()[0]?.telegramTopicId).toBeNull();
  });

  test("/delete asks first, then deletes the topic and forgets its chat", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/new");
    await settle(bot, () => eva.sessions.list().length === 1);
    telegram.sendText(owner, "/delete", 500);
    await settle(bot, () =>
      telegram
        .callsTo("sendMessage")
        .some((call) => JSON.stringify(call.params["reply_markup"] ?? "").includes("d:500")),
    );
    telegram.pressButton(owner, "d:500", 500);
    await settle(bot, () => telegram.callsTo("deleteForumTopic").length === 1);
    // The chat is gone from every front end, not only from Telegram (#9).
    expect(eva.sessions.list()).toEqual([]);
    // The main chat has no chat of its own yet, so its delete has nothing to do.
    telegram.pressButton(owner, "d:main");
    await settle(bot, () => telegram.sentTexts().includes("There is no chat here to delete."));
  });

  test("/delete of a chat that works deletes nothing", async () => {
    createEva(async function* (request) {
      await new Promise<void>((resolve) => request.signal.addEventListener("abort", () => resolve()));
      yield { kind: "turn_failed", reason: "The turn was stopped." };
    });
    const bot = createBot();
    telegram.sendText(owner, "/new");
    await settle(bot, () => eva.sessions.list().length === 1);
    telegram.sendText(owner, "long work", 500);
    await settle(bot, () => engine.requests.length === 1);
    telegram.pressButton(owner, "d:500", 500);
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("still working")));
    expect(telegram.callsTo("deleteForumTopic")).toEqual([]);
    expect(eva.sessions.list()).toHaveLength(1);
    eva.sessions.stop(eva.sessions.list()[0]!.id);
  });

  test("a chat deleted in another front end loses its topic, and the main chat starts a new chat", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/new");
    await settle(bot, () => eva.sessions.list().length === 1);
    telegram.sendText(owner, "hello from the main chat");
    await settle(bot, () => engine.requests.length === 1);
    await eva.idle();
    const topicChat = eva.sessions.list().find((session) => session.telegramTopicId === 500)!;
    const mainChat = eva.sessions.list().find((session) => session.telegramTopicId === null)!;

    eva.sessions.delete(topicChat.id);
    await settle(bot, () => telegram.callsTo("deleteForumTopic").length === 1);
    expect(telegram.callsTo("deleteForumTopic")[0]?.params["message_thread_id"]).toBe(500);

    eva.sessions.delete(mainChat.id);
    telegram.sendText(owner, "a new start");
    await settle(bot, () => engine.requests.length === 2);
    expect(eva.sessions.list().map((session) => session.id)).not.toContain(mainChat.id);
    expect(eva.sessions.list()).toHaveLength(1);
    expect(telegram.callsTo("deleteForumTopic")).toHaveLength(1);
  });
});

describe("/chats: every chat of the instance (#9)", () => {
  function chatButtons(): { text: string; callback_data: string }[] {
    const call = telegram
      .callsTo("sendMessage")
      .findLast((sent) => String(sent.params["text"]).startsWith("Pick a chat"));
    const keyboard = call?.params["reply_markup"] as { inline_keyboard: { text: string; callback_data: string }[][] };
    return keyboard.inline_keyboard.flat();
  }

  async function webChat(text: string): Promise<string> {
    const session = eva.createAssistantSession({ source: "web", model: "default" });
    await eva.sessions.send(session.id, text);
    return session.id;
  }

  test("lists the chats newest first, without forks and schedule chats", async () => {
    const older = await webChat("Plan the garden");
    clock = new Date("2026-10-14T11:00:00Z");
    const newer = await webChat("Write the letter");
    eva.sessions.fork(newer, eva.sessions.get(newer).turns[0]!.lastMessageId!);
    eva.createAssistantSession({ source: "schedule", model: "default", title: "Morning summary" });
    const bot = createBot();
    telegram.sendText(owner, "/chats");
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("Pick a chat")));
    expect(chatButtons()).toEqual([
      { text: "Write the letter", callback_data: `o:${newer}` },
      { text: "Plan the garden", callback_data: `o:${older}` },
    ]);
  });

  test("leaves out the archived chats, as the chat list of the web app does (issue 388)", async () => {
    const kept = await webChat("Plan the garden");
    eva.sessions.setArchived(await webChat("Write the letter"), true);
    const bot = createBot();
    telegram.sendText(owner, "/chats");
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("Pick a chat")));
    expect(chatButtons()).toEqual([{ text: "Plan the garden", callback_data: `o:${kept}` }]);
  });

  test("a press opens a topic with the last turns, and the topic continues the web chat", async () => {
    const sessionId = await webChat("one");
    for (const text of ["two", "three", "four"]) await eva.sessions.send(sessionId, text);
    const bot = createBot();
    telegram.pressButton(owner, `o:${sessionId}`);
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("answer 4")));
    expect(telegram.callsTo("createForumTopic")[0]?.params["name"]).toBe("one");
    const inTopic = telegram
      .callsTo("sendMessage")
      .filter((call) => call.params["message_thread_id"] === 500)
      .map((call) => String(call.params["text"]));
    expect(inTopic).toEqual([
      "Earlier turns: 4. The web chat has all of them.",
      "Message: two",
      "answer 2",
      "Message: three",
      "answer 3",
      "Message: four",
      "answer 4",
    ]);

    telegram.sendText(owner, "five", 500);
    await settle(bot, () => telegram.sentTexts().includes("answer 5"));
    expect(eva.sessions.get(sessionId).turns).toHaveLength(5);
    expect(eva.sessions.list()).toHaveLength(1);
    // Eva named the topic after the chat, so the first message keeps that name (lesson 125).
    expect(telegram.callsTo("editForumTopic")).toEqual([]);
  });

  test("a message from another front end shows in the topic, and a Telegram message shows once", async () => {
    const sessionId = await webChat("one");
    const bot = createBot();
    telegram.pressButton(owner, `o:${sessionId}`);
    await settle(bot, () => telegram.sentTexts().includes("answer 1"));
    const before = telegram.sentTexts().length;

    telegram.sendText(owner, "from the phone", 500);
    await settle(bot, () => telegram.sentTexts().includes("answer 2"));
    void eva.sessions.send(sessionId, "from the web", "api");
    await settle(bot, () => telegram.sentTexts().includes("answer 3"));
    expect(telegram.sentTexts().slice(before)).toEqual(["answer 2", "Message: from the web", "answer 3"]);
  });

  test("a press on a chat that has its topic opens no second topic", async () => {
    const sessionId = await webChat("one");
    const bot = createBot();
    telegram.pressButton(owner, `o:${sessionId}`);
    await settle(bot, () => telegram.callsTo("createForumTopic").length === 1);
    telegram.pressButton(owner, `o:${sessionId}`);
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("already has its topic")));
    expect(telegram.callsTo("createForumTopic")).toHaveLength(1);
  });

  test("in a supergroup, the answer to a press links to the topic", async () => {
    const group = -1009876;
    const sessionId = await webChat("one");
    const bot = createBot(group);
    telegram.pressButton(group, `o:${sessionId}`, undefined, owner);
    // The whole sentence, not a part of it: a test that looks for a URL inside a text reads as a weak URL check.
    await settle(bot, () =>
      telegram.sentTexts().includes("This chat continues in the topic “one” (https://t.me/c/9876/500)."),
    );
  });

  test("without topics, a press makes the main chat continue that chat", async () => {
    const sessionId = await webChat("one");
    const bot = createBot();
    telegram.failNext("createForumTopic", 400, "Bad Request: the chat is not a forum");
    telegram.pressButton(owner, `o:${sessionId}`);
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("The main chat now continues")));
    telegram.sendText(owner, "two");
    await settle(bot, () => telegram.sentTexts().includes("answer 2"));
    expect(eva.sessions.get(sessionId).turns).toHaveLength(2);
  });

  test("without topics, a press waits while the main chat works (lesson 49)", async () => {
    createEva(async function* (request) {
      await new Promise<void>((resolve) => request.signal.addEventListener("abort", () => resolve()));
      yield { kind: "turn_failed", reason: "The turn was stopped." };
    });
    const other = eva.createAssistantSession({ source: "web", model: "default" });
    const bot = createBot();
    telegram.sendText(owner, "long work");
    await settle(bot, () => engine.requests.length === 1);
    telegram.failNext("createForumTopic", 400, "Bad Request: the chat is not a forum");
    telegram.pressButton(owner, `o:${other.id}`);
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("still working")));
    for (const session of eva.sessions.list()) eva.sessions.stop(session.id);
  });

  test("a press on a deleted chat says so", async () => {
    const bot = createBot();
    telegram.pressButton(owner, "o:gone");
    await settle(bot, () => telegram.sentTexts().includes("That chat no longer exists."));
  });

  test("a topic that Telegram fails to open leaves the main chat as it was", async () => {
    const sessionId = await webChat("one");
    const bot = createBot();
    telegram.sendText(owner, "the main chat's own message");
    await settle(bot, () => telegram.sentTexts().includes("answer 2"));
    await eva.idle();
    telegram.failNext("createForumTopic", 429, "Too Many Requests: retry after 1", 1, 4);
    telegram.pressButton(owner, `o:${sessionId}`);
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("Telegram did not open the topic")));
    telegram.sendText(owner, "still the main chat");
    await settle(bot, () => telegram.sentTexts().includes("answer 3"));
    expect(eva.sessions.get(sessionId).turns).toHaveLength(1);
  });

  test("a long message from another front end arrives whole, in parts", async () => {
    const sessionId = await webChat("one");
    const bot = createBot();
    telegram.pressButton(owner, `o:${sessionId}`);
    await settle(bot, () => telegram.sentTexts().includes("answer 1"));
    const long = `${"word ".repeat(1_500)}END`;
    // On a slow connection, the answer must still wait for the last part of the message.
    telegram.sendDelayMs = 30;
    void eva.sessions.send(sessionId, long, "api");
    await settle(bot, () => telegram.sentTexts().includes("answer 2"));
    const texts = telegram.sentTexts();
    const parts = texts.filter((text) => text.includes("word"));
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.at(-1)).toEndWith("END");
    expect(texts.indexOf("answer 2")).toBeGreaterThan(texts.lastIndexOf(parts.at(-1) ?? ""));
  });

  test("a message from another front end during a turn shows after that turn's answer (lesson 114)", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    createEva(async function* (request) {
      if (request.prompt.endsWith("slow")) await held;
      yield* FakeEngine.answer(request, `answer to ${request.prompt.split("\n").at(-1) ?? ""}`);
    });
    const sessionId = await webChat("one");
    const bot = createBot();
    telegram.pressButton(owner, `o:${sessionId}`);
    await settle(bot, () => telegram.sentTexts().includes("answer to one"));
    const before = telegram.sentTexts().length;
    telegram.sendText(owner, "slow", 500);
    await settle(bot, () => engine.requests.length === 2);
    void eva.sessions.send(sessionId, "from the web", "api");
    await Bun.sleep(50);
    release();
    await settle(bot, () => telegram.sentTexts().includes("answer to from the web"));
    expect(telegram.sentTexts().slice(before)).toEqual([
      "answer to slow",
      "Message: from the web",
      "answer to from the web",
    ]);
  });

  test("a press on a chat that works says so, and its answer reaches the new topic", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    createEva(async function* (request) {
      await held;
      yield* FakeEngine.answer(request, "done at last");
    });
    const session = eva.createAssistantSession({ source: "web", model: "default" });
    void eva.sessions.send(session.id, "long work", "api");
    const bot = createBot();
    await settle(bot, () => engine.requests.length === 1);
    telegram.pressButton(owner, `o:${session.id}`);
    await settle(bot, () =>
      telegram.sentTexts().some((text) => text.startsWith("Eva is working on a message from the web app")),
    );
    release();
    await settle(bot, () => telegram.sentTexts().includes("done at last"));
    const answer = telegram.callsTo("sendMessage").find((call) => call.params["text"] === "done at last");
    expect(answer?.params["message_thread_id"]).toBe(500);
  });
});

describe("/chats while a turn runs (#9)", () => {
  test("without topics, the answer of a running chat reaches the main chat", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    createEva(async function* (request) {
      await held;
      yield* FakeEngine.answer(request, "done at last");
    });
    const session = eva.createAssistantSession({ source: "web", model: "default" });
    void eva.sessions.send(session.id, "long work", "api");
    const bot = createBot();
    await settle(bot, () => engine.requests.length === 1);
    telegram.failNext("createForumTopic", 400, "Bad Request: the chat is not a forum");
    telegram.pressButton(owner, `o:${session.id}`);
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("The main chat now continues")));
    release();
    await settle(bot, () => telegram.sentTexts().includes("done at last"));
    expect(telegram.sentTexts()).toContain(
      "Eva is working on a message from the web app or the terminal. Her answer comes here.",
    );
  });

  test("a chat that opens after the first answer block gets the whole answer once, at the turn end", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let firstBlock: () => void = () => undefined;
    const firstBlockSent = new Promise<void>((resolve) => (firstBlock = resolve));
    createEva(async function* (request) {
      const [, end] = FakeEngine.answer(request, "done");
      yield { kind: "text" as const, text: "Part one.", messageId: "m1" };
      firstBlock();
      await held;
      yield readNote;
      yield { kind: "text" as const, text: "Part two.", messageId: "m2" };
      if (end !== undefined) yield end;
    });
    const session = eva.createAssistantSession({ source: "web", model: "default" });
    void eva.sessions.send(session.id, "long work", "api");
    const bot = createBot();
    await firstBlockSent;
    telegram.failNext("createForumTopic", 400, "Bad Request: the chat is not a forum");
    telegram.pressButton(owner, `o:${session.id}`);
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("The main chat now continues")));
    release();
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("Part two.")));
    await eva.idle();
    const answers = telegram.sentTexts().filter((text) => text.includes("Part"));
    expect(answers).toHaveLength(1);
    expect(answers[0]).toContain("Part one.");
  });
});

describe("/delete in the main chat (#9)", () => {
  test("deletes the main chat's chat everywhere, after a confirm", async () => {
    const bot = createBot();
    telegram.sendText(owner, "hello");
    await settle(bot, () => telegram.sentTexts().includes("answer 1"));
    await eva.idle();
    telegram.sendText(owner, "/delete");
    await settle(bot, () =>
      telegram
        .callsTo("sendMessage")
        .some((call) => JSON.stringify(call.params["reply_markup"] ?? "").includes("d:main")),
    );
    telegram.pressButton(owner, "d:main");
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("Deleted.")));
    expect(eva.sessions.list()).toEqual([]);
    expect(telegram.callsTo("deleteForumTopic")).toEqual([]);
  });
});

/** A Tailscale address that stays as it is, for a test that only reads it. */
function fixedRemoteAccess(access: RemoteAccess): RemoteAccessControl {
  return {
    current: () => access,
    refresh: () => Promise.resolve(access),
    install: () => Promise.resolve(access),
    signIn: () => Promise.resolve(access),
  };
}

describe("project work from a Telegram chat (#9)", () => {
  const projectId = "2025-03-02-1015-example-app";

  function writeProject(): void {
    sandbox.write(
      join(sandbox.root, "vault"),
      `Projects/${projectId}/AGENTS.md`,
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
  }

  test("opens a topic for the Project chat, and links to it and to the web chat", async () => {
    writeProject();
    const group = -1001234;
    createEva(
      (request) => FakeEngine.answer(request, request.mode === "project" ? "Fixed it." : "Noted."),
      systemProcessRunner,
      { remoteAccess: fixedRemoteAccess({ url: "https://eva.example.ts.net", problem: null }) },
    );
    eva.sessions.subscribe((event) => {
      if (event.kind === "approval_needed") eva.sessions.answerApproval(event.requestId, "deny");
    });
    const bot = createBot(group);
    telegram.sendText(group, "hello", undefined, owner);
    await settle(bot, () => telegram.sentTexts().includes("Noted."));
    const asking = eva.sessions.list()[0]!;

    const work = await eva.startProjectWork({ projectId, request: "Fix the login bug.", reportToSessionId: asking.id });
    await settle(bot, () => telegram.sentTexts().includes("Fixed it."));
    expect(telegram.callsTo("createForumTopic")[0]?.params["name"]).toBe("Example app: Fix the login bug.");
    const started = telegram.sentTexts().find((text) => text.startsWith("Project work started"));
    expect(started).toBe(
      [
        "Project work started in Example app. Follow it in the topic “Example app: Fix the login bug.” (https://t.me/c/1234/500).",
        `Web: https://eva.example.ts.net/#/chat/${work.id}`,
      ].join("\n"),
    );
    const inTopic = telegram
      .callsTo("sendMessage")
      .filter((call) => call.params["message_thread_id"] === 500)
      .map((call) => String(call.params["text"]));
    // The Project chat asks for trust in its own topic, where the person follows the work.
    expect(inTopic).toHaveLength(3);
    expect(inTopic[0]).toBe("Message: Fix the login bug.");
    expect(inTopic[1]).toStartWith("Eva wants to run Trust this repository");
    expect(inTopic[2]).toBe("Fixed it.");
    await settle(bot, () => telegram.sentTexts().filter((text) => text === "Noted.").length === 2);
    await eva.idle();
  });

  test("without topics or Tailscale, the asking chat learns where to find the work", async () => {
    writeProject();
    createEva((request) => FakeEngine.answer(request, "ok"));
    eva.sessions.subscribe((event) => {
      if (event.kind === "approval_needed") eva.sessions.answerApproval(event.requestId, "deny");
    });
    const bot = createBot();
    telegram.sendText(owner, "hello");
    await settle(bot, () => telegram.sentTexts().includes("ok"));
    telegram.failNext("createForumTopic", 400, "Bad Request: the chat is not a forum");
    await eva.startProjectWork({ projectId, request: "Fix it.", reportToSessionId: eva.sessions.list()[0]!.id });
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("Project work started")));
    expect(telegram.sentTexts()).toContain(
      "Project work started in Example app. Follow it in the web app, in Project mode.",
    );
    await eva.idle();
  });
});

describe("usage limits (issue #67)", () => {
  const warning = {
    kind: "usage_limit",
    status: "warning",
    window: "five_hour",
    usedPercent: 86,
    resetsAt: "2026-10-14T12:00:00.000Z",
  } as const;

  /** The engine sends the limit after the first answer text, as the captured fixtures show. */
  function engineWith(limitOf: (prompt: string) => EngineEventPayload): FakeTurnScript {
    return async function* (request) {
      await Promise.resolve();
      const limit = limitOf(request.prompt);
      if (limit.kind === "usage_limit" && limit.status === "rejected") {
        yield limit;
        yield { kind: "turn_failed", reason: "limit" };
        return;
      }
      const [text, end] = FakeEngine.answer(request, "ok");
      yield text!;
      yield limit;
      yield end!;
    };
  }

  function sentMessages(): { text: string; quiet: boolean }[] {
    return telegram.callsTo("sendMessage").map((call) => ({
      text: String(call.params["text"]),
      quiet: call.params["disable_notification"] === true,
    }));
  }

  test("a warning comes quietly after the answer, which still rings, in the time zone setting", async () => {
    createEva(engineWith(() => warning));
    eva.updateSettings({ timeZone: "Asia/Tokyo" });
    const bot = createBot();
    const line = "You used 86% of your 5-hour usage limit. It resets at 21:00.";
    telegram.sendText(owner, "first");
    await settle(bot, () => telegram.sentTexts().includes(line));
    const sent = sentMessages();
    expect(sent.find((message) => message.text === "ok")?.quiet).toBe(false);
    expect(sent.find((message) => message.text === line)?.quiet).toBe(true);
    expect(sent.findIndex((message) => message.text === "ok")).toBeLessThan(
      sent.findIndex((message) => message.text === line),
    );
  });

  test("a warning in a chat outside Telegram leaves the warning free for the phone", async () => {
    createEva(engineWith(() => warning));
    const bot = createBot();
    const web = eva.createAssistantSession({ source: "web", model: "default" });
    await eva.sessions.send(web.id, "from the web");
    telegram.sendText(owner, "first");
    await settle(bot, () =>
      telegram.sentTexts().includes("You used 86% of your 5-hour usage limit. It resets at 12:00."),
    );
  });

  test("two windows in one turn give two lines", async () => {
    createEva(async function* (request) {
      await Promise.resolve();
      const [text, end] = FakeEngine.answer(request, "ok");
      yield text!;
      yield warning;
      yield { ...warning, window: "seven_day" };
      yield end!;
    });
    const bot = createBot();
    telegram.sendText(owner, "first");
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("weekly usage limit")));
    expect(telegram.sentTexts()).toContain("You used 86% of your 5-hour usage limit. It resets at 12:00.");
  });

  test("a warning shows once for each 10% step, and a refusal always shows before the failure", async () => {
    createEva(
      engineWith((prompt) =>
        prompt.endsWith("refuse")
          ? { ...warning, status: "rejected", usedPercent: 100 }
          : { ...warning, usedPercent: prompt.endsWith("more") ? 95 : 86 },
      ),
    );
    const bot = createBot();
    for (const [index, message] of ["first", "second", "more"].entries()) {
      telegram.sendText(owner, message);
      await settle(bot, () => telegram.sentTexts().filter((text) => text === "ok").length === index + 1);
    }
    telegram.sendText(owner, "refuse");
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("The turn failed")));
    await settle(bot, () =>
      telegram.sentTexts().includes("You used 95% of your 5-hour usage limit. It resets at 12:00."),
    );
    const texts = telegram.sentTexts();
    expect(texts.filter((text) => text.startsWith("You used 86%"))).toHaveLength(1);
    expect(texts.indexOf("You reached your 5-hour usage limit. It resets at 12:00.")).toBeLessThan(
      texts.findIndex((text) => text.startsWith("The turn failed")),
    );
  });
});

describe("approvals and commands", () => {
  test("an approval becomes buttons, and the press answers the turn", async () => {
    const answers: string[] = [];
    createEva(async function* (request) {
      answers.push(await request.requestApproval({ requestId: "x", toolName: "Bash", summary: "gh issue create" }));
      yield* FakeEngine.answer(request, "ok");
    });
    const bot = createBot();
    telegram.sendText(owner, "open an issue");
    await settle(bot, () =>
      telegram
        .callsTo("sendMessage")
        .some((call) => JSON.stringify(call.params["reply_markup"] ?? "").includes(":allow")),
    );
    const buttons = JSON.stringify(
      telegram.callsTo("sendMessage").find((call) => call.params["reply_markup"] !== undefined)?.params["reply_markup"],
    );
    const requestId = /"a:([^:"]+):allow"/.exec(buttons)?.[1] ?? "";
    telegram.pressButton(owner, `a:${requestId}:allow`);
    await settle(bot, () => answers.length === 1);
    expect(answers).toEqual(["allow"]);
    expect(telegram.callsTo("answerCallbackQuery")[0]?.params["text"]).toBe("Allowed");
  });

  test("an approval never overtakes the answer block before it, even during a 429 wait", async () => {
    createEva(async function* (request) {
      yield { kind: "text", text: "I will push the branch.", messageId: "m1" };
      const answer = await request.requestApproval({ requestId: "", toolName: "Bash", summary: "git push" });
      yield* FakeEngine.answer(request, answer);
    });
    const bot = createBot(owner, { sleep: () => Bun.sleep(50) });
    telegram.failNext("sendMessage", 429, "Too Many Requests", 1, 1);
    telegram.sendText(owner, "push it");
    await settle(bot, () => telegram.callsTo("sendMessage").some((call) => call.params["reply_markup"] !== undefined));
    const texts = telegram.sentTexts();
    expect(texts.lastIndexOf("I will push the branch.")).toBeLessThan(
      texts.findIndex((text) => text.startsWith("Eva wants to run Bash")),
    );
    const question = telegram.callsTo("sendMessage").find((call) => call.params["reply_markup"] !== undefined);
    const requestId = /"a:([^:"]+):deny"/.exec(JSON.stringify(question?.params["reply_markup"]))?.[1] ?? "";
    telegram.pressButton(owner, `a:${requestId}:deny`);
    await settle(bot, () => telegram.callsTo("editMessageText").length === 1);
  });

  test("an answered approval edits its message to show the answer, and drops the buttons", async () => {
    createEva(async function* (request) {
      const answer = await request.requestApproval({ requestId: "", toolName: "Bash", summary: "git push" });
      yield* FakeEngine.answer(request, answer);
    });
    const bot = createBot();
    telegram.sendText(owner, "push it");
    await settle(bot, () => telegram.callsTo("sendMessage").some((call) => call.params["reply_markup"] !== undefined));
    const question = telegram.callsTo("sendMessage").find((call) => call.params["reply_markup"] !== undefined);
    const requestId = /"a:([^:"]+):deny"/.exec(JSON.stringify(question?.params["reply_markup"]))?.[1] ?? "";
    telegram.pressButton(owner, `a:${requestId}:deny`);
    await settle(bot, () => telegram.callsTo("editMessageText").length === 1);
    const edit = telegram.callsTo("editMessageText")[0]?.params;
    expect(edit?.["message_id"]).toBe((question?.result as { message_id: number }).message_id);
    expect(edit?.["chat_id"]).toBe(owner);
    expect(String(edit?.["text"])).toBe("Eva wants to run Bash: git push\n\nDenied");
    expect(edit?.["reply_markup"]).toBeUndefined();
    expect(telegram.callsTo("answerCallbackQuery")[0]?.params["text"]).toBe("Denied");
  });

  test("/status, /projects and /help answer without the engine (lesson 43)", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/status");
    telegram.sendText(owner, "/projects");
    telegram.sendText(owner, "/help");
    await settle(bot, () => telegram.sentTexts().length >= 3);
    const texts = telegram.sentTexts().join("\n");
    expect(texts).toContain("Vault sync");
    expect(texts).toContain("No project matches");
    expect(texts).toContain("/new");
    expect(engine.requests).toEqual([]);
  });

  test("/projects reads the filter words, and shows the tags and the warnings", async () => {
    const vault = join(sandbox.root, "vault");
    sandbox.write(
      vault,
      "Projects/2025-02-01-0900-tax-report/AGENTS.md",
      "---\ncreated: 2025-02-01T09:00\nstatus: active\ntags: [life]\n---\n# Taxes\n",
    );
    sandbox.write(
      vault,
      "Projects/2024-01-01-0900-photo-sorter/AGENTS.md",
      "---\ncreated: 2024-01-01T09:00\ntags: [life]\n---\n",
    );
    const bot = createBot();
    telegram.sendText(owner, "/projects status:active");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    telegram.sendText(owner, "/projects #life sorter");
    await settle(bot, () => telegram.sentTexts().length >= 2);
    expect(telegram.sentTexts()).toEqual([
      "2025-02-01-0900-tax-report  active  Taxes  #life",
      "2024-01-01-0900-photo-sorter  ?  photo-sorter  #life\n  ⚠ status must be idea, active, paused or closed",
    ]);
  });

  test("/projects drops whole projects from a list too long for one message, and says so", async () => {
    const vault = join(sandbox.root, "vault");
    for (let day = 10; day < 30; day += 1) {
      sandbox.write(
        vault,
        `Projects/2025-02-${String(day)}-0900-project-${String(day)}/AGENTS.md`,
        `---\ncreated: 2025-02-${String(day)}T09:00\nstatus: active\n---\n# ${"Long title ".repeat(25)}\n`,
      );
    }
    const bot = createBot();
    telegram.sendText(owner, "/projects");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    const text = telegram.sentTexts()[0] ?? "";
    expect(text.length).toBeLessThanOrEqual(4_096);
    expect(text).toMatch(/\n…and \d+ more\. Add words to narrow the search\.$/);
    expect(
      text
        .split("\n")
        .slice(0, -1)
        .every((line) => line.endsWith("Long title")),
    ).toBe(true);
  });

  test("/projects still shows the first project when it alone is too long for the limit", async () => {
    sandbox.write(
      join(sandbox.root, "vault"),
      "Projects/2025-02-10-0900-huge/AGENTS.md",
      `---\ncreated: 2025-02-10T09:00\nstatus: active\n---\n# ${"Huge ".repeat(800)}\n`,
    );
    const bot = createBot();
    telegram.sendText(owner, "/projects");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    expect(telegram.sentTexts()[0]).toStartWith("2025-02-10-0900-huge  active  Huge");
  });

  test("/conflicts shows each conflicted note with three buttons, and a pick after a restart resolves it", async () => {
    const vault = join(sandbox.root, "vault");
    const other = sandbox.clone("other");
    sandbox.write(other, "Notes/plan.md", "theirs\n");
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "other");
    sandbox.git(other, "push", "-q", "origin", "main");
    sandbox.write(vault, "Notes/plan.md", "mine\n");
    expect(await eva.sweep()).toBe("conflict");

    const bot = createBot();
    telegram.sendText(owner, "/conflicts");
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("Notes/plan.md")));
    expect(telegram.sentTexts().join("\n")).toContain("Keep both");
    const question = telegram
      .callsTo("sendMessage")
      .find((call) => String(call.params["text"]).includes("Notes/plan.md"));
    const markup = JSON.stringify(question?.params["reply_markup"]);
    expect(markup).toContain("Keep mine");
    expect(markup).toContain("Keep theirs");
    const data = /"(c:[0-9a-f]+:m)"/.exec(markup)?.[1] ?? "";
    expect(data).not.toBe("");

    // The button id lives on disk, so a new bot still knows the note (lesson 124).
    const restarted = createBot();
    telegram.pressButton(owner, data);
    await settle(restarted, () => telegram.sentTexts().some((text) => text.includes("The vault syncs again.")));
    expect(sandbox.git(sandbox.remote, "show", "main:Notes/plan.md")).toBe("mine");
  });

  test("/conflicts lists the notes without a pick first, so a long list reaches every note", async () => {
    const vault = join(sandbox.root, "vault");
    const other = sandbox.clone("other");
    const names = Array.from({ length: 11 }, (_, index) => `Notes/n${String(index).padStart(2, "0")}.md`);
    for (const name of names) sandbox.write(other, name, "theirs\n");
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "other");
    sandbox.git(other, "push", "-q", "origin", "main");
    for (const name of names) sandbox.write(vault, name, "mine\n");
    expect(await eva.sweep()).toBe("conflict");
    await eva.resolveVaultConflict("Notes/n00.md", "mine");

    const bot = createBot();
    telegram.sendText(owner, "/conflicts");
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("Pick these first")));
    const texts = telegram.sentTexts().join("\n");
    expect(texts).toContain("Notes/n10.md");
    expect(texts).not.toContain("Notes/n00.md");
  });

  test("/conflicts says so when the vault has none, and a stale button says the note has no conflict", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/conflicts");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    expect(telegram.sentTexts()[0]).toBe("The vault has no conflict.");
    telegram.pressButton(owner, "c:000000000000:t");
    await settle(bot, () => telegram.sentTexts().length >= 2);
    expect(telegram.sentTexts()[1]).toContain("no conflict anymore");
  });

  test("/sync syncs the vault, and /update says when this Eva cannot update herself", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/sync");
    telegram.sendText(owner, "/update");
    telegram.sendText(owner, "/link");
    await settle(bot, () => telegram.sentTexts().length >= 5);
    const texts = telegram.sentTexts().join("\n");
    expect(texts).toContain("Syncing…");
    expect(texts).toContain("Checking for updates…");
    expect(texts).toContain("Vault sync:");
    expect(texts).toContain("This Eva cannot update herself.");
    expect(texts).toContain("On Eva's computer, run `eva open`.");
    expect(engine.requests).toEqual([]);
  });

  test("/sync hides a secret that git names in its error (#447)", async () => {
    const secret = "github-token-value-for-tests";
    createEva(undefined, systemProcessRunner, { secrets: { githubToken: secret } });
    // Git names the remote in its error, and a remote address can hold a token.
    sandbox.git(sandbox.root + "/vault", "remote", "set-url", "origin", join(home, secret, "missing.git"));
    const bot = createBot();
    telegram.sendText(owner, "/sync");
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("Vault sync:")));
    const texts = telegram.sentTexts().join("\n");
    expect(texts).toContain("[redacted]");
    expect(texts).not.toContain(secret);
  });

  test("/link shows the setup steps, and its buttons install Tailscale and sign the machine in", async () => {
    const tailscale = new FakeTailscale();
    let release = (): void => undefined;
    let installs = 0;
    const watcher = tailscale.watcher({
      install: () => {
        installs += 1;
        return new Promise<void>((resolve) => {
          release = () => {
            tailscale.status = needsLoginStatus;
            resolve();
          };
        });
      },
    });
    await watcher.refresh();
    createEva(undefined, systemProcessRunner, { remoteAccess: watcher });
    // A sleep that takes real time, so the install wait is still running when the install ends.
    const waits: number[] = [];
    const bot = createBot(owner, {
      sleep: (ms) => {
        waits.push(ms);
        return Bun.sleep(1);
      },
    });
    telegram.sendText(owner, "/link");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    expect(telegram.sentTexts()[0]).toContain("Install Tailscale on this machine");
    expect(JSON.stringify(telegram.callsTo("sendMessage")[0]?.params["reply_markup"])).toContain("t:install");

    // The install takes a while: the bot waits apart, and a second tap starts no second wait.
    telegram.pressButton(owner, "t:install");
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("Installing Tailscale")));
    await settle(bot, () => installs > 0);
    telegram.pressButton(owner, "t:install");
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("on it already")));
    expect(waits).toContain(3_000);
    release();
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("Sign in to Tailscale on this machine")));
    expect(installs).toBe(1);
    const signInMessage = telegram.callsTo("sendMessage").at(-1);
    expect(JSON.stringify(signInMessage?.params["reply_markup"])).toContain("t:sign_in");

    telegram.pressButton(owner, "t:sign_in");
    // A whole line, not a part of the text: a link check by substring would also pass a look-alike host.
    const signInLine = "- Sign in to Tailscale: open this link on any device. https://login.tailscale.com/a/fresh";
    await settle(bot, () => telegram.sentTexts().some((text) => text.split("\n").includes(signInLine)));
    expect(telegram.sentTexts()).toContain("Asking Tailscale for a sign-in link…");

    // Only the paired owner may press the buttons.
    const upCalls = tailscale.commands.filter((verb) => verb === "up").length;
    telegram.pressButton(owner + 1, "t:sign_in");
    await settle(bot, () => telegram.callsTo("answerCallbackQuery").length >= 4);
    expect(tailscale.commands.filter((verb) => verb === "up")).toHaveLength(upCalls);
  });

  test("an old install button on a ready machine shows the address and installs nothing", async () => {
    const tailscale = new FakeTailscale();
    tailscale.status = runningStatus(true);
    let installs = 0;
    const watcher = tailscale.watcher({
      install: () => {
        installs += 1;
        return Promise.resolve();
      },
    });
    await watcher.refresh();
    createEva(undefined, systemProcessRunner, { remoteAccess: watcher });
    const bot = createBot();
    telegram.pressButton(owner, "t:install");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    expect(telegram.sentTexts()[0]).toStartWith("Open Eva: https://server.example-tailnet.ts.net");
    expect(installs).toBe(0);
  });

  test("an install button does nothing when phone access is off", async () => {
    createEva();
    const bot = createBot();
    telegram.pressButton(owner, "t:install");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    expect(telegram.sentTexts()[0]).toBe("Phone access is off on this machine.");
  });

  test("/update offers each newer version; a button shows what it brings, and a second one installs it", async () => {
    const applied: (string | undefined)[] = [];
    createEva(undefined, systemProcessRunner, {
      updateChannel: {
        kind: "executable",
        check: () =>
          Promise.resolve({
            current: "0.2.0",
            latest: "1.0.0",
            available: true,
            releases: [
              { version: "1.0.0", notes: "## Breaking changes\n\n- feat!: rename the keys\n" },
              { version: "0.3.0", notes: "## New features\n\n- feat: voice notes\n" },
            ],
          }),
        apply: (version) => {
          applied.push(version);
          return Promise.resolve({ current: "0.2.0", latest: version ?? "?", available: false, releases: [] });
        },
      },
      restartForUpdate: () => undefined,
    });
    eva.updateSettings({ updates: { install: "patch" } });
    const bot = createBot();
    const sent = (): { text: string; buttons: string }[] =>
      telegram.callsTo("sendMessage").map((call) => ({
        text: String(call.params["text"]),
        buttons: JSON.stringify(call.params["reply_markup"] ?? null),
      }));
    telegram.sendText(owner, "/update");
    await settle(bot, () => sent().some((message) => message.buttons.includes("u:1.0.0")));
    const offer = sent().find((message) => message.buttons.includes("u:1.0.0"));
    expect(offer?.text).toContain("1.0.0 is held back");
    expect(offer?.buttons).not.toContain("u:next:go");
    // The held-back news reaches the chat as news, not as a problem.
    expect(telegram.sentTexts().some((text) => text.startsWith("Eva 1.0.0 is out."))).toBe(true);
    expect(offer?.buttons).toContain("u:0.3.0");
    expect(applied).toEqual([]);
    telegram.pressButton(owner, "u:1.0.0");
    await settle(bot, () => sent().some((message) => message.buttons.includes("u:1.0.0:go")));
    const details = sent().find((message) => message.buttons.includes("u:1.0.0:go"));
    expect(details?.text).toContain("feat!: rename the keys (1.0.0)");
    expect(details?.text).toContain("feat: voice notes (0.3.0)");
    expect(details?.text).toContain("can break");
    telegram.pressButton(owner, "u:9.9.9");
    await settle(bot, () => sent().some((message) => message.text.includes("9.9.9 is not a newer release")));
    telegram.pressButton(owner, "u:1.0.0:go");
    await settle(bot, () => applied.length > 0);
    expect(applied).toEqual(["1.0.0"]);
  });

  test("/update offers the update, and its button installs after the running chat ends (lesson 92)", async () => {
    let release: () => void = () => undefined;
    const restarts: string[] = [];
    createEva(
      async function* (request) {
        await new Promise<void>((resolve) => (release = resolve));
        yield* FakeEngine.answer(request, "done");
      },
      systemProcessRunner,
      {
        updateChannel: {
          kind: "executable",
          check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: null }),
          apply: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false, releases: null }),
        },
        restartForUpdate: () => restarts.push("restart"),
      },
    );
    const bot = createBot();
    const session = eva.createAssistantSession({ source: "cli", model: "default" });
    const turn = eva.sessions.send(session.id, "work");
    for (let round = 0; round < 400 && engine.requests.length === 0; round += 1) await Bun.sleep(5);
    telegram.sendText(owner, "/update");
    await settle(bot, () =>
      telegram.callsTo("sendMessage").some((call) => JSON.stringify(call.params).includes("u:next:go")),
    );
    // /update only looks; the button installs.
    expect(eva.updateStatus()?.phase).toBe("idle");
    telegram.pressButton(owner, "u:next:go");
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("installs when")));
    expect(restarts).toEqual([]);
    release();
    await turn;
    await eva.backgroundTick();
    expect(restarts).toEqual(["restart"]);
    expect(eva.updateStatus()?.phase).toBe("restarting");
  });

  test("a slow /sync runs apart from the poll loop, so other commands still answer", async () => {
    let releaseSync: () => void = () => undefined;
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    let gateOpen = true;
    const gatedRunner: ProcessRunner = {
      run: async (command, options) => {
        if (!gateOpen && command.includes("fetch")) await syncGate;
        return systemProcessRunner.run(command, options);
      },
    };
    createEva(undefined, gatedRunner);
    const bot = createBot();
    gateOpen = false;
    telegram.sendText(owner, "/sync");
    telegram.sendText(owner, "/help");
    // "Syncing…" goes out apart from the poll loop, so it can reach Telegram after the /help answer.
    await settle(
      bot,
      () => telegram.sentTexts().includes("Syncing…") && telegram.sentTexts().some((text) => text.includes("/new")),
    );
    expect(telegram.sentTexts().some((text) => text.startsWith("Vault sync:"))).toBe(false);
    releaseSync();
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("Vault sync:")));
  });

  test("the commands are registered with Telegram", async () => {
    const bot = createBot();
    await bot.registerCommands();
    expect(JSON.stringify(telegram.callsTo("setMyCommands")[0]?.params)).toContain("new");
  });
});

describe("stop and approvals from elsewhere", () => {
  test("/stop stops the running turn of this chat, and says when nothing runs", async () => {
    createEva(async function* (request) {
      await new Promise<void>((resolve) => {
        request.signal.addEventListener("abort", () => {
          resolve();
        });
      });
      yield { kind: "turn_failed", reason: "The turn was stopped." };
    });
    const bot = createBot();
    telegram.sendText(owner, "/stop");
    await settle(bot, () => telegram.sentTexts().includes("Eva is not working in this chat."));
    telegram.sendText(owner, "work for a long time");
    await settle(bot, () => engine.requests.length === 1);
    telegram.sendText(owner, "/stop");
    await settle(bot, () => telegram.sentTexts().includes("Stopped."));
    expect(telegram.sentTexts()).toContain("Stopping.");
    expect(telegram.sentTexts().filter((text) => text.startsWith("The turn failed"))).toEqual([]);
  });

  test("a turn that fails without /stop still names the reason", async () => {
    createEva(() => [{ kind: "turn_failed", reason: "The engine is gone." }]);
    const bot = createBot();
    telegram.sendText(owner, "hello");
    await settle(bot, () => telegram.sentTexts().includes("The turn failed: The engine is gone."));
  });

  test("an approval from a web chat reaches the main chat, named after its chat", async () => {
    createEva(async function* (request) {
      const answer = await request.requestApproval({ requestId: "", toolName: "Bash", summary: "git push" });
      yield* FakeEngine.answer(request, answer);
    });
    const bot = createBot();
    const webChat = eva.createAssistantSession({ source: "web", model: "default", title: "Release notes" });
    void eva.sessions.send(webChat.id, "push");
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("(in “Release notes”)")));
    const markup = JSON.stringify(telegram.callsTo("sendMessage").at(-1)?.params["reply_markup"]);
    const requestId = /"a:([^:"]+):allow"/.exec(markup)?.[1] ?? "";
    telegram.pressButton(owner, `a:${requestId}:allow`);
    await settle(bot, () => eva.sessions.get(webChat.id).turns.length === 1);
    expect(eva.sessions.get(webChat.id).turns[0]?.answerText).toBe("allow");
  });
});

describe("alerts, logs and restart", () => {
  const problem = {
    level: "error" as const,
    message: "The vault sync failed: disk full. Send /sync to try again.",
    resolvedMessage: "The vault sync works again.",
  };

  test("each alert goes to the main chat of the allowed chat, and its end too", async () => {
    const bot = createBot();
    eva.reportProblem("vault_sync", problem);
    eva.reportProblem("vault_sync", null);
    await settle(bot, () => telegram.sentTexts().length >= 2);
    expect(telegram.sentTexts()).toEqual([`Problem: ${problem.message}`, `Resolved: ${problem.resolvedMessage}`]);
    expect(telegram.callsTo("sendMessage")[0]?.params["message_thread_id"]).toBeUndefined();
    await bot.stop();
  });

  test("before pairing, an alert goes nowhere; after a stop, the bot sends no more alerts", async () => {
    const unpaired = createBot(null);
    eva.reportProblem("vault_sync", problem);
    await unpaired.stop();
    const stopped = createBot();
    await stopped.stop();
    eva.reportProblem("vault_sync", null);
    await Bun.sleep(20);
    expect(telegram.sentTexts()).toEqual([]);
  });

  test("/status starts with the verdict and the problem lines", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/status");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    expect(telegram.sentTexts()[0]).toStartWith("All good\nEva ");
    // A phone sees the version of Claude Code and the other tools too.
    expect(telegram.sentTexts()[0]).toMatch(/\nTools: /);
    eva.reportProblem("vault_sync", problem);
    telegram.sendText(owner, "/status");
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("1 problem\n")));
    expect(telegram.sentTexts().find((text) => text.startsWith("1 problem\n"))).toContain(`• ${problem.message}`);
  });

  test("/logs shows the last warnings and errors, 20 by default, and /logs 2 only two", async () => {
    const folder = homePaths(home).logsFolder;
    mkdirSync(folder, { recursive: true });
    const records = Array.from({ length: 30 }, (_, index) =>
      JSON.stringify({ at: "2026-10-14T10:00:00.000Z", level: "error", message: `Error ${String(index)}.` }),
    );
    writeFileSync(join(folder, "eva-2026-10-14.jsonl"), records.join("\n") + "\n");
    const bot = createBot();
    telegram.sendText(owner, "/logs");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    expect(telegram.sentTexts()[0]?.split("\n")).toHaveLength(20);
    expect(telegram.sentTexts()[0]).toEndWith("2026-10-14 10:00 error Error 29.");
    telegram.sendText(owner, "/logs 2");
    await settle(bot, () => telegram.sentTexts().length >= 2);
    expect(telegram.sentTexts()[1]).toBe("2026-10-14 10:00 error Error 28.\n2026-10-14 10:00 error Error 29.");
  });

  test("/logs splits a long answer under Telegram's limit", async () => {
    const folder = homePaths(home).logsFolder;
    mkdirSync(folder, { recursive: true });
    const records = Array.from({ length: 100 }, (_, index) =>
      JSON.stringify({ at: "2026-10-14T10:00:00.000Z", level: "warn", message: `${"x".repeat(80)} ${String(index)}` }),
    );
    writeFileSync(join(folder, "eva-2026-10-14.jsonl"), records.join("\n") + "\n");
    const bot = createBot();
    telegram.sendText(owner, "/logs 100");
    await settle(bot, () => telegram.sentTexts().length >= 2);
    expect(telegram.sentTexts().every((text) => text.length < 4_096)).toBe(true);
    expect(telegram.sentTexts().join("\n").split("\n")).toHaveLength(100);
  });

  test("/restart asks first, names the running chats, and the button restarts Eva", async () => {
    const restarts: string[] = [];
    createEva(
      async function* (request) {
        await new Promise<void>((resolve) => {
          request.signal.addEventListener("abort", () => {
            resolve();
          });
        });
        yield { kind: "turn_failed", reason: "The turn was stopped." };
      },
      systemProcessRunner,
      { restartForUpdate: () => restarts.push("restart") },
    );
    const bot = createBot();
    telegram.sendText(owner, "work for a long time");
    await settle(bot, () => engine.requests.length === 1);
    telegram.sendText(owner, "/restart");
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("Restart Eva now?")));
    const question = telegram.callsTo("sendMessage").find((call) => String(call.params["text"]).includes("Restart"));
    expect(String(question?.params["text"])).toContain("1 chat is running");
    expect(JSON.stringify(question?.params["reply_markup"])).toContain('"r:now"');
    expect(restarts).toEqual([]);
    telegram.pressButton(owner, "r:now");
    await settle(bot, () => restarts.length === 1);
    expect(telegram.sentTexts()).toContain("Restarting… Eva answers again in a moment.");
    for (const session of eva.sessions.list()) eva.sessions.stop(session.id);
  });

  test("with no chat running, /restart only asks", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/restart");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    expect(telegram.sentTexts()[0]).toBe("Restart Eva now?");
  });

  test("a poll conflict is a problem at once; it clears at the next good poll", async () => {
    const bot = createBot();
    telegram.failNext("getUpdates", 409, "Conflict", 3);
    await bot.pollOnce();
    await bot.pollOnce();
    expect(eva.status().problems).toEqual([]);
    await bot.pollOnce();
    expect(eva.status().problems[0]).toContain("Another program polls this Telegram bot");
    await bot.pollOnce();
    expect(eva.status().problems).toEqual([]);
  });

  test("a poll that fails for more than 15 minutes is a problem, and a stop clears it", async () => {
    const bot = createBot();
    telegram.failNext("getUpdates", 502, "Bad Gateway", 3);
    await bot.pollOnce();
    clock = new Date(clock.getTime() + 15 * 60_000);
    await bot.pollOnce();
    expect(eva.status().problems).toEqual([]);
    clock = new Date(clock.getTime() + 1_000);
    await bot.pollOnce();
    expect(eva.status().problems[0]).toContain("Bad Gateway");
    await bot.stop();
    expect(eva.status().problems).toEqual([]);
  });

  test("/help names /logs and /restart", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/help");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    expect(telegram.sentTexts()[0]).toContain("/logs");
    expect(telegram.sentTexts()[0]).toContain("/restart");
  });
});

describe("one poller per bot (lessons 56, 57)", () => {
  test("three conflicts in two minutes pause the bot for ten minutes, even with a success between them", async () => {
    const bot = createBot();
    telegram.failNext("getUpdates", 409, "Conflict: terminated by other getUpdates request", 2);
    expect(await bot.pollOnce()).toBe(1_000);
    expect(await bot.pollOnce()).toBe(2_000);
    expect(await bot.pollOnce()).toBe(0);
    telegram.failNext("getUpdates", 409, "Conflict", 1);
    expect(await bot.pollOnce()).toBe(10 * 60_000);
    expect(bot.pollState()).toEqual({ kind: "conflict", since: "2026-10-14T10:30:00.000Z" });
    expect(logs.filter((log) => log.level === "error").map((log) => log.message)).toEqual([
      "Another program polls this Telegram bot. Eva pauses Telegram for 10 minutes.",
    ]);
  });

  test("conflicts spread over more than two minutes never pause the bot", async () => {
    const bot = createBot();
    for (let conflict = 0; conflict < 4; conflict += 1) {
      telegram.failNext("getUpdates", 409, "Conflict");
      expect(await bot.pollOnce()).toBeLessThan(60_001);
      clock = new Date(clock.getTime() + 61_000);
    }
    expect(bot.pollState().kind).toBe("failing");
  });

  test("after the pause, the bot polls again and leaves the conflict state", async () => {
    const bot = createBot();
    telegram.failNext("getUpdates", 409, "Conflict", 3);
    await runUntil(bot, () => sleeps.includes(10 * 60_000) && telegram.callsTo("getUpdates").length >= 5);
    expect(sleeps.slice(0, 3)).toEqual([1_000, 2_000, 10 * 60_000]);
    expect(bot.pollState()).toEqual({ kind: "polling" });
  });

  test("a failed poll waits 1 second, doubling to a 60-second cap, and a success resets the wait", async () => {
    const bot = createBot();
    telegram.failNext("getUpdates", 502, "Bad Gateway", 8);
    await runUntil(bot, () => telegram.callsTo("getUpdates").length >= 10);
    expect(sleeps).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
    expect(bot.pollState()).toEqual({ kind: "polling" });
    telegram.failNext("getUpdates", 502, "Bad Gateway", 1);
    await runUntil(bot, () => sleeps.length === 9);
    expect(sleeps.at(-1)).toBe(1_000);
  });

  test("a failed poll shows in the poll state until the next success", async () => {
    const bot = createBot();
    telegram.failNext("getUpdates", 502, "Bad Gateway");
    await bot.pollOnce();
    expect(bot.pollState()).toMatchObject({ kind: "failing", since: "2026-10-14T10:30:00.000Z" });
    await bot.pollOnce();
    expect(bot.pollState()).toEqual({ kind: "polling" });
  });

  test("a poll refused with 429 waits the time that Telegram asks for", async () => {
    const bot = createBot();
    telegram.failNext("getUpdates", 429, "Too Many Requests: retry after 7", 1, 7);
    expect(await bot.pollOnce()).toBe(7_000);
  });

  test("an unexpected error in the loop is logged, and polling continues", async () => {
    const blocker = join(home, "blocker");
    writeFileSync(blocker, "not a folder");
    const bot = createBot(owner, { statePath: join(blocker, "telegram.json") });
    telegram.sendText(owner, "/help");
    await runUntil(bot, () => logs.some((log) => log.message.includes("poll loop")));
    expect(sleeps).toEqual([1_000]);
  });

  test("a stop during a long wait ends the loop at once", async () => {
    // No sleep seam: the real wait of 1 second must end at the stop.
    const bot = new TelegramBot({
      api: new HttpTelegramApi({ token: telegram.token, baseUrl: telegram.baseUrl }),
      eva,
      statePath: join(home, "state", "telegram.json"),
      allowedChatId: owner,
      allowedUserId: null,
      pairingCode: "PAIR-1234",
      onPaired: () => undefined,
      pollTimeoutSeconds: 0,
    });
    telegram.failNext("getUpdates", 502, "Bad Gateway");
    const running = bot.run();
    for (let round = 0; round < 400 && telegram.callsTo("getUpdates").length === 0; round += 1) await Bun.sleep(5);
    const stoppedAt = performance.now();
    await bot.stop();
    await running;
    expect(performance.now() - stoppedAt).toBeLessThan(800);
  });

  test("a stop confirms the offset with Telegram", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/help");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    await bot.stop();
    const last = telegram.callsTo("getUpdates").at(-1);
    expect(last?.params).toMatchObject({ timeout: 0 });
    expect(Number(last?.params["offset"])).toBeGreaterThan(1);
  });
});

describe("files (lessons 72, 74, 124)", () => {
  const vault = (): string => join(sandbox.root, "vault");

  function uploads(): string[] {
    return telegram.callsTo("sendDocument").map((call) => (call.params["document"] as { name: string }).name);
  }

  test("an attach marker sends the file after the text, and the marker line never shows", async () => {
    sandbox.write(vault(), "Methods/Plan.md", "# Plan\n");
    createEva((request) => FakeEngine.answer(request, "Here it is.\n[[attach: Methods/Plan.md]]"));
    const bot = createBot();
    telegram.sendText(owner, "send the plan");
    await settle(bot, () => uploads().length === 1);
    expect(uploads()).toEqual(["Plan.md"]);
    expect(telegram.sentTexts().join("\n")).not.toContain("[[attach");
  });

  test("an offer marker shows a button, and the press sends the file", async () => {
    sandbox.write(vault(), "Methods/Plan.md", "# Plan\n");
    createEva((request) => FakeEngine.answer(request, "Want it?\n[[offer: Methods/Plan.md]]"));
    const bot = createBot();
    telegram.sendText(owner, "the plan");
    await settle(bot, () => telegram.sentTexts().includes("Files you can open:"));
    expect(uploads()).toEqual([]);
    const markup = JSON.stringify(telegram.callsTo("sendMessage").at(-1)?.params["reply_markup"]);
    const id = /"f:([0-9a-f]+)"/.exec(markup)?.[1] ?? "";
    telegram.pressButton(owner, `f:${id}`);
    telegram.pressButton(owner, "f:unknown");
    await settle(
      bot,
      () => uploads().length === 1 && telegram.sentTexts().includes("That file is no longer available."),
    );
  });

  test("a file named in two blocks of one answer goes once", async () => {
    sandbox.write(vault(), "Methods/Plan.md", "# Plan\n");
    // The turn ends with a failure: its message goes out after the turn's offers, so the checks see every send.
    createEva(() => [
      { kind: "text", text: "Here.\n[[attach: Methods/Plan.md]]", messageId: "m1" },
      { kind: "text", text: "Again.\n[[offer: Methods/Plan.md]]\n[[attach: Methods/Plan.md]]", messageId: "m2" },
      { kind: "turn_failed", reason: "end" },
    ]);
    const bot = createBot();
    telegram.sendText(owner, "send the plan");
    await settle(bot, () => telegram.sentTexts().includes("The turn failed: end"));
    expect(uploads()).toEqual(["Plan.md"]);
    expect(telegram.sentTexts()).not.toContain("Files you can open:");
  });

  test("an attach in a later block beats an offer in an earlier one", async () => {
    sandbox.write(vault(), "Methods/Plan.md", "# Plan\n");
    sandbox.write(vault(), "Methods/Other.md", "# Other\n");
    createEva((request) => {
      const [, end] = FakeEngine.answer(request, "done");
      return [
        { kind: "text", text: "Maybe.\n[[offer: Methods/Plan.md]]\n[[offer: Methods/Other.md]]", messageId: "m1" },
        { kind: "text", text: "Here.\n[[attach: Methods/Plan.md]]", messageId: "m2" },
        ...(end === undefined ? [] : [end]),
      ];
    });
    const bot = createBot();
    telegram.sendText(owner, "send the plan");
    await settle(bot, () => telegram.sentTexts().includes("Files you can open:"));
    expect(uploads()).toEqual(["Plan.md"]);
    const markup = JSON.stringify(telegram.callsTo("sendMessage").at(-1)?.params["reply_markup"]);
    expect(markup).toContain("Other.md");
    expect(markup).not.toContain("Plan.md");
  });

  test("a file outside the vault gets a sentence instead of an upload", async () => {
    createEva((request) => FakeEngine.answer(request, "[[attach: ../secrets.txt]]\n[[offer: Missing.md]]"));
    const bot = createBot();
    telegram.sendText(owner, "send it");
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("Missing.md does not exist")));
    expect(telegram.sentTexts().some((text) => text.includes("secrets.txt does not exist"))).toBe(true);
    expect(uploads()).toEqual([]);
  });

  test("a failed upload gets a sentence", async () => {
    sandbox.write(vault(), "Methods/Plan.md", "# Plan\n");
    createEva((request) => FakeEngine.answer(request, "[[attach: Methods/Plan.md]]"));
    const bot = createBot();
    telegram.failNext("sendDocument", 413, "Request Entity Too Large");
    telegram.sendText(owner, "send it");
    await settle(bot, () =>
      telegram.sentTexts().some((text) => text.includes("Telegram did not take Methods/Plan.md")),
    );
  });

  test("a received file is saved in Scratch and named in the message to Eva", async () => {
    const bot = createBot();
    telegram.sendFile(owner, "document", new Uint8Array([1, 2, 3]), { fileName: "receipt.pdf" });
    await settle(bot, () => engine.requests.length === 1);
    const prompt = engine.requests[0]?.prompt ?? "";
    const saved = /saved as (Scratch\/received\/receipt-[0-9a-f]{12}\.pdf)/.exec(prompt)?.[1] ?? "";
    expect(existsSync(join(vault(), saved))).toBe(true);
  });

  test("a file over Telegram's download limit is refused with a sentence", async () => {
    const bot = createBot();
    telegram.sendFile(owner, "document", new Uint8Array([1]), { fileName: "huge.zip", reportedSize: 21 * 1024 * 1024 });
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("up to 20 MB")));
    expect(engine.requests).toEqual([]);
  });

  test("a phone photo is saved from its largest size, with its caption as the message", async () => {
    const bot = createBot();
    telegram.sendPhoto(owner, new Uint8Array([7, 7, 7]), "What is this?");
    await settle(bot, () => engine.requests.length === 1);
    const prompt = engine.requests[0]?.prompt ?? "";
    expect(prompt).toContain("What is this?\n\n[The person sent a file");
    const saved = /saved as (Scratch\/received\/photo-large-photo-\d+-[0-9a-f]{12}\.jpg)/.exec(prompt)?.[1] ?? "";
    expect(existsSync(join(vault(), saved))).toBe(true);
  });

  test("an audio file is saved like a document", async () => {
    const bot = createBot();
    telegram.sendFile(owner, "audio", new Uint8Array([4, 5]), { fileName: "memo.mp3" });
    await settle(bot, () => engine.requests.length === 1);
    expect(engine.requests[0]?.prompt).toMatch(/saved as Scratch\/received\/memo-[0-9a-f]{12}\.mp3/);
  });

  test("a sticker or a video note gets one sentence, and a service message gets none", async () => {
    const bot = createBot();
    telegram.sendMessageWith(owner, { sticker: { file_id: "s" }, caption: "ignored" });
    telegram.sendMessageWith(owner, { forum_topic_created: { name: "Topic" } });
    telegram.sendMessageWith(owner, { video_note: { file_id: "v" } });
    await settle(bot, () => telegram.sentTexts().length >= 2);
    expect(telegram.sentTexts()).toEqual(["Eva cannot read stickers yet.", "Eva cannot read video notes yet."]);
    expect(engine.requests).toEqual([]);
  });

  test("a shared location is kept for the scripts, and a live location moves with no new reply", async () => {
    const bot = createBot();
    telegram.sendMessageWith(owner, { location: { latitude: 41.39, longitude: 2.17, live_period: 3600 } });
    await settle(bot, () => telegram.sentTexts().length === 1);
    expect(telegram.sentTexts()[0]).toContain("while you share it");
    expect(eva.currentPlace()).toMatchObject({ lat: 41.39, lon: 2.17, source: "telegram" });
    // Eva keeps one point every 15 minutes, so the next move counts only after that.
    clock = new Date(clock.getTime() + 16 * 60_000);
    telegram.editMessageWith(owner, { location: { latitude: 41.4, longitude: 2.18, horizontal_accuracy: 12 } });
    await settle(bot, () => eva.currentPlace()?.lat === 41.4);
    expect(telegram.sentTexts()).toHaveLength(1);
    expect(engine.requests).toEqual([]);
  });

  test("a new shared point counts at once, and a venue never counts", async () => {
    const bot = createBot();
    telegram.sendMessageWith(owner, { location: { latitude: 41.39, longitude: 2.17 } });
    await settle(bot, () => telegram.sentTexts().length === 1);
    telegram.sendMessageWith(owner, { venue: { title: "Cafe" }, location: { latitude: 1, longitude: 1 } });
    telegram.sendMessageWith(owner, { location: { latitude: 40.4, longitude: -3.7 } });
    await settle(bot, () => telegram.sentTexts().length === 3);
    expect(telegram.sentTexts()[1]).toBe("Eva cannot read places yet.");
    expect(eva.currentPlace()).toMatchObject({ lat: 40.4, source: "telegram" });
  });

  test("a location from a stranger never counts as the person's", async () => {
    const bot = createBot();
    telegram.sendMessageWith(9999, { location: { latitude: 1, longitude: 1 } });
    telegram.editMessageWith(9999, { location: { latitude: 1, longitude: 1 } });
    // A text after the two locations: its reply shows that the bot read all three.
    telegram.sendText(9999, "hi");
    await settle(bot, () => telegram.sentTexts().length === 1);
    expect(telegram.sentTexts()[0]).toContain("This bot is private");
    expect(eva.currentPlace()).toBeNull();
  });

  test("a failed download gets a sentence", async () => {
    const bot = createBot();
    telegram.failNext("getFile", 400, "Bad Request: file is too big");
    telegram.sendFile(owner, "document", new Uint8Array([1]), { fileName: "a.txt" });
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("could not be downloaded")));
  });
});

describe("voice notes (lesson 123)", () => {
  test("a voice note is echoed as Heard, then sent as the message", async () => {
    const heard: number[] = [];
    const bot = createBot(owner, {
      transcribe: (audio) => {
        heard.push(audio.length);
        return Promise.resolve(" Buy milk ");
      },
    });
    telegram.sendFile(owner, "voice", new Uint8Array([9, 9]));
    await settle(bot, () => engine.requests.length === 1);
    expect(heard).toEqual([2]);
    expect(telegram.sentTexts()).toContain("Heard: Buy milk");
    expect(engine.requests[0]?.prompt).toEndWith("Buy milk");
  });

  test("silence and a failed transcription each get a sentence", async () => {
    const results = [
      (): Promise<string> => Promise.resolve(""),
      (): Promise<string> => Promise.reject(new Error("whisper crashed")),
    ];
    const bot = createBot(owner, { transcribe: () => (results.shift() ?? (() => Promise.resolve("")))() });
    telegram.sendFile(owner, "voice", new Uint8Array([1]));
    telegram.sendFile(owner, "voice", new Uint8Array([2]));
    await settle(bot, () => telegram.sentTexts().length >= 2);
    expect(telegram.sentTexts()).toEqual([
      "The voice note holds no speech.",
      "The voice note could not be transcribed: whisper crashed",
    ]);
    expect(engine.requests).toEqual([]);
  });

  test("a machine without a transcriber says so", async () => {
    const bot = createBot();
    telegram.sendFile(owner, "voice", new Uint8Array([3]));
    await settle(bot, () => telegram.sentTexts().length >= 1);
    expect(telegram.sentTexts()[0]).toContain("not set up");
  });
});

describe("schedules (lessons 66, 70, 126)", () => {
  const vault = (): string => join(sandbox.root, "vault");
  const morning = { id: "morning", name: "Morning", at: "10:45", text: "Drink water.", prompt: "Plan my day." };

  function writeSchedules(schedules: unknown[]): void {
    sandbox.write(vault(), ".eva/schedules.json", JSON.stringify({ version: 1, schedules }));
  }

  test("a new schedule opens its topic with a setup card, then fires there in a fresh chat", async () => {
    writeSchedules([morning]);
    createEva((request) => FakeEngine.answer(request, "Your day: rest."));
    const bot = createBot();
    await eva.schedules?.tick();
    expect(telegram.callsTo("createForumTopic")[0]?.params).toMatchObject({ name: "Morning" });
    const card = telegram.callsTo("sendMessage").at(-1)?.params;
    expect(card).toMatchObject({ message_thread_id: 500 });
    expect(String(card?.["text"])).toContain("New schedule: Morning");
    expect(String(card?.["text"])).toContain("Next run: 2026-10-14 10:45 (UTC)");

    clock = new Date("2026-10-14T10:45:00Z");
    await eva.schedules?.tick();
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("Your day")));
    const answer = telegram.callsTo("sendMessage").find((call) => String(call.params["text"]).includes("Your day"));
    expect(answer?.params["message_thread_id"]).toBe(500);
    expect(telegram.sentTexts()).toContain("Drink water.");
    // The setup card showed the prompt already, so a firing does not repeat it.
    expect(telegram.sentTexts()).not.toContain("Message: Plan my day.");
    expect(telegram.callsTo("createForumTopic")).toHaveLength(1);
    expect(eva.sessions.list()[0]).toMatchObject({ title: "Morning", source: "schedule" });

    // The topic holds every run of the schedule, so a rename of one run keeps the topic's name.
    eva.sessions.rename(eva.sessions.list()[0]!.id, "Tuesday plan");
    await bot.pollOnce();
    expect(telegram.callsTo("editForumTopic")).toEqual([]);
  });

  test("a deleted firing chat leaves the schedule's topic, with the earlier firings in it", async () => {
    writeSchedules([morning]);
    createEva((request) => FakeEngine.answer(request, "Your day: rest."));
    const bot = createBot();
    await eva.schedules?.tick();
    clock = new Date("2026-10-14T10:45:00Z");
    await eva.schedules?.tick();
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("Your day")));
    await eva.idle();
    eva.sessions.delete(eva.sessions.list()[0]!.id);
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("This chat was deleted")));
    expect(telegram.callsTo("deleteForumTopic")).toEqual([]);
  });

  test("/delete in a schedule's topic deletes the firing's chat and keeps the topic", async () => {
    writeSchedules([morning]);
    createEva((request) => FakeEngine.answer(request, "Your day: rest."));
    const bot = createBot();
    await eva.schedules?.tick();
    clock = new Date("2026-10-14T10:45:00Z");
    await eva.schedules?.tick();
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("Your day")));
    await eva.idle();
    telegram.sendText(owner, "/delete", 500);
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("keeps the earlier firings")));
    telegram.pressButton(owner, "d:500", 500);
    await settle(bot, () => eva.sessions.list().length === 0);
    await settle(bot, () => telegram.sentTexts().some((text) => text.startsWith("Deleted.")));
    expect(telegram.callsTo("deleteForumTopic")).toEqual([]);
  });

  test("a schedule turned back on gets a card that says so (#188)", async () => {
    writeSchedules([morning]);
    createBot();
    await eva.schedules?.tick();
    writeSchedules([{ ...morning, enabled: false }]);
    await eva.schedules?.tick();
    writeSchedules([morning]);
    await eva.schedules?.tick();
    expect(telegram.sentTexts().at(-1)).toStartWith("Schedule turned on: Morning");
  });

  test("a schedule file sends its file; a changed schedule names the change", async () => {
    sandbox.write(vault(), "Methods/List.md", "- milk\n");
    writeSchedules([{ id: "list", name: "List", at: "10:45", file: "Methods/List.md" }]);
    createBot();
    await eva.schedules?.tick();
    writeSchedules([{ id: "list", name: "List", at: "10:50", file: "Methods/List.md" }]);
    await eva.schedules?.tick();
    expect(telegram.sentTexts().at(-1)).toContain("Schedule changed (at): List");
    clock = new Date("2026-10-14T10:50:00Z");
    await eva.schedules?.tick();
    expect(telegram.callsTo("sendDocument")).toHaveLength(1);
  });

  test("a topic deleted in the app is opened again (lesson 70)", async () => {
    writeSchedules([morning]);
    createBot();
    await eva.schedules?.tick();
    writeSchedules([{ ...morning, at: "11:00" }]);
    telegram.failNext("sendChatAction", 400, "Bad Request: message thread not found");
    await eva.schedules?.tick();
    expect(telegram.callsTo("createForumTopic")).toHaveLength(2);
  });

  test("when Telegram refuses a topic, the card goes to the main chat", async () => {
    writeSchedules([morning]);
    createBot();
    telegram.failNext("createForumTopic", 400, "Bad Request: the chat is not a forum");
    await eva.schedules?.tick();
    expect(telegram.callsTo("sendMessage").at(-1)?.params["message_thread_id"]).toBeUndefined();
  });

  test("a card that Telegram fails to send waits, and goes out again at the next check (lesson 66)", async () => {
    writeSchedules([morning]);
    createBot();
    telegram.failNext("sendMessage", 400, "Bad Request: chat not found");
    await eva.schedules?.tick();
    expect(eva.schedules?.waitingCards().map((card) => card.scheduleId)).toEqual(["morning"]);
    await eva.schedules?.tick();
    expect(telegram.sentTexts().at(-1)).toContain("New schedule: Morning");
    expect(eva.schedules?.waitingCards()).toEqual([]);
  });

  test("a card too long for one message waits for the web app: a cut card would hide the prompt (lesson 67)", async () => {
    writeSchedules([{ ...morning, text: "filler ".repeat(700) }]);
    createBot();
    await eva.schedules?.tick();
    expect(telegram.sentTexts().at(-1)).toContain("too long for Telegram");
    await eva.schedules?.tick();
    expect(telegram.sentTexts().filter((text) => text.includes("too long"))).toHaveLength(1);
    expect(eva.schedules?.waitingCards().map((card) => card.scheduleId)).toEqual(["morning"]);
  });

  test("a too-long notice that fails to go out goes out at the next check", async () => {
    writeSchedules([{ ...morning, text: "filler ".repeat(700) }]);
    createBot();
    telegram.failNext("sendMessage", 400, "Bad Request: chat not found");
    const notices = (): number => telegram.sentTexts().filter((text) => text.includes("too long")).length;
    await eva.schedules?.tick();
    await eva.schedules?.tick();
    await eva.schedules?.tick();
    // The fake records the failed call too: one failed try, then one notice that went out.
    expect(notices()).toBe(2);
  });

  test("before pairing, a card waits instead of counting as shown", async () => {
    writeSchedules([morning]);
    createBot(null);
    await eva.schedules?.tick();
    expect(eva.schedules?.waitingCards().map((card) => card.scheduleId)).toEqual(["morning"]);
  });

  test("file problems go to the main chat; nothing goes out before pairing", async () => {
    writeSchedules([{ id: "Bad" }]);
    createBot(null);
    await eva.schedules?.tick();
    expect(telegram.sentTexts()).toEqual([]);
    createEva();
    writeSchedules([{ id: "Bad" }]);
    createBot();
    await eva.schedules?.tick();
    expect(telegram.sentTexts().at(-1)).toStartWith("Schedules file problems:");
  });

  test("/schedules lists them with a remove button, and the button removes one", async () => {
    writeSchedules([morning, { ...morning, id: "evening", name: "Evening", enabled: false }, { id: "Bad" }]);
    const bot = createBot();
    telegram.sendText(owner, "/schedules");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    const listing = telegram.callsTo("sendMessage").at(-1)?.params;
    expect(String(listing?.["text"])).toContain("• Morning (morning), next: 2026-10-14 10:45");
    expect(String(listing?.["text"])).toContain("• Evening (evening), off");
    expect(String(listing?.["text"])).toContain("Schedules file problems:");
    expect(JSON.stringify(listing?.["reply_markup"])).toContain("s:morning");
    telegram.pressButton(owner, "s:morning");
    telegram.pressButton(owner, "s:morning");
    await settle(bot, () => telegram.sentTexts().length >= 3);
    expect(telegram.sentTexts().slice(1)).toEqual(["Removed the schedule morning.", "No schedule morning exists."]);
    writeSchedules([]);
    telegram.sendText(owner, "/schedules");
    await settle(bot, () => telegram.sentTexts().length >= 4);
    expect(telegram.sentTexts().at(-1)).toBe("No schedules. Ask Eva to create one.");
  });
});
