import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Scheduler, type ScheduleEvent } from "../../../../src/core/schedules/scheduler.ts";
import type { ModelAlias } from "../../../../src/shared/engine-port.ts";

let folder: string;
let vault: string;
let clock: Date;
let chats: { name: string; model: ModelAlias; sessionId: string }[];
let sent: { sessionId: string; prompt: string }[];
let events: ScheduleEvent[];
let logged: string[];
/** Schedule names whose chat creation throws. */
let failingChats: Set<string>;
let failingSends: boolean;

beforeEach(() => {
  logged = [];
  failingChats = new Set();
  failingSends = false;
  folder = mkdtempSync(join(tmpdir(), "eva-scheduler-"));
  vault = join(folder, "vault");
  mkdirSync(join(vault, ".eva"), { recursive: true });
  clock = new Date("2026-07-01T05:00:00Z");
  chats = [];
  sent = [];
  events = [];
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function writeSchedules(schedules: unknown[]): void {
  writeFileSync(join(vault, ".eva", "schedules.json"), JSON.stringify({ version: 1, schedules }));
}

function createScheduler(isHub = true): Scheduler {
  const scheduler = new Scheduler({
    vaultPath: vault,
    statePath: join(folder, "state", "schedules-state.json"),
    timeZone: "Europe/Madrid",
    isHub: () => isHub,
    now: () => clock,
    chats: {
      createChat: (name, model) => {
        if (failingChats.has(name)) throw new Error(`no chat for ${name}`);
        const sessionId = `session-${String(chats.length + 1)}`;
        chats.push({ name, model, sessionId });
        return sessionId;
      },
      send: (sessionId, prompt) => {
        sent.push({ sessionId, prompt });
        return failingSends ? Promise.reject(new Error("the engine is gone")) : Promise.resolve();
      },
    },
    logger: { log: (level, message) => logged.push(`${level} ${message}`) },
  });
  scheduler.subscribe((event) => {
    events.push(event);
  });
  return scheduler;
}

const morning = { id: "morning", name: "Morning", at: "07:30", text: "Drink water.", prompt: "Plan my day." };

describe("Scheduler", () => {
  test("a new schedule gets a setup card first, then fires at its time in a fresh chat (lessons 66, 126)", async () => {
    writeSchedules([{ ...morning, model: "haiku" }]);
    const scheduler = createScheduler();
    await scheduler.tick();
    expect(events).toEqual([
      {
        kind: "schedule_card",
        scheduleId: "morning",
        name: "Morning",
        fields: {
          id: "morning",
          name: "Morning",
          at: "07:30",
          days: "sun, mon, tue, wed, thu, fri, sat",
          text: "Drink water.",
          prompt: "Plan my day.",
          model: "haiku",
        },
        changed: [],
        nextRun: "2026-07-01T07:30",
        timeZone: "Europe/Madrid",
      },
    ]);
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    await scheduler.tick();
    expect(events.slice(1)).toEqual([
      {
        kind: "schedule_fired",
        scheduleId: "morning",
        name: "Morning",
        text: "Drink water.",
        file: null,
        sessionId: "session-1",
      },
    ]);
    expect(chats).toEqual([{ name: "Morning", model: "haiku", sessionId: "session-1" }]);
    expect(sent).toEqual([{ sessionId: "session-1", prompt: "Plan my day." }]);
    clock = new Date("2026-07-02T05:30:00Z");
    await scheduler.tick();
    expect(chats.map((chat) => chat.sessionId)).toEqual(["session-1", "session-2"]);
  });

  test("a schedule without a prompt fires without a chat, and an unknown model means the default", async () => {
    writeSchedules([
      { id: "water", name: "Water", at: "07:30", text: "Drink." },
      { ...morning, model: "gpt" },
    ]);
    clock = new Date("2026-07-01T05:20:00Z");
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    const fired = events.filter((event) => event.kind === "schedule_fired");
    expect(fired.map((event) => event.sessionId)).toEqual([null, "session-1"]);
    expect(chats[0]?.model).toBe("default");
  });

  test("a changed schedule gets a card that names the change, once", async () => {
    writeSchedules([morning]);
    const scheduler = createScheduler();
    await scheduler.tick();
    writeSchedules([{ ...morning, at: "08:00" }]);
    await scheduler.tick();
    await scheduler.tick();
    const cards = events.filter((event) => event.kind === "schedule_card");
    expect(cards.map((card) => card.changed)).toEqual([[], ["at"]]);
  });

  test("the state survives a restart: no second card and no second firing", async () => {
    writeSchedules([morning]);
    clock = new Date("2026-07-01T05:20:00Z");
    await createScheduler().tick();
    clock = new Date("2026-07-01T05:30:00Z");
    await createScheduler().tick();
    await createScheduler().tick();
    expect(events.map((event) => event.kind)).toEqual(["schedule_card", "schedule_fired"]);
  });

  test("a broken state file costs one new card, never a crash (lesson 54)", async () => {
    writeSchedules([morning]);
    mkdirSync(join(folder, "state"), { recursive: true });
    writeFileSync(join(folder, "state", "schedules-state.json"), "{ broken");
    await createScheduler().tick();
    expect(events.map((event) => event.kind)).toEqual(["schedule_card"]);
  });

  test("one bad state entry is skipped, the others are kept (lesson 69)", async () => {
    writeSchedules([morning, { ...morning, id: "evening" }]);
    await createScheduler().tick();
    const statePath = join(folder, "state", "schedules-state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { schedules: Record<string, unknown> };
    state.schedules["evening"] = { firstSeen: 5 };
    writeFileSync(statePath, JSON.stringify(state));
    events = [];
    await createScheduler().tick();
    expect(events.map((event) => (event.kind === "schedule_card" ? event.scheduleId : event.kind))).toEqual([
      "evening",
    ]);
  });

  test("file problems are said once, until they change", async () => {
    writeSchedules([{ id: "Bad" }]);
    const scheduler = createScheduler();
    await scheduler.tick();
    await scheduler.tick();
    writeSchedules([]);
    await scheduler.tick();
    writeSchedules([{ id: "Bad" }]);
    await scheduler.tick();
    expect(events.filter((event) => event.kind === "schedule_problems")).toHaveLength(2);
  });

  test("a satellite instance never fires a schedule (lesson 118)", async () => {
    writeSchedules([morning]);
    await createScheduler(false).tick();
    expect(events).toEqual([]);
  });

  test("a listener that throws does not stop the others or the firing", async () => {
    writeSchedules([morning]);
    const scheduler = createScheduler();
    scheduler.subscribe(() => {
      throw new Error("front end down");
    });
    await scheduler.tick();
    expect(events).toHaveLength(1);
  });

  test("a tick that overlaps a running tick does nothing", async () => {
    writeSchedules([morning]);
    const scheduler = createScheduler();
    let release = (): void => undefined;
    const unsubscribe = scheduler.subscribe(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = scheduler.tick();
    await scheduler.tick();
    unsubscribe();
    release();
    await first;
    expect(events).toHaveLength(1);
  });

  test("list, save and remove go through the vault file and forget the removed state", async () => {
    const scheduler = createScheduler();
    scheduler.save(morning);
    expect(scheduler.list()).toEqual({
      schedules: [
        {
          schedule: {
            id: "morning",
            name: "Morning",
            at: "07:30",
            days: [0, 1, 2, 3, 4, 5, 6],
            text: "Drink water.",
            file: null,
            prompt: "Plan my day.",
            model: null,
          },
          nextRun: "2026-07-01T07:30",
        },
      ],
      problems: [],
    });
    await scheduler.tick();
    expect(scheduler.remove("morning")).toBe(true);
    expect(scheduler.remove("morning")).toBe(false);
    scheduler.save(morning);
    await scheduler.tick();
    expect(events.filter((event) => event.kind === "schedule_card")).toHaveLength(2);
  });

  test("a changed schedule that is already due shows its card and does not fire then (lessons 66, 67)", async () => {
    writeSchedules([morning]);
    clock = new Date("2026-07-01T04:00:00Z");
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:00:00Z"); // 07:00 in Madrid
    writeSchedules([{ ...morning, at: "06:59", prompt: "Something someone pushed." }]);
    await scheduler.tick();
    await scheduler.tick();
    expect(events.map((event) => event.kind)).toEqual(["schedule_card", "schedule_card"]);
    expect(chats).toEqual([]);
  });

  test("a schedule that fails to fire never stops the others, and goes to the log", async () => {
    writeSchedules([morning, { ...morning, id: "evening", name: "Evening" }]);
    failingChats.add("Morning");
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    expect(chats.map((chat) => chat.name)).toEqual(["Evening"]);
    expect(logged.join("\n")).toContain("error");
  });

  test("a schedule whose chat was not created fires again at the next check", async () => {
    writeSchedules([morning]);
    failingChats.add("Morning");
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    expect(events.filter((event) => event.kind === "schedule_fired")).toEqual([]);
    failingChats.clear();
    await scheduler.tick();
    expect(chats.map((chat) => chat.name)).toEqual(["Morning"]);
  });

  test("a prompt that fails after the chat started goes to the log, and the slot counts as fired", async () => {
    writeSchedules([morning]);
    failingSends = true;
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    await scheduler.tick();
    expect(chats).toHaveLength(1);
    expect(logged.join("\n")).toContain("error");
  });
});
