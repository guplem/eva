import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva, type EvaOptions } from "../../../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../../../src/core/settings/home.ts";
import { HttpTelegramApi, TelegramError, type TelegramApi } from "../../../../src/frontends/telegram/telegram-api.ts";
import { TelegramBot, type TelegramBotOptions } from "../../../../src/frontends/telegram/telegram-bot.ts";
import type { LogLevel } from "../../../../src/shared/logger.ts";
import { type ProcessRunner, systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { FakeEngine, type FakeTurnScript } from "../../../support/fake-engine.ts";
import { FakeTelegram } from "../../../support/fake-telegram.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

const owner = 4242;
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
    config: { ...defaultConfig, vaultPath: sandbox.root + "/vault", timeZone: "UTC" },
    secrets: {},
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

async function settle(bot: TelegramBot, until: () => boolean, rounds = 400): Promise<void> {
  for (let round = 0; round < rounds && !until(); round += 1) {
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

describe("a group chat (security review)", () => {
  test("pairing keeps the person who paired, and only that person may act or press a button", async () => {
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
    telegram.sendText(owner, "/status");
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
    telegram.sendText(owner, "/delete");
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("only inside a topic")));
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
      { text: "Write the letter", callback_data: `c:${newer}` },
      { text: "Plan the garden", callback_data: `c:${older}` },
    ]);
  });

  test("a press opens a topic with the last turns, and the topic continues the web chat", async () => {
    const sessionId = await webChat("one");
    for (const text of ["two", "three", "four"]) await eva.sessions.send(sessionId, text);
    const bot = createBot();
    telegram.pressButton(owner, `c:${sessionId}`);
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
    telegram.pressButton(owner, `c:${sessionId}`);
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
    telegram.pressButton(owner, `c:${sessionId}`);
    await settle(bot, () => telegram.callsTo("createForumTopic").length === 1);
    telegram.pressButton(owner, `c:${sessionId}`);
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("already has its topic")));
    expect(telegram.callsTo("createForumTopic")).toHaveLength(1);
  });

  test("in a supergroup, the answer to a press links to the topic", async () => {
    const group = -1009876;
    const sessionId = await webChat("one");
    const bot = createBot(group);
    telegram.pressButton(group, `c:${sessionId}`, undefined, owner);
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("https://t.me/c/9876/500")));
  });

  test("without topics, a press makes the main chat continue that chat", async () => {
    const sessionId = await webChat("one");
    const bot = createBot();
    telegram.failNext("createForumTopic", 400, "Bad Request: the chat is not a forum");
    telegram.pressButton(owner, `c:${sessionId}`);
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
    telegram.pressButton(owner, `c:${other.id}`);
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("still working")));
    for (const session of eva.sessions.list()) eva.sessions.stop(session.id);
  });

  test("a press on a deleted chat says so", async () => {
    const bot = createBot();
    telegram.pressButton(owner, "c:gone");
    await settle(bot, () => telegram.sentTexts().includes("That chat no longer exists."));
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

  test("/sync syncs the vault, and /update says when this Eva cannot update herself", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/sync");
    telegram.sendText(owner, "/update");
    telegram.sendText(owner, "/link");
    await settle(bot, () => telegram.sentTexts().length >= 5);
    const texts = telegram.sentTexts().join("\n");
    expect(texts).toContain("Syncing…");
    expect(texts).toContain("Updating…");
    expect(texts).toContain("Vault sync:");
    expect(texts).toContain("This Eva cannot update herself.");
    expect(texts).toContain("On this machine only (advanced): http://127.0.0.1:");
    expect(engine.requests).toEqual([]);
  });

  test("/update installs a newer Eva and restarts her, after the running chat ends (lesson 92)", async () => {
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
          check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true }),
          apply: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false }),
        },
        restartForUpdate: () => restarts.push("restart"),
      },
    );
    const bot = createBot();
    const session = eva.createAssistantSession({ source: "cli", model: "default" });
    const turn = eva.sessions.send(session.id, "work");
    for (let round = 0; round < 400 && engine.requests.length === 0; round += 1) await Bun.sleep(5);
    telegram.sendText(owner, "/update");
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
    expect(telegram.callsTo("createForumTopic")).toHaveLength(1);
    expect(eva.sessions.list()[0]).toMatchObject({ title: "Morning", source: "schedule" });
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
    writeSchedules([morning, { id: "Bad" }]);
    const bot = createBot();
    telegram.sendText(owner, "/schedules");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    const listing = telegram.callsTo("sendMessage").at(-1)?.params;
    expect(String(listing?.["text"])).toContain("• Morning (morning), next: 2026-10-14 10:45");
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
