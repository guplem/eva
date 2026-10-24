import { describe, expect, test } from "bun:test";
import { UnsentTexts, type TextStorage } from "../../../../../src/frontends/web/client/unsent-texts.ts";

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
