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
/** A send that resolves to the failure of its last turn, as the session manager does. */
let failingSends: boolean;
/** A send that rejects, which only a bug can cause. */
let rejectingSends: boolean;
/** Runs in each send, such as to break the state file while the turn runs. */
let duringSend: () => void;
/** The next send returns this result, so a test chooses when the turn ends. */
let heldSend: Promise<string | null> | null;
/** A report of a failed firing throws. */
let failingReports: boolean;
/** Each firing result: the schedule name and the failure, or null for a success. */
let firings: { name: string; failure: string | null }[];
/** What the test listener answers: true when it showed the event to the person. */
let shows: boolean;
/** Each waiting-card report: the schedule id, its name, and whether its card waits. */
let cardReports: { scheduleId: string; name: string; waiting: boolean }[];

beforeEach(() => {
  logged = [];
  failingChats = new Set();
  failingSends = false;
  rejectingSends = false;
  duringSend = () => undefined;
  heldSend = null;
  failingReports = false;
  firings = [];
  shows = true;
  cardReports = [];
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
        duringSend();
        if (heldSend !== null) {
          const held = heldSend;
          heldSend = null;
          return held;
        }
        if (rejectingSends) return Promise.reject(new Error("the engine is gone"));
        return Promise.resolve(failingSends ? "You hit the usage limit." : null);
      },
    },
    logger: { log: (level, message) => logged.push(`${level} ${message}`) },
    reportFiring: (schedule, failure) => {
      if (failure !== null && failingReports) throw new Error("The alert list is broken.");
      firings.push({ name: schedule.name, failure });
    },
    reportCard: (scheduleId, name, waiting) => cardReports.push({ scheduleId, name, waiting }),
  });
  scheduler.subscribe((event) => {
    events.push(event);
    return shows;
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
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    const first = scheduler.tick();
    await scheduler.tick();
    unsubscribe();
    release();
    await first;
    expect(events).toHaveLength(1);
  });

  test("isFiring holds while a check runs, so an update waits for a firing schedule (lesson 92)", async () => {
    writeSchedules([morning]);
    const scheduler = createScheduler();
    let release = (): void => undefined;
    const unsubscribe = scheduler.subscribe(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    expect(scheduler.isFiring()).toBe(false);
    const tick = scheduler.tick();
    expect(scheduler.isFiring()).toBe(true);
    unsubscribe();
    release();
    await tick;
    expect(scheduler.isFiring()).toBe(false);
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
            enabled: true,
            every: null,
            from: null,
          },
          nextRun: "2026-07-01T07:30",
          runsToday: ["07:30"],
          lastRun: null,
        },
      ],
      problems: [],
      timeZone: "Europe/Madrid",
      now: "2026-07-01T07:00",
    });
    await scheduler.tick();
    expect(scheduler.remove("morning")).toBe(true);
    expect(scheduler.remove("morning")).toBe(false);
    scheduler.save(morning);
    await scheduler.tick();
    expect(events.filter((event) => event.kind === "schedule_card")).toHaveLength(2);
  });

  test("an edit needs a card that names the change, and an edit of a paused schedule keeps it off", async () => {
    writeSchedules([morning, { ...morning, id: "evening", enabled: false }]);
    clock = new Date("2026-07-01T05:20:00Z");
    const scheduler = createScheduler();
    await scheduler.tick();
    expect(scheduler.edit("morning", { name: "Morning", at: "08:00", prompt: "Plan my day." })?.at).toBe("08:00");
    expect(scheduler.edit("evening", { name: "Evening", at: "20:00", text: "Rest." })?.enabled).toBe(false);
    expect(scheduler.edit("nobody", { name: "Nobody", at: "20:00", text: "Rest." })).toBeNull();
    await scheduler.tick();
    const cards = events.filter((event) => event.kind === "schedule_card");
    expect(cards.map((card) => [card.scheduleId, card.changed])).toEqual([
      ["morning", []],
      ["morning", ["at", "text"]],
    ]);
  });

  test("a schedule that is off never fires, and turning it off needs no card", async () => {
    writeSchedules([morning]);
    clock = new Date("2026-07-01T05:20:00Z");
    const scheduler = createScheduler();
    await scheduler.tick();
    writeSchedules([{ ...morning, enabled: false }]);
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    clock = new Date("2026-07-02T05:30:00Z");
    await scheduler.tick();
    expect(events.map((event) => event.kind)).toEqual(["schedule_card"]);
    expect(scheduler.list().schedules[0]?.nextRun).toBeNull();
  });

  test("turning a schedule back on needs a new card that names the change (lesson 67)", async () => {
    writeSchedules([morning]);
    clock = new Date("2026-07-01T05:20:00Z");
    const scheduler = createScheduler();
    await scheduler.tick();
    writeSchedules([{ ...morning, enabled: false }]);
    await scheduler.tick();
    writeSchedules([morning]);
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    const cards = events.filter((event) => event.kind === "schedule_card");
    expect(cards.map((card) => card.changed)).toEqual([[], ["enabled"]]);
    // The card skips the slot that was due when it showed, so nothing runs before the person saw it.
    expect(events.some((event) => event.kind === "schedule_fired")).toBe(false);
    clock = new Date("2026-07-02T05:30:00Z");
    await scheduler.tick();
    expect(events.at(-1)?.kind).toBe("schedule_fired");
  });

  test("a card that waits stops waiting when its schedule turns off, and cannot be confirmed", async () => {
    shows = false;
    writeSchedules([morning]);
    const scheduler = createScheduler();
    await scheduler.tick();
    expect(scheduler.waitingCards()).toHaveLength(1);
    const card = scheduler.waitingCards()[0];
    writeSchedules([{ ...morning, enabled: false }]);
    await scheduler.tick();
    expect(scheduler.waitingCards()).toEqual([]);
    expect(scheduler.confirmCard("morning", card?.fields ?? {})).toBe(false);
  });

  test("a pause through setEnabled counts at once, so off and on before a check still needs a card", async () => {
    writeSchedules([morning]);
    clock = new Date("2026-07-01T05:20:00Z");
    const scheduler = createScheduler();
    await scheduler.tick();
    scheduler.setEnabled("morning", false);
    scheduler.setEnabled("morning", true);
    await scheduler.tick();
    const cards = events.filter((event) => event.kind === "schedule_card");
    expect(cards.map((card) => card.changed)).toEqual([[], ["enabled"]]);
  });

  test("a pause made while a card goes out stays, so on again needs a card", async () => {
    writeSchedules([morning]);
    clock = new Date("2026-07-01T05:20:00Z");
    const scheduler = createScheduler();
    await scheduler.tick();
    scheduler.setEnabled("morning", false);
    scheduler.setEnabled("morning", true);
    let release = (): void => undefined;
    const slow = new Promise<void>((resolve) => (release = resolve));
    // A front end that takes long to show the card, such as Telegram opening a topic.
    scheduler.subscribe(async () => {
      await slow;
      return true;
    });
    const sending = scheduler.tick();
    await Bun.sleep(0);
    scheduler.setEnabled("morning", false);
    scheduler.setEnabled("morning", true);
    release();
    await sending;
    await scheduler.tick();
    const cards = events.filter((event) => event.kind === "schedule_card");
    expect(cards.map((card) => card.changed)).toEqual([[], ["enabled"], ["enabled"]]);
  });

  test("off changes the entry that runs, not an invalid one with the same id", () => {
    writeSchedules([{ ...morning, at: "25:00" }, morning]);
    const scheduler = createScheduler();
    expect(scheduler.setEnabled("morning", false)).toBe(true);
    expect(scheduler.list().schedules[0]?.schedule.enabled).toBe(false);
  });

  test("a schedule that is off from the start gets a first card when it turns on", async () => {
    writeSchedules([{ ...morning, enabled: false }]);
    clock = new Date("2026-07-01T05:30:00Z");
    const scheduler = createScheduler();
    await scheduler.tick();
    expect(events).toEqual([]);
    writeSchedules([morning]);
    await scheduler.tick();
    expect(events.map((event) => (event.kind === "schedule_card" ? event.changed : event.kind))).toEqual([[]]);
  });

  test("a state file from before the paused field keeps firing with no new card", async () => {
    writeSchedules([morning]);
    clock = new Date("2026-07-01T05:20:00Z");
    await createScheduler().tick();
    const statePath = join(folder, "state", "schedules-state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { schedules: Record<string, Record<string, unknown>> };
    const { paused: _paused, ...old } = state.schedules["morning"] ?? {};
    writeFileSync(statePath, JSON.stringify({ version: 1, schedules: { morning: old } }));
    events = [];
    clock = new Date("2026-07-01T05:30:00Z");
    await createScheduler().tick();
    expect(events.map((event) => event.kind)).toEqual(["schedule_fired"]);
  });

  test("setEnabled writes the vault file, and false means no such schedule", () => {
    const scheduler = createScheduler();
    scheduler.save(morning);
    expect(scheduler.setEnabled("morning", false)).toBe(true);
    expect(scheduler.list().schedules[0]?.schedule.enabled).toBe(false);
    expect(scheduler.setEnabled("nobody", true)).toBe(false);
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

  test("each firing reports its result: a failure with its reason, then a success", async () => {
    writeSchedules([morning]);
    failingChats.add("Morning");
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    failingChats.clear();
    await scheduler.tick();
    expect(firings).toEqual([
      { name: "Morning", failure: "no chat for Morning" },
      { name: "Morning", failure: null },
    ]);
  });

  test("a prompt whose turn fails after the chat started reports a failed firing, and logs it", async () => {
    writeSchedules([morning]);
    failingSends = true;
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    await Bun.sleep(0);
    expect(firings).toEqual([
      { name: "Morning", failure: null },
      { name: "Morning", failure: "You hit the usage limit." },
    ]);
    expect(logged).toContain("error A scheduled prompt failed.");
  });

  test("a failed prompt still reaches the alert when its run cannot be recorded", async () => {
    writeSchedules([morning]);
    failingSends = true;
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    // A folder where the state file was: each write of the state fails.
    const statePath = join(folder, "state", "schedules-state.json");
    duringSend = () => {
      rmSync(statePath, { force: true });
      mkdirSync(statePath);
    };
    await scheduler.tick();
    await Bun.sleep(0);
    expect(firings).toEqual([
      { name: "Morning", failure: null },
      { name: "Morning", failure: "You hit the usage limit." },
    ]);
    expect(logged).toContain("error Eva could not record the failed run.");
  });

  test("a failure that ends after a newer run fired changes neither that run nor the alert", async () => {
    writeSchedules([morning]);
    const scheduler = createScheduler();
    await scheduler.tick();
    let endFirstTurn = (_failure: string | null): void => undefined;
    heldSend = new Promise((resolve) => {
      endFirstTurn = resolve;
    });
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    clock = new Date("2026-07-02T05:30:00Z");
    await scheduler.tick();
    await Bun.sleep(0);
    endFirstTurn("You hit the usage limit.");
    await Bun.sleep(0);
    expect(firings).toEqual([
      { name: "Morning", failure: null },
      { name: "Morning", failure: null },
    ]);
    expect(scheduler.list().schedules[0]?.lastRun).toEqual({ slot: "2026-07-02T07:30", failed: false });
    expect(logged).toContain("error A scheduled prompt failed.");
  });

  test("a failure still counts when the person edits the schedule while its prompt runs", async () => {
    writeSchedules([morning]);
    const scheduler = createScheduler();
    await scheduler.tick();
    let endTurn = (_failure: string | null): void => undefined;
    heldSend = new Promise((resolve) => {
      endTurn = resolve;
    });
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    // The new card skips the slot that is due now, so the last fired slot moves.
    writeSchedules([{ ...morning, at: "07:40" }]);
    clock = new Date("2026-07-01T05:45:00Z");
    await scheduler.tick();
    endTurn("You hit the usage limit.");
    await Bun.sleep(0);
    expect(firings).toContainEqual({ name: "Morning", failure: "You hit the usage limit." });
    expect(scheduler.list().schedules[0]?.lastRun).toEqual({ slot: "2026-07-01T07:30", failed: true });
  });

  test("a failed run is recorded even when its report throws", async () => {
    writeSchedules([morning]);
    failingSends = true;
    failingReports = true;
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    await Bun.sleep(0);
    expect(scheduler.list().schedules[0]?.lastRun).toEqual({ slot: "2026-07-01T07:30", failed: true });
    expect(logged).toContain("error Eva could not report the failed run.");
  });

  test("a send that rejects reports a failed firing too", async () => {
    writeSchedules([morning]);
    rejectingSends = true;
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    await Bun.sleep(0);
    expect(firings).toEqual([
      { name: "Morning", failure: null },
      { name: "Morning", failure: "the engine is gone" },
    ]);
  });

  describe("the last run in the list", () => {
    const lastRun = (scheduler: Scheduler): unknown => scheduler.list().schedules[0]?.lastRun;

    test("is null until the schedule runs, and a good run gives its slot", async () => {
      writeSchedules([morning]);
      const scheduler = createScheduler();
      await scheduler.tick();
      expect(lastRun(scheduler)).toBeNull();
      clock = new Date("2026-07-01T05:30:00Z");
      await scheduler.tick();
      expect(lastRun(scheduler)).toEqual({ slot: "2026-07-01T07:30", failed: false });
    });

    test("a slot that the setup card skips is not a run", async () => {
      writeSchedules([morning]);
      clock = new Date("2026-07-01T04:00:00Z");
      const scheduler = createScheduler();
      await scheduler.tick();
      clock = new Date("2026-07-01T05:00:00Z"); // 07:00 in Madrid
      writeSchedules([{ ...morning, at: "06:59" }]);
      await scheduler.tick();
      await scheduler.tick();
      expect(chats).toEqual([]);
      expect(lastRun(scheduler)).toBeNull();
    });

    test("a chat that does not start is a failed run, and the next good run replaces it", async () => {
      writeSchedules([morning]);
      failingChats.add("Morning");
      const scheduler = createScheduler();
      await scheduler.tick();
      clock = new Date("2026-07-01T05:30:00Z");
      await scheduler.tick();
      expect(lastRun(scheduler)).toEqual({ slot: "2026-07-01T07:30", failed: true });
      failingChats.clear();
      await scheduler.tick();
      expect(lastRun(scheduler)).toEqual({ slot: "2026-07-01T07:30", failed: false });
    });

    test("a prompt that fails after its chat started is a failed run, and it survives a restart", async () => {
      writeSchedules([morning]);
      failingSends = true;
      const scheduler = createScheduler();
      await scheduler.tick();
      clock = new Date("2026-07-01T05:30:00Z");
      await scheduler.tick();
      await Bun.sleep(0);
      expect(lastRun(scheduler)).toEqual({ slot: "2026-07-01T07:30", failed: true });
      expect(lastRun(createScheduler())).toEqual({ slot: "2026-07-01T07:30", failed: true });
    });

    test("a state file from before the last run reads as no run yet", () => {
      writeSchedules([morning]);
      mkdirSync(join(folder, "state"), { recursive: true });
      writeFileSync(
        join(folder, "state", "schedules-state.json"),
        JSON.stringify({
          version: 1,
          schedules: {
            morning: { firstSeen: "2026-06-01T00:00", lastFired: "2026-06-30T07:30", announced: null },
          },
        }),
      );
      expect(lastRun(createScheduler())).toBeNull();
    });
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

  describe("a card that no front end shows (lessons 66, 67)", () => {
    test("the schedule never fires, the card goes out again at each check, and the wait is reported", async () => {
      writeSchedules([morning]);
      shows = false;
      const scheduler = createScheduler();
      await scheduler.tick();
      clock = new Date("2026-07-01T05:30:00Z");
      await scheduler.tick();
      expect(events.map((event) => event.kind)).toEqual(["schedule_card", "schedule_card"]);
      expect(chats).toEqual([]);
      expect(cardReports.at(-1)).toEqual({ scheduleId: "morning", name: "Morning", waiting: true });
      expect(scheduler.waitingCards().map((card) => card.scheduleId)).toEqual(["morning"]);
    });

    test("a card shown later skips the slot that is due then, and clears the wait", async () => {
      writeSchedules([morning]);
      shows = false;
      const scheduler = createScheduler();
      await scheduler.tick();
      shows = true;
      clock = new Date("2026-07-01T05:30:00Z");
      await scheduler.tick();
      await scheduler.tick();
      expect(events.map((event) => event.kind)).toEqual(["schedule_card", "schedule_card"]);
      expect(chats).toEqual([]);
      expect(cardReports.at(-1)).toEqual({ scheduleId: "morning", name: "Morning", waiting: false });
      expect(scheduler.waitingCards()).toEqual([]);
      clock = new Date("2026-07-02T05:30:00Z");
      await scheduler.tick();
      expect(chats.map((chat) => chat.name)).toEqual(["Morning"]);
    });

    test("a listener that throws does not count as shown", async () => {
      writeSchedules([morning]);
      shows = false;
      const scheduler = createScheduler();
      scheduler.subscribe(() => {
        throw new Error("front end down");
      });
      await scheduler.tick();
      expect(scheduler.waitingCards()).toHaveLength(1);
    });

    test("a waiting card follows a change to its schedule", async () => {
      writeSchedules([morning]);
      shows = false;
      const scheduler = createScheduler();
      await scheduler.tick();
      writeSchedules([{ ...morning, at: "08:00" }]);
      await scheduler.tick();
      expect(scheduler.waitingCards().map((card) => card.fields.at)).toEqual(["08:00"]);
    });

    test("a confirmed card counts as shown, but only with the fields that wait", async () => {
      writeSchedules([morning]);
      shows = false;
      const scheduler = createScheduler();
      await scheduler.tick();
      const [card] = scheduler.waitingCards();
      expect(scheduler.confirmCard("morning", { ...card?.fields, at: "06:00" })).toBe(false);
      expect(scheduler.confirmCard("evening", card?.fields ?? {})).toBe(false);
      expect(scheduler.confirmCard("morning", card?.fields ?? {})).toBe(true);
      expect(scheduler.waitingCards()).toEqual([]);
      expect(cardReports.at(-1)).toEqual({ scheduleId: "morning", name: "Morning", waiting: false });
      clock = new Date("2026-07-01T05:30:00Z");
      await scheduler.tick();
      expect(chats.map((chat) => chat.name)).toEqual(["Morning"]);
    });

    test("a confirmed card whose schedule changed in the file meanwhile does not count", async () => {
      writeSchedules([morning]);
      shows = false;
      const scheduler = createScheduler();
      await scheduler.tick();
      const [card] = scheduler.waitingCards();
      writeSchedules([{ ...morning, prompt: "Something someone pushed." }]);
      expect(scheduler.confirmCard("morning", card?.fields ?? {})).toBe(false);
    });

    test("a confirmed card skips the slot that is due at that moment", async () => {
      writeSchedules([morning]);
      shows = false;
      const scheduler = createScheduler();
      await scheduler.tick();
      clock = new Date("2026-07-01T05:30:00Z");
      const [card] = scheduler.waitingCards();
      expect(scheduler.confirmCard("morning", card?.fields ?? {})).toBe(true);
      await scheduler.tick();
      expect(chats).toEqual([]);
    });

    test("the wait clears when the schedule is removed, by Eva or by hand", async () => {
      writeSchedules([morning, { ...morning, id: "evening", name: "Evening" }]);
      shows = false;
      const scheduler = createScheduler();
      await scheduler.tick();
      scheduler.remove("morning");
      writeSchedules([]);
      await scheduler.tick();
      expect(cardReports.filter((report) => !report.waiting).map((report) => report.scheduleId)).toEqual([
        "morning",
        "evening",
      ]);
      expect(scheduler.waitingCards()).toEqual([]);
    });

    test("the wait clears when the change is undone before anyone saw its card", async () => {
      writeSchedules([morning]);
      const scheduler = createScheduler();
      await scheduler.tick();
      shows = false;
      writeSchedules([{ ...morning, at: "09:00" }]);
      await scheduler.tick();
      writeSchedules([morning]);
      await scheduler.tick();
      expect(scheduler.waitingCards()).toEqual([]);
      expect(cardReports.at(-1)).toEqual({ scheduleId: "morning", name: "Morning", waiting: false });
    });

    test("a confirm while a front end still sends the card leaves nothing waiting", async () => {
      writeSchedules([morning]);
      shows = false;
      const scheduler = createScheduler();
      await scheduler.tick();
      const [card] = scheduler.waitingCards();
      let release = (): void => undefined;
      const unsubscribe = scheduler.subscribe(
        () =>
          new Promise<boolean>((resolve) => {
            release = () => resolve(false);
          }),
      );
      const slowTick = scheduler.tick();
      await Bun.sleep(0);
      expect(scheduler.confirmCard("morning", card?.fields ?? {})).toBe(true);
      release();
      await slowTick;
      unsubscribe();
      expect(scheduler.waitingCards()).toEqual([]);
      expect(cardReports.at(-1)?.waiting).toBe(false);
    });

    test("a schedule removed while its card goes out stays removed, so a new push gets a new card", async () => {
      writeSchedules([morning]);
      const scheduler = createScheduler();
      let release = (): void => undefined;
      const unsubscribe = scheduler.subscribe(
        () =>
          new Promise<boolean>((resolve) => {
            release = () => resolve(true);
          }),
      );
      const slowTick = scheduler.tick();
      await Bun.sleep(0);
      scheduler.remove("morning");
      release();
      await slowTick;
      unsubscribe();
      expect(scheduler.waitingCards()).toEqual([]);
      events = [];
      writeSchedules([morning]);
      clock = new Date("2026-07-01T05:30:00Z");
      await scheduler.tick();
      expect(events.map((event) => event.kind)).toEqual(["schedule_card"]);
      expect(chats).toEqual([]);
    });

    test("a second confirm of a card already seen succeeds and changes nothing", async () => {
      writeSchedules([morning]);
      const scheduler = createScheduler();
      await scheduler.tick();
      const [card] = events.filter((event) => event.kind === "schedule_card");
      clock = new Date("2026-07-01T05:30:00Z");
      expect(scheduler.confirmCard("morning", card?.fields ?? {})).toBe(true);
      await scheduler.tick();
      expect(chats.map((chat) => chat.name)).toEqual(["Morning"]);
    });

    test("a satellite refuses a confirm", async () => {
      writeSchedules([morning]);
      shows = false;
      let isHub = true;
      const scheduler = new Scheduler({
        vaultPath: vault,
        statePath: join(folder, "state", "schedules-state.json"),
        timeZone: "Europe/Madrid",
        isHub: () => isHub,
        now: () => clock,
        chats: { createChat: () => "session-1", send: () => Promise.resolve(null) },
      });
      await scheduler.tick();
      const [card] = scheduler.waitingCards();
      isHub = false;
      expect(scheduler.confirmCard("morning", card?.fields ?? {})).toBe(false);
    });

    test("the wait clears when this machine stops being the hub", async () => {
      writeSchedules([morning]);
      shows = false;
      let isHub = true;
      const scheduler = new Scheduler({
        vaultPath: vault,
        statePath: join(folder, "state", "schedules-state.json"),
        timeZone: "Europe/Madrid",
        isHub: () => isHub,
        now: () => clock,
        chats: { createChat: () => "session-1", send: () => Promise.resolve(null) },
        reportCard: (scheduleId, name, waiting) => cardReports.push({ scheduleId, name, waiting }),
      });
      await scheduler.tick();
      isHub = false;
      await scheduler.tick();
      expect(cardReports).toEqual([
        { scheduleId: "morning", name: "Morning", waiting: true },
        { scheduleId: "morning", name: "Morning", waiting: false },
      ]);
      expect(scheduler.waitingCards()).toEqual([]);
    });
  });
});

describe("a vault that a newer Eva migrated (#119)", () => {
  test("save and remove refuse with vault_ahead and leave the file as it is", () => {
    writeSchedules([morning]);
    writeFileSync(
      join(vault, ".eva", "migrations.json"),
      JSON.stringify({ applied: [{ id: "2099-01-01-from-the-future", at: "", version: "9.0.0" }] }),
    );
    const before = readFileSync(join(vault, ".eva", "schedules.json"), "utf-8");
    const scheduler = createScheduler();
    expect(() => scheduler.save({ ...morning, id: "evening" })).toThrow("9.0.0");
    expect(() => scheduler.remove("morning")).toThrow("9.0.0");
    expect(readFileSync(join(vault, ".eva", "schedules.json"), "utf-8")).toBe(before);
  });
});
