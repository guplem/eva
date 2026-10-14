import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../../../src/core/instance/home.ts";
import { HttpTelegramApi } from "../../../../src/frontends/telegram/telegram-api.ts";
import { TelegramBot } from "../../../../src/frontends/telegram/telegram-bot.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { FakeEngine, type FakeTurnScript } from "../../../support/fake-engine.ts";
import { FakeTelegram } from "../../../support/fake-telegram.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox } from "../../../support/git-sandbox.ts";

const owner = 4242;
let sandbox: GitSandbox;
let home: string;
let telegram: FakeTelegram;
let engine: FakeEngine;
let eva: Eva;
let paired: number[];
let fatal: number[];

function createEva(script?: FakeTurnScript): void {
  engine = new FakeEngine(script);
  eva = new Eva({
    paths: homePaths(home),
    config: { ...defaultConfig, vaultPath: sandbox.root + "/vault", timeZone: "UTC" },
    secrets: {},
    engines: [engine],
    runner: systemProcessRunner,
    processEnvironment: gitEnvironment,
    now: () => new Date("2026-10-14T10:30:00Z"),
    basePrompt: "Base.",
    gatherMs: 5,
  });
}

function createBot(allowedChatId: number | null = owner): TelegramBot {
  return new TelegramBot({
    api: new HttpTelegramApi({ token: telegram.token, baseUrl: telegram.baseUrl }),
    eva,
    statePath: join(home, "state", "telegram.json"),
    allowedChatId,
    pairingCode: "PAIR-1234",
    onPaired: (chatId) => paired.push(chatId),
    onFatal: (code) => fatal.push(code),
    pollTimeoutSeconds: 0,
    typingIntervalMs: 20,
  });
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
  fatal = [];
  createEva();
});
afterEach(async () => {
  await eva.idle();
  eva.stop();
  telegram.stop();
  sandbox.dispose();
  rmSync(home, { recursive: true, force: true });
});

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
    telegram.sendText(owner, "/delete");
    await settle(bot, () => telegram.sentTexts().some((text) => text.includes("only inside a topic")));
  });
});

describe("approvals and commands", () => {
  test("an approval becomes buttons, and the press answers the turn (plan §5.5)", async () => {
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

  test("the commands are registered with Telegram", async () => {
    const bot = createBot();
    await bot.registerCommands();
    expect(JSON.stringify(telegram.callsTo("setMyCommands")[0]?.params)).toContain("new");
  });
});

describe("one poller per bot (lessons 56, 57)", () => {
  test("three conflicts stop Eva with exit code 3, even with a success between them", async () => {
    const bot = createBot();
    telegram.failNext("getUpdates", 409, "Conflict: terminated by other getUpdates request", 2);
    await bot.pollOnce();
    await bot.pollOnce();
    await bot.pollOnce();
    telegram.failNext("getUpdates", 409, "Conflict", 1);
    await bot.pollOnce();
    expect(fatal).toEqual([3]);
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
