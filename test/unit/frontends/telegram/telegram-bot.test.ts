import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../../../src/core/instance/home.ts";
import { HttpTelegramApi } from "../../../../src/frontends/telegram/telegram-api.ts";
import { TelegramBot, type TelegramBotOptions } from "../../../../src/frontends/telegram/telegram-bot.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
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
let fatal: number[];
let clock: Date;

function createEva(script?: FakeTurnScript): void {
  engine = new FakeEngine(script);
  eva = new Eva({
    paths: homePaths(home),
    config: { ...defaultConfig, vaultPath: sandbox.root + "/vault", timeZone: "UTC" },
    secrets: {},
    engines: [engine],
    runner: systemProcessRunner,
    processEnvironment: gitEnvironment,
    now: () => clock,
    basePrompt: "Base.",
    gatherMs: 5,
  });
}

function createBot(allowedChatId: number | null = owner, extra: Partial<TelegramBotOptions> = {}): TelegramBot {
  return new TelegramBot({
    api: new HttpTelegramApi({ token: telegram.token, baseUrl: telegram.baseUrl }),
    eva,
    statePath: join(home, "state", "telegram.json"),
    allowedChatId,
    allowedUserId: null,
    pairingCode: "PAIR-1234",
    onPaired: (chatId) => paired.push(chatId),
    onFatal: (code) => fatal.push(code),
    pollTimeoutSeconds: 0,
    typingIntervalMs: 20,
    ...extra,
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

  test("/sync syncs the vault, and /update says when this Eva cannot update herself", async () => {
    const bot = createBot();
    telegram.sendText(owner, "/sync");
    await settle(bot, () => telegram.sentTexts().length >= 1);
    telegram.sendText(owner, "/update");
    await settle(bot, () => telegram.sentTexts().length >= 2);
    const texts = telegram.sentTexts().join("\n");
    expect(texts).toContain("Vault sync:");
    expect(texts).toContain("This Eva cannot update herself.");
    expect(engine.requests).toEqual([]);
  });

  test("the commands are registered with Telegram", async () => {
    const bot = createBot();
    await bot.registerCommands();
    expect(JSON.stringify(telegram.callsTo("setMyCommands")[0]?.params)).toContain("new");
  });
});

describe("stop and approvals from elsewhere (plan §4.1, §5.5)", () => {
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
    await settle(bot, () =>
      telegram.sentTexts().some((text) => text.includes("The turn failed: The turn was stopped.")),
    );
    expect(telegram.sentTexts()).toContain("Stopping.");
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

describe("schedules (plan §9, lessons 66, 70, 126)", () => {
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
