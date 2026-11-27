import { describe, expect, test } from "bun:test";
import {
  earlierRefused,
  Outbox,
  retryWaitsMs,
  type OutboxEntry,
  type OutboxStorage,
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
function setup(storage?: () => OutboxStorage): {
  outbox: Outbox;
  calls: Call[];
  timers: { run: () => void; ms: number; cleared: boolean }[];
  runTimers: () => void;
  settle: () => Promise<void>;
} {
  const calls: Call[] = [];
  const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
  const outbox = new Outbox({
    ...(storage === undefined ? {} : { storage }),
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

const storageKey = "eva-outbox";

function memoryStorage(): OutboxStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

describe("Outbox in the tab's storage (#946)", () => {
  test("a reload keeps each unsent message in its chat, with its state, and sends nothing before the page connects", async () => {
    const storage = memoryStorage();
    const before = setup(() => storage);
    // A try runs at the reload, and a later message of its chat waits behind it.
    before.outbox.add({ sessionId: "s1", text: "one", id: "m1", turnCount: 2 });
    before.outbox.add({ sessionId: "s1", text: "two", id: "m2", turnCount: 2 });
    before.outbox.add({ sessionId: "s2", text: "taken", id: "m3", turnCount: 4 });
    before.outbox.add({ sessionId: "s3", text: "refused", id: "m4", turnCount: 0 });
    before.outbox.add({ sessionId: "s4", text: "offline", id: "m5", turnCount: 1 });
    before.calls[1]?.resolve();
    before.calls[2]?.reject(new ApiError(400, "The file is gone."));
    before.calls[3]?.reject(offline);
    await before.settle();

    const after = setup(() => storage);
    expect(states(after.outbox.list("s1"))).toEqual(["one:waiting", "two:waiting"]);
    expect(after.outbox.list("s2")[0]).toMatchObject({ text: "taken", id: "m3", state: "sent", turnCount: 4 });
    expect(after.outbox.list("s3")[0]).toMatchObject({ state: "failed", reason: "The file is gone." });
    expect(after.outbox.list("s4")[0]).toMatchObject({ state: "waiting", turnCount: 1, retried: true });
    expect(after.calls).toHaveLength(0);

    // The page connects: each chat sends its first message again with the same id, in order.
    after.outbox.retryNow();
    expect(after.calls.map((call) => call.id)).toEqual(["m1", "m5"]);
    after.calls[0]?.resolve();
    await after.settle();
    expect(after.calls.map((call) => call.id)).toEqual(["m1", "m5", "m2"]);
    // The sent message never goes again, and the failed one waits for Try again.
    after.outbox.retry("m4");
    expect(after.calls.map((call) => call.id)).toEqual(["m1", "m5", "m2", "m4"]);
  });

  test("after a reload, a message that Eva had already leaves at its repeat answer", async () => {
    const storage = memoryStorage();
    setup(() => storage).outbox.add({ sessionId: "s1", text: "hi", id: "m1", turnCount: 0 });
    const after = setup(() => storage);
    after.outbox.retryNow();
    after.calls[0]?.resolve({ repeat: true });
    await after.settle();
    expect(after.outbox.list("s1")).toEqual([]);
    expect(storage.items.has(storageKey)).toBe(false);
  });

  test("each change goes to the storage, and an empty outbox removes its key", async () => {
    const storage = memoryStorage();
    const { outbox, calls, settle } = setup(() => storage);
    outbox.add({ sessionId: "s1", text: "hi", id: "m1", turnCount: 0 });
    expect(JSON.parse(storage.items.get(storageKey) ?? "[]")).toEqual([
      { sessionId: "s1", text: "hi", id: "m1", turnCount: 0, state: "sending", reason: null, retried: false },
    ]);
    calls[0]?.resolve();
    await settle();
    expect(setup(() => storage).outbox.list("s1")[0]?.state).toBe("sent");
    outbox.forget("s1", 1);
    expect(storage.items.has(storageKey)).toBe(false);
    outbox.add({ sessionId: "s1", text: "edit me", id: "m2", turnCount: 1 });
    outbox.remove("m2");
    expect(storage.items.has(storageKey)).toBe(false);
  });

  test("a blocked storage leaves the outbox working in memory", async () => {
    const blocked = (): never => {
      throw new Error("The storage is blocked.");
    };
    const { outbox, calls, settle } = setup(blocked);
    outbox.add({ sessionId: "s1", text: "hi", id: "m1", turnCount: 0 });
    expect(states(outbox.list("s1"))).toEqual(["hi:sending"]);
    calls[0]?.resolve();
    await settle();
    expect(states(outbox.list("s1"))).toEqual(["hi:sent"]);
  });

  test("a full storage keeps a long message in memory, and the message still goes", async () => {
    const storage = memoryStorage();
    const full: OutboxStorage = {
      ...storage,
      setItem: (key, value) => {
        if (value.length > 1_000) throw new DOMException("The quota is full.", "QuotaExceededError");
        storage.setItem(key, value);
      },
    };
    const { outbox, calls, settle } = setup(() => full);
    outbox.add({ sessionId: "s1", text: "short", id: "m1", turnCount: 0 });
    const long = `Read [[Notes/example-app.md]] ${"x".repeat(5_000)}`;
    outbox.add({ sessionId: "s1", text: long, id: "m2", turnCount: 0 });
    expect(outbox.list("s1").map((entry) => entry.text)).toEqual(["short", long]);
    calls[0]?.resolve();
    await settle();
    expect(calls.map((call) => call.text)).toEqual(["short", long]);
    // The storage keeps the last list that fitted, so a reload loses only what never fitted.
    expect(
      setup(() => storage)
        .outbox.list("s1")
        .map((entry) => entry.text),
    ).toEqual(["short"]);
  });

  test("a bad stored value is dropped, and a bad entry does not drop the good ones", () => {
    const storage = memoryStorage();
    storage.setItem(storageKey, "not json");
    expect(setup(() => storage).outbox.list("s1")).toEqual([]);
    const good = { sessionId: "s1", text: "hi", id: "m1", turnCount: 0, state: "failed", reason: null, retried: true };
    storage.setItem(
      storageKey,
      JSON.stringify([
        { ...good, id: "m0", state: "lost" },
        { ...good, id: "m2", turnCount: "3" },
        { ...good, id: 7 },
        null,
        good,
      ]),
    );
    expect(setup(() => storage).outbox.list("s1")).toEqual([good as OutboxEntry]);
    storage.setItem(storageKey, JSON.stringify({ entries: [good] }));
    expect(setup(() => storage).outbox.list("s1")).toEqual([]);
  });
});
