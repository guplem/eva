import { describe, expect, test } from "bun:test";
import {
  UnsentTexts,
  type SyncTimers,
  type TextRemote,
  type TextStorage,
} from "../../../../../src/frontends/web/client/unsent-texts.ts";

function memoryStorage(): TextStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

const broken: TextStorage = {
  getItem: () => {
    throw new Error("The storage is blocked.");
  },
  setItem: () => {
    throw new Error("The storage is full.");
  },
  removeItem: () => {
    throw new Error("The storage is blocked.");
  },
};

describe("UnsentTexts", () => {
  test("a reload of the page keeps the unsent text of each chat", () => {
    const storage = memoryStorage();
    new UnsentTexts(() => storage).set("chat-1", "Half a thought");
    const afterReload = new UnsentTexts(() => storage);
    expect(afterReload.get("chat-1")).toBe("Half a thought");
    expect(afterReload.get("chat-2")).toBe("");
  });

  test("an empty text removes the chat's entry", () => {
    const storage = memoryStorage();
    const texts = new UnsentTexts(() => storage);
    texts.set("chat-1", "Hello");
    texts.set("chat-1", "");
    expect(texts.get("chat-1")).toBe("");
    expect(storage.items.size).toBe(0);
  });

  test("a storage that throws keeps the text in memory for this page", () => {
    const texts = new UnsentTexts(() => broken);
    texts.set("chat-1", "Hello");
    expect(texts.get("chat-1")).toBe("Hello");
  });

  test("a newer text that the storage refused wins over the older stored text", () => {
    const storage = memoryStorage();
    let writes = 0;
    const full: TextStorage = {
      ...storage,
      setItem: (key, value) => {
        writes += 1;
        if (writes > 1) throw new Error("The storage is full.");
        storage.setItem(key, value);
      },
    };
    const texts = new UnsentTexts(() => full);
    texts.set("chat-1", "Old");
    texts.set("chat-1", "Newer");
    expect(texts.get("chat-1")).toBe("Newer");
  });

  test("a clear that the storage refused still clears the text on this page", () => {
    const storage = memoryStorage();
    const texts = new UnsentTexts(() => ({
      ...storage,
      removeItem: () => {
        throw new Error("The storage is blocked.");
      },
    }));
    texts.set("chat-1", "Sent already");
    texts.set("chat-1", "");
    expect(texts.get("chat-1")).toBe("");
  });

  test("a failed send puts its message back before the newest draft, even one from another message box", () => {
    const storage = memoryStorage();
    // The box that sent is gone, and a new box of the same chat keeps a newer draft.
    new UnsentTexts(() => storage).set("chat-1", "Typed later");
    const texts = new UnsentTexts(() => storage);
    expect(texts.restore("chat-1", "Hello")).toBe("Hello\n\nTyped later");
    expect(texts.get("chat-1")).toBe("Hello\n\nTyped later");
    expect(texts.restore("chat-2", "Hi")).toBe("Hi");
  });

  test("tells the message box of a chat when its text changes, so a restore from an old box shows", () => {
    const texts = new UnsentTexts(memoryStorage);
    const seen: string[] = [];
    const stop = texts.subscribe("chat-1", () => seen.push(texts.get("chat-1")));
    texts.set("chat-2", "Other chat");
    texts.restore("chat-1", "Hello");
    stop();
    texts.set("chat-1", "After the stop");
    expect(seen).toEqual(["Hello"]);
  });

  test("tells a chat with no text from a chat whose text the person cleared", () => {
    const storage = memoryStorage();
    const texts = new UnsentTexts(() => storage);
    expect(texts.find("chat-1")).toBeUndefined();
    // A chat that starts with a summary keeps its clear, so the summary does not come back.
    texts.set("chat-1", "", true);
    expect(new UnsentTexts(() => storage).find("chat-1")).toBe("");
    texts.set("chat-2", "Hi");
    texts.set("chat-2", "");
    expect(new UnsentTexts(() => storage).find("chat-2")).toBeUndefined();
  });

  test("a page with no storage at all still keeps the text in memory", () => {
    const texts = new UnsentTexts(() => {
      throw new Error("Access to sessionStorage is denied.");
    });
    expect(texts.get("chat-1")).toBe("");
    texts.set("chat-1", "Hello");
    expect(texts.get("chat-1")).toBe("Hello");
    texts.set("chat-1", "");
    expect(texts.get("chat-1")).toBe("");
  });
});

