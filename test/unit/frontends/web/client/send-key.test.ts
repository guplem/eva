import { afterEach, describe, expect, test } from "bun:test";
import { readSendKeys, saveSendKeys, sendKeyHint } from "../../../../../src/frontends/web/client/send-key.ts";

function useStorage(storage: unknown): void {
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

/** A storage that keeps its items in a map, as a browser does. */
function mapStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  } as unknown as Storage;
}

const blocked = (): never => {
  throw new Error("blocked");
};

describe("send keys", () => {
  afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

  test("a new browser sends on Ctrl+Enter", () => {
    useStorage(mapStorage());
    expect(readSendKeys()).toEqual(["ctrl-enter"]);
  });

  test("a browser keeps the keys that the person chose, in a fixed order", () => {
    useStorage(mapStorage());
    saveSendKeys(["shift-enter", "ctrl-enter"]);
    expect(readSendKeys()).toEqual(["ctrl-enter", "shift-enter"]);
    saveSendKeys(["enter"]);
    expect(readSendKeys()).toEqual(["enter"]);
  });

  test("a browser can keep no send key", () => {
    useStorage(mapStorage());
    saveSendKeys([]);
    expect(readSendKeys()).toEqual([]);
  });

  test("a key that the person chose before #1097 keeps the keys that sent then", () => {
    for (const [old, keys] of [
      ["ctrl-enter", ["ctrl-enter"]],
      // The old Enter choice also sent on Ctrl+Enter.
      ["enter", ["ctrl-enter", "enter"]],
      ["shift-enter", ["shift-enter"]],
    ] as const) {
      const storage = mapStorage();
      storage.setItem("eva.send-key", old);
      useStorage(storage);
      expect(readSendKeys()).toEqual([...keys]);
    }
  });

  test("a new choice wins over the old key", () => {
    const storage = mapStorage();
    storage.setItem("eva.send-key", "enter");
    useStorage(storage);
    saveSendKeys([]);
    expect(readSendKeys()).toEqual([]);
  });

  test("a broken stored value gives the default", () => {
    for (const broken of ["space", "[1]", '"enter"', "{", '["enter", "space"]']) {
      const storage = mapStorage();
      storage.setItem("eva.send-keys", broken);
      useStorage(storage);
      expect(readSendKeys()).toEqual(["ctrl-enter"]);
    }
    const storage = mapStorage();
    storage.setItem("eva.send-key", "space");
    useStorage(storage);
    expect(readSendKeys()).toEqual(["ctrl-enter"]);
  });

  test("blocked storage gives the default, and a save does not throw", () => {
    useStorage({ getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(readSendKeys()).toEqual(["ctrl-enter"]);
    expect(() => saveSendKeys(["enter"])).not.toThrow();
  });
});

describe("sendKeyHint", () => {
  test("names the keys that send and the keys that add a new line", () => {
    expect(sendKeyHint(["ctrl-enter"])).toBe(
      "Ctrl+Enter sends. On a Mac, Cmd+Enter sends too. Enter and Shift+Enter add a new line.",
    );
    expect(sendKeyHint(["enter"])).toBe(
      "Enter sends. Shift+Enter adds a new line. A phone keyboard then has no key for a new line.",
    );
    expect(sendKeyHint(["shift-enter"])).toBe("Shift+Enter sends. Enter adds a new line.");
    expect(sendKeyHint(["ctrl-enter", "shift-enter"])).toBe(
      "Ctrl+Enter and Shift+Enter send. On a Mac, Cmd+Enter sends too. Enter adds a new line.",
    );
    expect(sendKeyHint(["ctrl-enter", "enter", "shift-enter"])).toBe(
      "Ctrl+Enter, Enter and Shift+Enter send. On a Mac, Cmd+Enter sends too. A phone keyboard then has no key for a new line.",
    );
  });

  test("with no send key, says that only the send button sends", () => {
    expect(sendKeyHint([])).toBe("Only the send button sends. Enter and Shift+Enter add a new line.");
  });
});
