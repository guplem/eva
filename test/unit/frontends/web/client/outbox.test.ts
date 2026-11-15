import { describe, expect, test } from "bun:test";
import {
  earlierRefused,
  Outbox,
  retryWaitsMs,
  type OutboxEntry,
} from "../../../../../src/frontends/web/client/outbox.ts";
import { ApiError } from "../../../../../src/frontends/web/client/request.ts";

interface Call {
  readonly sessionId: string;
  readonly text: string;
  readonly id: string;
  readonly resolve: (answer?: { readonly repeat: boolean }) => void;
  readonly reject: (error: unknown) => void;
}

/** An outbox with a fake send and fake timers. Each send waits until the test answers it. */
function setup(): {
  outbox: Outbox;
  calls: Call[];
  timers: { run: () => void; ms: number; cleared: boolean }[];
  runTimers: () => void;
  settle: () => Promise<void>;
} {
  const calls: Call[] = [];
  const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
  const outbox = new Outbox({
    send: (sessionId, text, id) =>
      new Promise<{ readonly repeat: boolean }>((resolve, reject) => {
        calls.push({ sessionId, text, id, resolve: (answer) => resolve(answer ?? { repeat: false }), reject });
      }),
    timers: {
      set: (run, ms) => {
        const timer = { run, ms, cleared: false };
        timers.push(timer);
        return timer;
      },
      clear: (timer) => {
        (timer as { cleared: boolean }).cleared = true;
      },
    },
  });
  const runTimers = (): void => {
    for (const timer of timers.splice(0)) if (!timer.cleared) timer.run();
  };
  // The outbox reacts to a send's answer after the promise settles.
  const settle = async (): Promise<void> => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  };
  return { outbox, calls, timers, runTimers, settle };
}

const states = (entries: readonly OutboxEntry[]): string[] => entries.map((entry) => `${entry.text}:${entry.state}`);
const offline = new TypeError("Failed to fetch");