/** Eva's store of texts, as the local API gives it, with the writes that reached it. */
function fakeEva(): TextRemote & {
  revision: number;
  texts: Record<string, { text: string; revision: number }>;
  saves: { key: string; text: string; keepEmpty: boolean }[];
  fail: boolean;
} {
  const eva = {
    revision: 0,
    texts: {} as Record<string, { text: string; revision: number }>,
    saves: [] as { key: string; text: string; keepEmpty: boolean }[],
    fail: false,
    list: () => Promise.resolve({ revision: eva.revision, texts: { ...eva.texts } }),
    save: (key: string, text: string, keepEmpty: boolean) => {
      if (eva.fail) return Promise.reject(new Error("Eva does not answer."));
      eva.saves.push({ key, text, keepEmpty });
      eva.revision += 1;
      if (text === "" && !keepEmpty)
        eva.texts = Object.fromEntries(Object.entries(eva.texts).filter(([kept]) => kept !== key));
      else eva.texts[key] = { text, revision: eva.revision };
      return Promise.resolve(eva.revision);
    },
  };
  return eva;
}

/** Timers that run only when the test says so. */
function manualTimers(): SyncTimers & { runAll: () => void; readonly waiting: number } {
  const timers = new Map<number, () => void>();
  let next = 0;
  return {
    set: (run) => {
      next += 1;
      timers.set(next, run);
      return next;
    },
    clear: (timer) => void timers.delete(timer as number),
    runAll: () => {
      const runs = [...timers.values()];
      timers.clear();
      for (const run of runs) run();
    },
    get waiting() {
      return timers.size;
    },
  };
}

