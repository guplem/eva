import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnsentTextStore, type UnsentTextEvent } from "../../../../src/core/sessions/unsent-texts.ts";
import { Redactor } from "../../../../src/shared/redaction.ts";

let folder: string;
let path: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-unsent-"));
  path = join(folder, "state", "unsent-texts.json");
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("UnsentTextStore", () => {
  test("a restart keeps the unsent text of each chat", () => {
    const revision = new UnsentTextStore(path, new Redactor()).set("chat-1", "Half a thought", false, "page-1");
    const afterRestart = new UnsentTextStore(path, new Redactor()).list();
    expect(afterRestart.texts).toEqual({ "chat-1": { text: "Half a thought", revision } });
    expect(afterRestart.revision).toBe(revision);
  });

  test("each write gets a higher revision, also after a restart", () => {
    const first = new UnsentTextStore(path, new Redactor()).set("chat-1", "One", false, "page-1");
    const store = new UnsentTextStore(path, new Redactor());
    const second = store.set("chat-2", "Two", false, "page-1");
    expect(second).toBeGreaterThan(first);
    expect(store.set("chat-1", "Three", false, "page-1")).toBeGreaterThan(second);
  });

  test("an empty text removes the entry, unless the write keeps the clear", () => {
    const store = new UnsentTextStore(path, new Redactor());
    store.set("chat-1", "Hello", false, "page-1");
    store.set("chat-1", "", false, "page-1");
    store.set("chat-2", "", true, "page-1");
    expect(Object.keys(store.list().texts)).toEqual(["chat-2"]);
    expect(store.list().texts["chat-2"]?.text).toBe("");
  });

  test("the store keeps a redacted text, so a secret never reaches another device", () => {
    const redactor = new Redactor();
    redactor.addSecret("very-secret-value-123");
    const store = new UnsentTextStore(path, redactor);
    store.set("chat-1", "My key is very-secret-value-123", false, "page-1");
    expect(store.list().texts["chat-1"]?.text).not.toContain("very-secret-value-123");
  });

  test("each write reaches the listeners with the page that wrote it", () => {
    const store = new UnsentTextStore(path, new Redactor(), { now: () => 0 });
    const events: UnsentTextEvent[] = [];
    const stop = store.subscribe((event) => events.push(event));
    const revision = store.set("chat-1", "Hello", false, "page-1");
    store.set("chat-1", "", false, "page-2");
    stop();
    store.set("chat-1", "Unheard", false, "page-1");
    expect(events).toEqual([
      { kind: "unsent_text", key: "chat-1", text: "Hello", revision, writer: "page-1" },
      { kind: "unsent_text", key: "chat-1", text: null, revision: revision + 1, writer: "page-2" },
    ]);
  });

  test("a delete of a chat removes its text and tells the pages", () => {
    const store = new UnsentTextStore(path, new Redactor(), { now: () => 0 });
    store.set("chat-1", "Hello", false, "page-1");
    const events: UnsentTextEvent[] = [];
    store.subscribe((event) => events.push(event));
    store.remove("chat-1");
    store.remove("chat-2");
    expect(store.list().texts).toEqual({});
    expect(events).toEqual([{ kind: "unsent_text", key: "chat-1", text: null, revision: 2, writer: null }]);
  });

  test("a lost file never gives a revision that an open page already knows", () => {
    let now = 1_000;
    const first = new UnsentTextStore(path, new Redactor(), { now: () => now }).set("chat-1", "One", false, "page-1");
    rmSync(path);
    now = 2_000;
    expect(
      new UnsentTextStore(path, new Redactor(), { now: () => now }).set("chat-1", "Two", false, "page-1"),
    ).toBeGreaterThan(first);
  });

  test("a full store drops the oldest text", () => {
    const store = new UnsentTextStore(path, new Redactor(), { maxTexts: 2 });
    store.set("chat-1", "One", false, "page-1");
    store.set("chat-2", "Two", false, "page-1");
    store.set("chat-1", "One again", false, "page-1");
    store.set("chat-3", "Three", false, "page-1");
    expect(Object.keys(store.list().texts).sort()).toEqual(["chat-1", "chat-3"]);
  });

  test("a broken file starts an empty store, and a bad entry costs only that entry", () => {
    writeFileSync(join(folder, "broken.json"), "{ not json");
    expect(new UnsentTextStore(join(folder, "broken.json"), new Redactor()).list()).toEqual({
      revision: 0,
      texts: {},
    });
    const mixed = join(folder, "mixed.json");
    writeFileSync(
      mixed,
      JSON.stringify({ revision: 7, texts: { good: { text: "Kept", revision: 5 }, bad: { text: 3 } } }),
    );
    expect(new UnsentTextStore(mixed, new Redactor()).list()).toEqual({
      revision: 7,
      texts: { good: { text: "Kept", revision: 5 } },
    });
  });
});
