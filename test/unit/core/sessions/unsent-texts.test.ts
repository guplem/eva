import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  UnsentTextStore,
  type UnsentTextAnswer,
  type UnsentTextEvent,
} from "../../../../src/core/sessions/unsent-texts.ts";
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

/** A store whose clock stands still, so each write gets the next revision. */
function store(maxTexts?: number): UnsentTextStore {
  return new UnsentTextStore(path, new Redactor(), { now: () => 0, ...(maxTexts === undefined ? {} : { maxTexts }) });
}

function revisionOf(answer: UnsentTextAnswer): number {
  if (!answer.accepted) throw new Error("The store refused the write.");
  return answer.revision;
}

describe("UnsentTextStore", () => {
  test("a restart keeps the unsent text of each chat", () => {
    const revision = revisionOf(store().set("chat-1", "Half a thought", false, "page-1", null));
    const afterRestart = store().list();
    expect(afterRestart.texts).toEqual({ "chat-1": { text: "Half a thought", revision } });
    expect(afterRestart.revision).toBe(revision);
  });

  test("each write gets a higher revision, also after a restart", () => {
    const first = revisionOf(store().set("chat-1", "One", false, "page-1", null));
    const texts = store();
    const second = revisionOf(texts.set("chat-2", "Two", false, "page-1", null));
    expect(second).toBeGreaterThan(first);
    expect(revisionOf(texts.set("chat-1", "Three", false, "page-1", first))).toBeGreaterThan(second);
  });

  test("a lost file never gives a revision that an open page already knows", () => {
    let now = 1_000;
    const options = { now: () => now };
    const first = revisionOf(new UnsentTextStore(path, new Redactor(), options).set("chat-1", "One", false, "p", null));
    rmSync(path);
    now = 2_000;
    const second = revisionOf(
      new UnsentTextStore(path, new Redactor(), options).set("chat-1", "Two", false, "p", null),
    );
    expect(second).toBeGreaterThan(first);
  });

  test("an empty text removes the text, unless the write keeps the clear", () => {
    const texts = store();
    const written = revisionOf(texts.set("chat-1", "Hello", false, "page-1", null));
    const removed = revisionOf(texts.set("chat-1", "", false, "page-1", written));
    texts.set("chat-2", "", true, "page-1", null);
    expect(texts.list().texts).toEqual({ "chat-2": { text: "", revision: removed + 1 } });
    // The store tells a removed text from one it never knew.
    expect(texts.list().removed).toEqual({ "chat-1": removed });
  });

  test("a write on an older base is refused, so an old text never comes back over a newer one", () => {
    const texts = store();
    const phone = revisionOf(texts.set("chat-1", "Typed on the phone", false, "phone", null));
    const sent = revisionOf(texts.set("chat-1", "", false, "computer", phone));
    // The phone slept before it got the answer, so it sends its text again on the base it knew.
    expect(texts.set("chat-1", "Typed on the phone", false, "phone", 0)).toEqual({
      accepted: false,
      text: null,
      revision: sent,
    });
    expect(texts.list().texts).toEqual({});
  });

  test("the page that wrote the newest text may write over it, even on an older base", () => {
    const texts = store();
    revisionOf(texts.set("chat-1", "One", false, "phone", null));
    // The phone never got the answer, so it still builds on no revision that it knows.
    expect(texts.set("chat-1", "One more", false, "phone", 0).accepted).toBe(true);
  });

  test("a write with no base is a text that Eva never saw, so it goes in", () => {
    const texts = store();
    texts.set("chat-1", "From the computer", false, "computer", null);
    expect(texts.set("chat-1", "From an old tab", false, "old-tab", null).accepted).toBe(true);
  });

  test("the store keeps a redacted text, so a secret never reaches another device", () => {
    const redactor = new Redactor();
    redactor.addSecret("very-secret-value-123");
    const texts = new UnsentTextStore(path, redactor);
    texts.set("chat-1", "My key is very-secret-value-123", false, "page-1", null);
    expect(texts.list().texts["chat-1"]?.text).not.toContain("very-secret-value-123");
  });

  test("each write reaches the listeners with the page that wrote it", () => {
    const texts = store();
    const events: UnsentTextEvent[] = [];
    const stop = texts.subscribe((event) => events.push(event));
    const revision = revisionOf(texts.set("chat-1", "Hello", false, "page-1", null));
    texts.set("chat-1", "", false, "page-2", revision);
    stop();
    texts.set("chat-1", "Unheard", false, "page-1", null);
    expect(events).toEqual([
      { kind: "unsent_text", key: "chat-1", text: "Hello", revision, writer: "page-1" },
      { kind: "unsent_text", key: "chat-1", text: null, revision: revision + 1, writer: "page-2" },
    ]);
  });

  test("a delete of a chat removes its text and tells the pages", () => {
    const texts = store();
    texts.set("chat-1", "Hello", false, "page-1", null);
    const events: UnsentTextEvent[] = [];
    texts.subscribe((event) => events.push(event));
    texts.remove("chat-1");
    texts.remove("chat-1");
    texts.remove("chat-2");
    expect(texts.list().texts).toEqual({});
    expect(events).toEqual([{ kind: "unsent_text", key: "chat-1", text: null, revision: 2, writer: null }]);
  });

  test("a full store drops the oldest entry", () => {
    const texts = store(2);
    texts.set("chat-1", "One", false, "page-1", null);
    texts.set("chat-2", "Two", false, "page-1", null);
    texts.set("chat-1", "One again", false, "page-1", null);
    texts.set("chat-3", "Three", false, "page-1", null);
    expect(Object.keys(texts.list().texts).sort()).toEqual(["chat-1", "chat-3"]);
  });

  test("a broken file starts an empty store, and a bad entry costs only that entry", () => {
    writeFileSync(join(folder, "broken.json"), "{ not json");
    expect(new UnsentTextStore(join(folder, "broken.json"), new Redactor()).list()).toEqual({
      revision: 0,
      texts: {},
      removed: {},
    });
    const mixed = join(folder, "mixed.json");
    writeFileSync(
      mixed,
      JSON.stringify({
        revision: 7,
        entries: { good: { text: "Kept", revision: 5, writer: "p" }, gone: { text: null, revision: 6 }, bad: {} },
      }),
    );
    expect(new UnsentTextStore(mixed, new Redactor()).list()).toEqual({
      revision: 7,
      texts: { good: { text: "Kept", revision: 5 } },
      removed: { gone: 6 },
    });
  });
});