/** Lets the promises of the fake Eva settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("UnsentTexts with Eva (issue 652)", () => {
  test("a text goes to Eva after a pause, so another device shows it", async () => {
    const eva = fakeEva();
    const timers = manualTimers();
    const computer = new UnsentTexts(memoryStorage, { remote: eva, timers, writer: "computer" });
    computer.set("chat-1", "H");
    computer.set("chat-1", "Half a thought");
    expect(eva.saves).toEqual([]);
    timers.runAll();
    await settle();
    expect(eva.saves).toEqual([{ key: "chat-1", text: "Half a thought", keepEmpty: false }]);
    const phone = new UnsentTexts(memoryStorage, { remote: eva, timers: manualTimers(), writer: "phone" });
    await phone.sync();
    expect(phone.get("chat-1")).toBe("Half a thought");
  });

  test("a change from another page shows live, and a page skips its own changes", () => {
    const timers = manualTimers();
    const phone = new UnsentTexts(memoryStorage, { remote: fakeEva(), timers, writer: "phone" });
    const seen: string[] = [];
    phone.subscribe("chat-1", () => seen.push(phone.get("chat-1")));
    phone.receive({ kind: "unsent_text", key: "chat-1", text: "From the computer", revision: 3, writer: "computer" });
    phone.receive({ kind: "unsent_text", key: "chat-1", text: "Mine", revision: 4, writer: "phone" });
    phone.receive({ kind: "unsent_text", key: "chat-1", text: "Older", revision: 2, writer: "computer" });
    expect(phone.get("chat-1")).toBe("From the computer");
    expect(seen).toEqual(["From the computer"]);
    phone.receive({ kind: "unsent_text", key: "chat-1", text: null, revision: 5, writer: "computer" });
    expect(phone.find("chat-1")).toBeUndefined();
  });

  test("a text that Eva does not have yet wins over a text from Eva, and goes to Eva", async () => {
    const eva = fakeEva();
    eva.texts["chat-1"] = { text: "Old text", revision: 1 };
    eva.revision = 1;
    const timers = manualTimers();
    const page = new UnsentTexts(memoryStorage, { remote: eva, timers, writer: "page" });
    page.set("chat-1", "Typed now");
    await page.sync();
    page.receive({ kind: "unsent_text", key: "chat-1", text: "Other", revision: 2, writer: "phone" });
    expect(page.get("chat-1")).toBe("Typed now");
    timers.runAll();
    await settle();
    expect(eva.texts["chat-1"].text).toBe("Typed now");
  });

  test("a reload after a failed write keeps the text and sends it again", async () => {
    const storage = memoryStorage();
    const eva = fakeEva();
    eva.fail = true;
    const timers = manualTimers();
    const before = new UnsentTexts(() => storage, { remote: eva, timers, writer: "before" });
    before.set("chat-1", "Typed during the update");
    timers.runAll();
    await settle();
    eva.fail = false;
    const after = new UnsentTexts(() => storage, { remote: eva, timers, writer: "after" });
    await after.sync();
    expect(after.get("chat-1")).toBe("Typed during the update");
    timers.runAll();
    await settle();
    expect(eva.texts["chat-1"]?.text).toBe("Typed during the update");
  });

  test("a text that another device sent clears on this page at the next read, also after a reload", async () => {
    const storage = memoryStorage();
    const eva = fakeEva();
    const timers = manualTimers();
    const computer = new UnsentTexts(() => storage, { remote: eva, timers, writer: "computer" });
    computer.set("chat-1", "Half a thought");
    timers.runAll();
    await settle();
    // The phone sends the message, while the computer sleeps.
    await eva.save("chat-1", "", false);
    const afterReload = new UnsentTexts(() => storage, { remote: eva, timers, writer: "computer-2" });
    await afterReload.sync();
    expect(afterReload.find("chat-1")).toBeUndefined();
  });

  test("a read that is older than a live change does not undo it", async () => {
    const eva = fakeEva();
    let answer: (value: Awaited<ReturnType<TextRemote["list"]>>) => void = () => undefined;
    const slow: TextRemote = { ...eva, list: () => new Promise((resolve) => (answer = resolve)) };
    const page = new UnsentTexts(memoryStorage, { remote: slow, timers: manualTimers(), writer: "page" });
    page.get("chat-1");
    const read = page.sync();
    page.receive({ kind: "unsent_text", key: "chat-1", text: "Live", revision: 6, writer: "phone" });
    answer({ revision: 5, texts: {} });
    await read;
    expect(page.get("chat-1")).toBe("Live");
  });

  test("one write of a chat runs at a time, and the newest text goes last", async () => {
    const eva = fakeEva();
    const answers: (() => void)[] = [];
    const slow: TextRemote = {
      ...eva,
      save: (key, text, keepEmpty) =>
        new Promise((resolve) => answers.push(() => void eva.save(key, text, keepEmpty).then(resolve))),
    };
    const timers = manualTimers();
    const page = new UnsentTexts(memoryStorage, { remote: slow, timers, writer: "page" });
    page.set("chat-1", "First");
    timers.runAll();
    page.set("chat-1", "Second");
    timers.runAll();
    expect(answers).toHaveLength(1);
    answers.shift()?.();
    await settle();
    expect(answers).toHaveLength(1);
    answers.shift()?.();
    await settle();
    expect(eva.saves.map((save) => save.text)).toEqual(["First", "Second"]);
    expect(timers.waiting).toBe(0);
  });

  test("a hidden page sends its texts at once, and a cleared summary stays cleared on Eva", async () => {
    const eva = fakeEva();
    const timers = manualTimers();
    const page = new UnsentTexts(memoryStorage, { remote: eva, timers, writer: "page" });
    page.set("chat-1", "", true);
    page.set("chat-2", "Before the switch");
    page.flushAll();
    await settle();
    expect(eva.saves).toEqual([
      { key: "chat-1", text: "", keepEmpty: true },
      { key: "chat-2", text: "Before the switch", keepEmpty: false },
    ]);
  });
});
