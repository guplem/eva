import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Scheduler, type ScheduleEvent } from "../../../../src/core/schedules/scheduler.ts";
import type { ModelAlias } from "../../../../src/shared/engine-port.ts";

let folder: string;
let vault: string;
let clock: Date;
let chats: { name: string; model: ModelAlias | undefined; sessionId: string }[];
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
/** The answer of each chat at the end of its run, and whether the person wrote in it. */
let answers: Map<string, { text: string; personWrote: boolean }>;
/** Each ended run: the chat and whether its answer goes out. */
let endedRuns: { sessionId: string; deliver: boolean }[];

beforeEach(() => {
  logged = [];
  failingChats = new Set();
  failingSends = false;
  rejectingSends = false;
  duringSend = () => undefined;
  heldSend = null;
  failingReports = false;
  firings = [];
  answers = new Map();
  endedRuns = [];
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
      answerOf: (sessionId) => answers.get(sessionId) ?? { text: "Here is your plan.", personWrote: false },
      endRun: (sessionId, deliver) => endedRuns.push({ sessionId, deliver }),
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
  });
  scheduler.subscribe((event) => {
    events.push(event);
  });
  return scheduler;
}

const morning = { id: "morning", name: "Morning", at: "07:30", text: "Drink water.", prompt: "Plan my day." };