describe("Outbox", () => {
  test("a message shows as sending, and as sent once Eva takes it", async () => {
    const { outbox, calls, settle } = setup();
    outbox.add({ sessionId: "s1", text: "hi", id: "m1", turnCount: 0 });
    expect(states(outbox.list("s1"))).toEqual(["hi:sending"]);
    expect(calls.map((call) => call.id)).toEqual(["m1"]);
    calls[0]?.resolve();
    await settle();
    expect(states(outbox.list("s1"))).toEqual(["hi:sent"]);
    expect(outbox.list("s2")).toEqual([]);
  });

  test("a lost connection waits longer each time, then tries again with the same id", async () => {
    const { outbox, calls, timers, runTimers, settle } = setup();
    outbox.add({ sessionId: "s1", text: "hi", id: "m1", turnCount: 0 });
    for (const wait of retryWaitsMs) {
      calls.at(-1)?.reject(offline);
      await settle();
      expect(states(outbox.list("s1"))).toEqual(["hi:waiting"]);
      expect(timers.at(-1)?.ms).toBe(wait);
      runTimers();
      expect(states(outbox.list("s1"))).toEqual(["hi:sending"]);
    }
    calls.at(-1)?.reject(offline);
    await settle();
    expect(outbox.list("s1")[0]).toMatchObject({ state: "failed", reason: null });
    expect(new Set(calls.map((call) => call.id))).toEqual(new Set(["m1"]));
    expect(calls).toHaveLength(retryWaitsMs.length + 1);
  });

  test("a message that failed once says so, so its next try shows Sending at once", async () => {
    const { outbox, calls, runTimers, settle } = setup();
    outbox.add({ sessionId: "s1", text: "hi", id: "m1", turnCount: 0 });
    outbox.add({ sessionId: "s1", text: "later", id: "m2", turnCount: 0 });
    expect(outbox.list("s1").map((entry) => entry.retried)).toEqual([false, false]);
    calls[0]?.reject(offline);
    await settle();
    runTimers();
    expect(outbox.list("s1").map((entry) => entry.retried)).toEqual([true, true]);
  });

  test("a time limit or a 5xx answer tries again, and a 4xx answer fails at once with its reason", async () => {
    const { outbox, calls, settle } = setup();
    outbox.add({ sessionId: "s1", text: "a", id: "m1", turnCount: 0 });
    calls[0]?.reject(new Error("Eva did not answer in 20 seconds."));
    outbox.add({ sessionId: "s2", text: "b", id: "m2", turnCount: 0 });
    calls[1]?.reject(new ApiError(502, "Bad gateway"));
    outbox.add({ sessionId: "s3", text: "c", id: "m3", turnCount: 0 });
    calls[2]?.reject(new ApiError(400, "The file is gone."));
    await settle();
    expect(states(outbox.list("s1"))).toEqual(["a:waiting"]);
    expect(states(outbox.list("s2"))).toEqual(["b:waiting"]);
    expect(outbox.list("s3")[0]).toMatchObject({ state: "failed", reason: "The file is gone." });
  });

  test("the messages of a chat go in order: a later message waits behind an unsent one", async () => {
    const { outbox, calls, runTimers, settle } = setup();
    outbox.add({ sessionId: "s1", text: "one", id: "m1", turnCount: 0 });
    outbox.add({ sessionId: "s1", text: "two", id: "m2", turnCount: 0 });
    // Another chat does not wait.
    outbox.add({ sessionId: "s2", text: "other", id: "m3", turnCount: 0 });
    expect(calls.map((call) => call.id)).toEqual(["m1", "m3"]);
    calls[0]?.reject(offline);
    await settle();
    expect(states(outbox.list("s1"))).toEqual(["one:waiting", "two:waiting"]);
    runTimers();
    calls[2]?.resolve();
    await settle();
    expect(calls.map((call) => call.id)).toEqual(["m1", "m3", "m1", "m2"]);
    expect(states(outbox.list("s1"))).toEqual(["one:sent", "two:sending"]);
  });

  test("a failed message fails the later ones of its chat, and Try again sends them all in order", async () => {
    const { outbox, calls, settle } = setup();
    outbox.add({ sessionId: "s1", text: "one", id: "m1", turnCount: 0 });
    outbox.add({ sessionId: "s1", text: "two", id: "m2", turnCount: 0 });
    calls[0]?.reject(new ApiError(409, "The chat is closed."));
    await settle();
    expect(states(outbox.list("s1"))).toEqual(["one:failed", "two:failed"]);
    outbox.retry("m2");
    expect(states(outbox.list("s1"))).toEqual(["one:sending", "two:sending"]);
    calls[1]?.resolve();
    await settle();
    expect(calls.map((call) => call.id)).toEqual(["m1", "m1", "m2"]);
  });

  test("a message added behind a failed or waiting one takes its state, so it never shows Sending for nothing", async () => {
    const { outbox, calls, runTimers, settle } = setup();
    outbox.add({ sessionId: "s1", text: "one", id: "m1", turnCount: 0 });
    calls[0]?.reject(offline);
    await settle();
    outbox.add({ sessionId: "s1", text: "two", id: "m2", turnCount: 0 });
    expect(states(outbox.list("s1"))).toEqual(["one:waiting", "two:waiting"]);
    runTimers();
    calls[1]?.reject(new ApiError(400, "No."));
    await settle();
    outbox.add({ sessionId: "s1", text: "three", id: "m3", turnCount: 0 });
    expect(states(outbox.list("s1"))).toEqual(["one:failed", "two:failed", "three:failed"]);
    expect(calls).toHaveLength(2);
  });

  test("a message that fails behind a refused one says so, not that the connection failed", async () => {
    const { outbox, calls, settle } = setup();
    outbox.add({ sessionId: "s1", text: "one", id: "m1", turnCount: 0 });
    outbox.add({ sessionId: "s1", text: "two", id: "m2", turnCount: 0 });
    calls[0]?.reject(new ApiError(400, "No."));
    await settle();
    outbox.add({ sessionId: "s1", text: "three", id: "m3", turnCount: 0 });
    expect(outbox.list("s1").map((entry) => entry.reason)).toEqual(["No.", earlierRefused, earlierRefused]);
  });

  test("a network that comes back tries each waiting message at once", async () => {
    const { outbox, calls, timers, settle } = setup();
    outbox.add({ sessionId: "s1", text: "hi", id: "m1", turnCount: 0 });
    calls[0]?.reject(offline);
    await settle();
    outbox.retryNow();
    expect(timers[0]?.cleared).toBe(true);
    expect(calls.map((call) => call.id)).toEqual(["m1", "m1"]);
    // A message that Eva has, or that failed, stays as it is.
    calls[1]?.resolve();
    await settle();
    outbox.retryNow();
    expect(calls).toHaveLength(2);
  });

  test("a turn that holds the message's id confirms it, even when its answer was lost", async () => {
    const { outbox, calls, timers, settle } = setup();
    outbox.add({ sessionId: "s1", text: "one", id: "m1", turnCount: 0 });
    outbox.add({ sessionId: "s1", text: "two", id: "m2", turnCount: 0 });
    calls[0]?.reject(offline);
    await settle();
    outbox.confirm("s1", [{ turnIndex: 3, clientIds: ["m1"] }]);
    expect(timers[0]?.cleared).toBe(true);
    expect(states(outbox.list("s1"))).toEqual(["one:sent", "two:sending"]);
    // The message waits for the stored turn that holds it, not for a later one.
    expect(outbox.list("s1")[0]?.turnCount).toBe(3);
    expect(calls.map((call) => call.id)).toEqual(["m1", "m2"]);
    // A late failure of a confirmed message changes nothing.
    outbox.confirm("s1", [{ turnIndex: 4, clientIds: ["m2"] }]);
    calls[1]?.reject(offline);
    await settle();
    expect(states(outbox.list("s1"))).toEqual(["one:sent", "two:sent"]);
    // A turn of another chat with the same id confirms nothing here.
    outbox.add({ sessionId: "s1", text: "three", id: "m3", turnCount: 0 });
    outbox.confirm("s2", [{ turnIndex: 0, clientIds: ["m3"] }]);
    expect(states(outbox.list("s1"))).toEqual(["one:sent", "two:sent", "three:sending"]);
  });

  test("a turn fixes the turn count of a message that Eva took already", async () => {
    const { outbox, calls, settle } = setup();
    outbox.add({ sessionId: "s1", text: "hi", id: "m1", turnCount: 2 });
    calls[0]?.resolve();
    await settle();
    outbox.confirm("s1", [{ turnIndex: 1, clientIds: ["m1"] }]);
    expect(outbox.list("s1")[0]?.turnCount).toBe(1);
  });

  test("a message that Eva had already leaves the outbox, because a turn shows it", async () => {
    const { outbox, calls, settle } = setup();
    outbox.add({ sessionId: "s1", text: "one", id: "m1", turnCount: 0 });
    outbox.add({ sessionId: "s1", text: "two", id: "m2", turnCount: 0 });
    calls[0]?.resolve({ repeat: true });
    await settle();
    expect(states(outbox.list("s1"))).toEqual(["two:sending"]);
    expect(calls.map((call) => call.id)).toEqual(["m1", "m2"]);
  });

  test("a sent message waits beyond the turn count of its chat when Eva took it", async () => {
    const { outbox, calls, settle } = setup();
    outbox.add({ sessionId: "s1", text: "hi", id: "m1", turnCount: 0 });
    calls[0]?.reject(offline);
    await settle();
    // Two turns ended while the message waited.
    outbox.noteTurnCount("s1", 2);
    outbox.retryNow();
    calls[1]?.resolve();
    await settle();
    expect(outbox.list("s1")[0]).toMatchObject({ state: "sent", turnCount: 2 });
  });

  test("forget drops the sent messages that a stored turn shows now, never an unsent one", async () => {
    const { outbox, calls, settle } = setup();
    outbox.add({ sessionId: "s1", text: "one", id: "m1", turnCount: 0 });
    calls[0]?.resolve();
    await settle();
    outbox.add({ sessionId: "s1", text: "two", id: "m2", turnCount: 0 });
    calls[1]?.reject(offline);
    await settle();
    outbox.forget("s1", 1);
    expect(states(outbox.list("s1"))).toEqual(["two:waiting"]);
  });

  test("remove takes a message out, for an edit, and the next message of its chat goes", async () => {
    const { outbox, calls, settle } = setup();
    outbox.add({ sessionId: "s1", text: "one", id: "m1", turnCount: 0 });
    outbox.add({ sessionId: "s1", text: "two", id: "m2", turnCount: 0 });
    calls[0]?.reject(offline);
    await settle();
    expect(outbox.remove("m1")?.text).toBe("one");
    expect(states(outbox.list("s1"))).toEqual(["two:sending"]);
    expect(calls.map((call) => call.id)).toEqual(["m1", "m2"]);
    expect(outbox.remove("missing")).toBeUndefined();
  });

  test("a listener hears each change, and the list keeps its identity between changes", async () => {
    const { outbox, calls, settle } = setup();
    let heard = 0;
    const stop = outbox.subscribe(() => {
      heard += 1;
    });
    outbox.add({ sessionId: "s1", text: "hi", id: "m1", turnCount: 0 });
    const first = outbox.list("s1");
    expect(outbox.list("s1")).toBe(first);
    calls[0]?.resolve();
    await settle();
    expect(heard).toBe(2);
    stop();
    outbox.forget("s1", 5);
    expect(heard).toBe(2);
  });
});
