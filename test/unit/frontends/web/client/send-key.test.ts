import { afterEach, describe, expect, test } from "bun:test";
import { readSendKey, saveSendKey } from "../../../../../src/frontends/web/client/send-key.ts";

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

describe("send key", () => {
  afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

  test("a new browser sends on Ctrl+Enter", () => {
    useStorage(mapStorage());
    expect(readSendKey()).toBe("ctrl-enter");
  });

  test("a browser keeps the key that the person chose", () => {
    useStorage(mapStorage());
    saveSendKey("enter");
    expect(readSendKey()).toBe("enter");
    saveSendKey("shift-enter");
    expect(readSendKey()).toBe("shift-enter");
  });

  test("a broken stored value gives the default", () => {
    const storage = mapStorage();
    storage.setItem("eva.send-key", "space");
    useStorage(storage);
    expect(readSendKey()).toBe("ctrl-enter");
  });

  test("blocked storage gives the default, and a save does not throw", () => {
    useStorage({ getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(readSendKey()).toBe("ctrl-enter");
    expect(() => saveSendKey("enter")).not.toThrow();
  });
});