describe("Scheduler", () => {
  test("a new schedule fires at its next time in a fresh chat, with no setup card (lesson 126, #855)", async () => {
    writeSchedules([{ ...morning, model: "haiku" }]);
    const scheduler = createScheduler();
    await scheduler.tick();
    expect(events).toEqual([]);
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    await scheduler.tick();
    expect(events.filter((event) => event.kind === "schedule_fired")).toEqual([
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
    expect(sent.map(({ sessionId, prompt }) => [sessionId, prompt.split("\n\n")[0]])).toEqual([
      ["session-1", "Plan my day."],
    ]);
    clock = new Date("2026-07-02T05:30:00Z");
    await scheduler.tick();
    expect(chats.map((chat) => chat.sessionId)).toEqual(["session-1", "session-2"]);
  });

  test("a schedule without a prompt fires without a chat, and an unknown model means the settings' model", async () => {
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
    expect(chats[0]?.model).toBeUndefined();
  });

  test("a changed schedule fires at its new time, not at the old one", async () => {
    writeSchedules([morning]);
    const scheduler = createScheduler();
    await scheduler.tick();
    writeSchedules([{ ...morning, at: "08:00" }]);
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    expect(chats).toEqual([]);
    clock = new Date("2026-07-01T06:00:00Z");
    await scheduler.tick();
    expect(chats.map((chat) => chat.name)).toEqual(["Morning"]);
  });

  test("the state survives a restart: no second firing", async () => {
    writeSchedules([morning]);
    clock = new Date("2026-07-01T05:20:00Z");
    await createScheduler().tick();
    clock = new Date("2026-07-01T05:30:00Z");
    await createScheduler().tick();
    await createScheduler().tick();
    expect(events.map((event) => event.kind)).toEqual(["schedule_fired", "schedule_answered"]);
  });

  test("a broken state file starts empty, never a crash (lesson 54)", async () => {
    writeSchedules([morning]);
    mkdirSync(join(folder, "state"), { recursive: true });
    writeFileSync(join(folder, "state", "schedules-state.json"), "{ broken");
    const scheduler = createScheduler();
    await scheduler.tick();
    expect(events).toEqual([]);
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    expect(chats.map((chat) => chat.name)).toEqual(["Morning"]);
  });

  test("one bad state entry is skipped, the others are kept (lesson 69)", async () => {
    writeSchedules([morning, { ...morning, id: "evening" }]);
    clock = new Date("2026-07-01T05:20:00Z");
    await createScheduler().tick();
    const statePath = join(folder, "state", "schedules-state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { schedules: Record<string, unknown> };
    state.schedules["evening"] = { firstSeen: 5 };
    writeFileSync(statePath, JSON.stringify(state));
    clock = new Date("2026-07-01T05:30:00Z");
    await createScheduler().tick();
    // The bad entry starts again now, so its slot that is due now does not fire.
    const fired = events.filter((event) => event.kind === "schedule_fired");
    expect(fired.map((event) => event.scheduleId)).toEqual(["morning"]);
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
    await scheduler.tick();
    scheduler.subscribe(() => {
      throw new Error("front end down");
    });
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    expect(events.map((event) => event.kind)).toEqual(["schedule_fired", "schedule_answered"]);
    expect(sent).toHaveLength(1);
  });

  test("a tick that overlaps a running tick does nothing", async () => {
    writeSchedules([morning]);
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
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
    expect(events.filter((event) => event.kind === "schedule_fired")).toHaveLength(1);
    expect(chats).toHaveLength(1);
  });

  test("isFiring holds while a check runs, so an update waits for a firing schedule (lesson 92)", async () => {
    writeSchedules([morning]);
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    let release = (): void => undefined;
    const unsubscribe = scheduler.subscribe(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
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
            until: null,
          },
          nextRun: "2026-07-01T07:30",
          runsToday: ["07:30"],
          lastRun: null,
          ended: null,
        },
      ],
      problems: [],
      timeZone: "Europe/Madrid",
      now: "2026-07-01T07:00",
    });
    await scheduler.tick();
    expect(scheduler.remove("morning")).toBe(true);
    expect(scheduler.remove("morning")).toBe(false);
    // Saved again, it is a new schedule from now on, so the slot that is due now does not fire.
    clock = new Date("2026-07-01T05:30:00Z");
    scheduler.save(morning);
    await scheduler.tick();
    expect(chats).toEqual([]);
  });

  test("an edit changes the time it fires, and an edit of a paused schedule keeps it off", async () => {
    writeSchedules([morning, { ...morning, id: "evening", enabled: false }]);
    clock = new Date("2026-07-01T05:20:00Z");
    const scheduler = createScheduler();
    await scheduler.tick();
    expect(scheduler.edit("morning", { name: "Morning", at: "08:00", prompt: "Plan my day." })?.at).toBe("08:00");
    expect(scheduler.edit("evening", { name: "Evening", at: "20:00", text: "Rest." })?.enabled).toBe(false);
    expect(scheduler.edit("nobody", { name: "Nobody", at: "20:00", text: "Rest." })).toBeNull();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    expect(chats).toEqual([]);
    clock = new Date("2026-07-01T06:00:00Z");
    await scheduler.tick();
    expect(events.filter((event) => event.kind === "schedule_fired").map((event) => event.scheduleId)).toEqual([
      "morning",
    ]);
  });

  test("a schedule that is off never fires", async () => {
    writeSchedules([morning]);
    clock = new Date("2026-07-01T05:20:00Z");
    const scheduler = createScheduler();
    await scheduler.tick();
    writeSchedules([{ ...morning, enabled: false }]);
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    clock = new Date("2026-07-02T05:30:00Z");
    await scheduler.tick();
    expect(events).toEqual([]);
    expect(scheduler.list().schedules[0]?.nextRun).toBeNull();
  });

  test("turning a schedule back on skips the slot that is due then, and fires at the next one (#855)", async () => {
    writeSchedules([morning]);
    clock = new Date("2026-07-01T05:20:00Z");
    const scheduler = createScheduler();
    await scheduler.tick();
    writeSchedules([{ ...morning, enabled: false }]);
    await scheduler.tick();
    writeSchedules([morning]);
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    expect(events).toEqual([]);
    clock = new Date("2026-07-02T05:30:00Z");
    await scheduler.tick();
    expect(events.map((event) => event.kind)).toEqual(["schedule_fired", "schedule_answered"]);
  });

  test("a pause through setEnabled counts at once, so off and on before a check still skips the due slot", async () => {
    writeSchedules([morning]);
    clock = new Date("2026-07-01T05:20:00Z");
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    scheduler.setEnabled("morning", false);
    scheduler.setEnabled("morning", true);
    await scheduler.tick();
    expect(chats).toEqual([]);
    clock = new Date("2026-07-02T05:30:00Z");
    await scheduler.tick();
    expect(chats.map((chat) => chat.name)).toEqual(["Morning"]);
  });

  test("off changes the entry that runs, not an invalid one with the same id", () => {
    writeSchedules([{ ...morning, at: "25:00" }, morning]);
    const scheduler = createScheduler();
    expect(scheduler.setEnabled("morning", false)).toBe(true);
    expect(scheduler.list().schedules[0]?.schedule.enabled).toBe(false);
  });

  test("a schedule that is off from the start fires at its next slot once it is on", async () => {
    writeSchedules([{ ...morning, enabled: false }]);
    const scheduler = createScheduler();
    await scheduler.tick();
    expect(events).toEqual([]);
    writeSchedules([morning]);
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    await scheduler.tick();
    expect(chats.map((chat) => chat.name)).toEqual(["Morning"]);
  });

  test("a state file from before the paused field keeps firing", async () => {
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
    expect(events.map((event) => event.kind)).toEqual(["schedule_fired", "schedule_answered"]);
  });

  test("setEnabled writes the vault file, and false means no such schedule", () => {
    const scheduler = createScheduler();
    scheduler.save(morning);
    expect(scheduler.setEnabled("morning", false)).toBe(true);
    expect(scheduler.list().schedules[0]?.schedule.enabled).toBe(false);
    expect(scheduler.setEnabled("nobody", true)).toBe(false);
  });

  test("a changed schedule that is already due does not fire then, but fires at its next slot (#855)", async () => {
    writeSchedules([morning]);
    clock = new Date("2026-07-01T04:00:00Z");
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:00:00Z"); // 07:00 in Madrid
    writeSchedules([{ ...morning, at: "06:59", prompt: "Something someone pushed." }]);
    await scheduler.tick();
    await scheduler.tick();
    expect(events).toEqual([]);
    expect(chats).toEqual([]);
    clock = new Date("2026-07-02T04:59:00Z");
    await scheduler.tick();
    expect(sent.map(({ prompt }) => prompt.split("\n\n")[0])).toEqual(["Something someone pushed."]);
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
    // The change skips the slot that is due now, so the last fired slot moves.
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

    test("a slot that a change skips is not a run", async () => {
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

  test("a schedule removed while it fires stays removed, with no last run", async () => {
    writeSchedules([morning]);
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = new Date("2026-07-01T05:30:00Z");
    let release = (): void => undefined;
    // A front end that takes long to show the firing, such as Telegram opening a topic.
    const unsubscribe = scheduler.subscribe(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const slowTick = scheduler.tick();
    await Bun.sleep(0);
    scheduler.remove("morning");
    release();
    await slowTick;
    unsubscribe();
    await Bun.sleep(0);
    writeSchedules([morning]);
    expect(scheduler.list().schedules[0]?.lastRun).toBeNull();
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

describe("one-off schedules (#822)", () => {
  const call = { id: "call", name: "Call", from: "2026-07-01T08:00", text: "Call the bank." };
  const at = (wallClock: string): Date => new Date(`${wallClock}:00+02:00`);
  const fired = (): ScheduleEvent[] => events.filter((event) => event.kind === "schedule_fired");

  test("fires once at its time, then shows as ended", async () => {
    writeSchedules([call]);
    const scheduler = createScheduler();
    await scheduler.tick();
    expect(scheduler.list().schedules[0]).toMatchObject({ nextRun: "2026-07-01T08:00", ended: null });
    clock = at("2026-07-01T08:00");
    await scheduler.tick();
    clock = at("2026-07-02T08:00");
    await scheduler.tick();
    expect(fired()).toEqual([
      { kind: "schedule_fired", scheduleId: "call", name: "Call", text: "Call the bank.", file: null, sessionId: null },
    ]);
    expect(scheduler.list().schedules[0]).toMatchObject({ nextRun: null, ended: "2026-07-01T08:00" });
  });

  test("a run that Eva missed comes late, and says so in its text and its prompt", async () => {
    writeSchedules([{ ...call, prompt: "Check the reply." }]);
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = at("2026-07-03T09:30");
    await scheduler.tick();
    const event = fired()[0];
    expect(event?.kind === "schedule_fired" ? event.text : null).toBe("Call the bank.");
    expect(sent[0]?.prompt).toStartWith("[This scheduled run comes late: it was due at 2026-07-01 08:00. Say so");
    expect(sent[0]?.prompt).toContain("\n\nCheck the reply.\n\n");
  });

  test("a late run with no prompt puts the note before its text", async () => {
    writeSchedules([call]);
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = at("2026-07-01T09:00");
    await scheduler.tick();
    const event = fired()[0];
    expect(event?.kind === "schedule_fired" ? event.text : null).toBe(
      "This message comes late: it was due at 2026-07-01 08:00.\n\nCall the bank.",
    );
  });

  test("a change after its time does not skip the late run, because a one-off has no next slot", async () => {
    writeSchedules([call]);
    const scheduler = createScheduler();
    await scheduler.tick();
    clock = at("2026-07-01T10:00");
    writeSchedules([{ ...call, text: "Call the bank now." }]);
    expect(scheduler.list().schedules[0]?.nextRun).toBe("2026-07-01T10:00");
    await scheduler.tick();
    await scheduler.tick();
    expect(fired()).toHaveLength(1);
  });

  test("a time already past when Eva first sees it never fires, and shows as ended", async () => {
    clock = at("2026-07-01T09:00");
    writeSchedules([call]);
    const scheduler = createScheduler();
    await scheduler.tick();
    await scheduler.tick();
    expect(fired()).toEqual([]);
    expect(scheduler.list().schedules[0]).toMatchObject({ nextRun: null, ended: "2026-07-01T08:00" });
  });

  test("save and edit refuse a time in the past, and keep a past time that the edit leaves as it is", () => {
    const scheduler = createScheduler();
    expect(() => scheduler.save({ ...call, from: "2026-07-01T06:00" })).toThrow("is in the past");
    scheduler.save(call);
    clock = at("2026-07-02T08:00");
    expect(() => scheduler.edit("call", { name: "Call", from: "2026-07-01T09:00", text: "Call." })).toThrow(
      "is in the past",
    );
    expect(scheduler.edit("call", { name: "Phone call", from: "2026-07-01T08:00", text: "Call." })?.name).toBe(
      "Phone call",
    );
    expect(scheduler.edit("call", { name: "Call", from: "2026-07-03T08:00", text: "Call." })?.from).toBe(
      "2026-07-03T08:00",
    );
  });
});

describe("one-off edge cases (#822 review)", () => {
  const call = { id: "call", name: "Call", from: "2026-07-01T08:00", text: "Call the bank." };
  const at = (wallClock: string): Date => new Date(`${wallClock}:00+02:00`);
  const fired = (): ScheduleEvent[] => events.filter((event) => event.kind === "schedule_fired");

  test("a one-off that Eva first sees in its own minute still fires", async () => {
    writeSchedules([call]);
    clock = at("2026-07-01T08:00");
    const scheduler = createScheduler();
    await scheduler.tick();
    await scheduler.tick();
    expect(fired()).toHaveLength(1);
  });

  test("an edit that turns an interval into a one-off refuses the old, past first run", () => {
    const scheduler = createScheduler();
    scheduler.save({ id: "water", name: "Water", every: "1d", from: "2026-07-01T08:00", text: "Water." });
    clock = at("2026-07-05T08:00");
    expect(() => scheduler.edit("water", { name: "Water", from: "2026-07-01T08:00", text: "Water." })).toThrow(
      "is in the past",
    );
  });

  test("a save with every null is a one-off, so a past time is refused", () => {
    const scheduler = createScheduler();
    expect(() => scheduler.save({ ...call, from: "2026-07-01T06:00", every: null })).toThrow("is in the past");
  });
});

describe("quiet runs, [[done]] and until (#687)", () => {
  const watch = { id: "reply", name: "Reply", every: "1d", from: "2026-07-01T08:00", prompt: "Did she reply?" };
  const at = (wallClock: string): Date => new Date(`${wallClock}:00+02:00`);
  const answered = (): ScheduleEvent[] => events.filter((event) => event.kind === "schedule_answered");
  const settle = async (): Promise<void> => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  };
  const runAt = async (scheduler: Scheduler, wallClock: string): Promise<void> => {
    clock = at(wallClock);
    await scheduler.tick();
    await settle();
  };

  test("each scheduled prompt tells the agent about the markers", async () => {
    writeSchedules([watch]);
    const scheduler = createScheduler();
    await scheduler.tick();
    await runAt(scheduler, "2026-07-01T08:00");
    expect(sent[0]?.prompt).toStartWith("Did she reply?");
    expect(sent[0]?.prompt).toContain("[[quiet]]");
    expect(sent[0]?.prompt).toContain("[[done]]");
  });

  test("a run that answers only [[quiet]] reaches nobody, and records a quiet result", async () => {
    writeSchedules([watch]);
    answers.set("session-1", { text: "[[quiet]]", personWrote: false });
    const scheduler = createScheduler();
    await scheduler.tick();
    await runAt(scheduler, "2026-07-01T08:00");
    expect(answered()).toEqual([]);
    expect(endedRuns).toEqual([{ sessionId: "session-1", deliver: false }]);
    expect(scheduler.list().schedules[0]?.lastRun).toEqual({ slot: "2026-07-01T08:00", failed: false, quiet: true });
  });

  test("a quiet answer is not quiet when the person wrote in the chat during the run", async () => {
    writeSchedules([watch]);
    answers.set("session-1", { text: "[[quiet]]", personWrote: true });
    const scheduler = createScheduler();
    await scheduler.tick();
    await runAt(scheduler, "2026-07-01T08:00");
    expect(endedRuns).toEqual([{ sessionId: "session-1", deliver: true }]);
    expect(answered()).toHaveLength(1);
  });

  test("a run that writes [[done]] delivers its message without the marker, then ends the schedule", async () => {
    writeSchedules([watch]);
    answers.set("session-1", { text: "She replied: yes.\n[[done]]", personWrote: false });
    const scheduler = createScheduler();
    await scheduler.tick();
    await runAt(scheduler, "2026-07-01T08:00");
    expect(answered()).toEqual([
      {
        kind: "schedule_answered",
        scheduleId: "reply",
        name: "Reply",
        sessionId: "session-1",
        text: "She replied: yes.\n[[done]]",
        failure: null,
      },
    ]);
    expect(endedRuns).toEqual([{ sessionId: "session-1", deliver: true }]);
    const view = scheduler.list().schedules[0];
    expect(view?.schedule.enabled).toBe(false);
    expect(view?.ended).toBe("2026-07-01T08:00");
    await runAt(scheduler, "2026-07-02T08:00");
    expect(sent).toHaveLength(1);
  });

  test("turning a schedule on after [[done]] clears the end and skips the slot due then (#855)", async () => {
    writeSchedules([watch]);
    answers.set("session-1", { text: "[[done]]", personWrote: false });
    const scheduler = createScheduler();
    await scheduler.tick();
    await runAt(scheduler, "2026-07-01T08:00");
    expect(answered()).toEqual([]);
    clock = at("2026-07-02T08:00");
    expect(scheduler.setEnabled("reply", true)).toBe(true);
    expect(scheduler.list().schedules[0]?.ended).toBeNull();
    await runAt(scheduler, "2026-07-02T08:00");
    expect(sent).toHaveLength(1);
    await runAt(scheduler, "2026-07-03T08:00");
    expect(sent).toHaveLength(2);
  });

  test("a failed run is never quiet and never ends the schedule", async () => {
    writeSchedules([watch]);
    failingSends = true;
    answers.set("session-1", { text: "[[done]]", personWrote: false });
    const scheduler = createScheduler();
    await scheduler.tick();
    await runAt(scheduler, "2026-07-01T08:00");
    expect(answered()).toMatchObject([{ failure: "You hit the usage limit.", text: "[[done]]" }]);
    expect(endedRuns).toEqual([{ sessionId: "session-1", deliver: true }]);
    expect(scheduler.list().schedules[0]?.schedule.enabled).toBe(true);
  });

  test("a schedule past its until day shows as ended", async () => {
    writeSchedules([{ ...watch, until: "2026-07-02" }]);
    const scheduler = createScheduler();
    await scheduler.tick();
    await runAt(scheduler, "2026-07-02T09:00");
    expect(scheduler.list().schedules[0]).toMatchObject({ nextRun: null, ended: "2026-07-02T23:59" });
  });
});

describe("a one-off time counts from when Eva first saw that time (#822 review)", () => {
  const at = (wallClock: string): Date => new Date(`${wallClock}:00+02:00`);
  const fired = (): ScheduleEvent[] => events.filter((event) => event.kind === "schedule_fired");

  test("a known schedule rewritten by hand into a one-off at a past time never fires, and shows as ended", async () => {
    writeSchedules([{ id: "standup", name: "Standup", every: "1d", from: "2026-06-01T07:30", text: "Standup." }]);
    clock = at("2026-05-01T07:00");
    const scheduler = createScheduler();
    await scheduler.tick();
    writeSchedules([{ id: "standup", name: "Standup", from: "2026-06-01T07:30", text: "Standup." }]);
    clock = at("2026-07-01T07:10");
    await scheduler.tick();
    await scheduler.tick();
    expect(fired()).toEqual([]);
    expect(scheduler.list().schedules[0]).toMatchObject({ nextRun: null, ended: "2026-06-01T07:30" });
  });

  test("a new future time written by hand still fires at that time", async () => {
    writeSchedules([{ id: "call", name: "Call", from: "2026-07-01T06:00", text: "Call." }]);
    clock = at("2026-07-01T05:00");
    const scheduler = createScheduler();
    await scheduler.tick();
    await scheduler.tick();
    writeSchedules([{ id: "call", name: "Call", from: "2026-07-01T09:00", text: "Call." }]);
    await scheduler.tick();
    clock = at("2026-07-01T09:00");
    await scheduler.tick();
    expect(fired()).toHaveLength(1);
  });
});

describe("the end of a run, when something goes wrong (#687 review)", () => {
  const watch = { id: "reply", name: "Reply", every: "1d", from: "2026-07-01T08:00", prompt: "Did she reply?" };
  const at = (wallClock: string): Date => new Date(`${wallClock}:00+02:00`);
  const runAt = async (scheduler: Scheduler, wallClock: string): Promise<void> => {
    clock = at(wallClock);
    await scheduler.tick();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  };

  test("an answer with no words and no marker, such as a stopped run, is delivered and not deleted", async () => {
    writeSchedules([watch]);
    answers.set("session-1", { text: "", personWrote: false });
    const scheduler = createScheduler();
    await scheduler.tick();
    await runAt(scheduler, "2026-07-01T08:00");
    expect(endedRuns).toEqual([{ sessionId: "session-1", deliver: true }]);
  });

  test("a chat that is gone at the end still ends the run", async () => {
    writeSchedules([watch]);
    const scheduler = createScheduler();
    await scheduler.tick();
    answers.set("session-1", {
      get text(): string {
        throw new Error("Chat session-1 is gone.");
      },
      personWrote: false,
    });
    await runAt(scheduler, "2026-07-01T08:00");
    expect(endedRuns).toEqual([{ sessionId: "session-1", deliver: true }]);
  });
});

describe("a [[done]] that Eva cannot write (#687 review)", () => {
  test("alerts the phone, and the schedule stays on, with no end mark", async () => {
    writeSchedules([{ id: "reply", name: "Reply", every: "1d", from: "2026-07-01T08:00", prompt: "Did she reply?" }]);
    answers.set("session-1", { text: "She replied.\n[[done]]", personWrote: false });
    const scheduler = createScheduler();
    await scheduler.tick();
    writeFileSync(
      join(vault, ".eva", "migrations.json"),
      JSON.stringify({ applied: [{ id: "2099-01-01-from-the-future", at: "", version: "9.0.0" }] }),
    );
    clock = new Date("2026-07-01T08:00:00+02:00");
    await scheduler.tick();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(firings.at(-1)?.failure).toContain("could not turn it off");
    expect(scheduler.list().schedules[0]).toMatchObject({ ended: null, schedule: { enabled: true } });
  });
});
