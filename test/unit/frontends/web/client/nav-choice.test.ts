import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  defaultNavChoice,
  faceFixedReason,
  isFixedEntry,
  maxPhoneEntries,
  navChoice,
  navChoiceKey,
  onNavChoiceChange,
  readNavChoice,
  saveNavChoice,
  shownDestinations,
  toggled,
  type NavChoice,
} from "../../../../../src/frontends/web/client/nav-choice.ts";
import { destinations } from "../../../../../src/frontends/web/client/navigation.ts";

class FakeStorage {
  public readonly items: Map<string, string>;
  public constructor(initial: Record<string, string> = {}) {
    this.items = new Map(Object.entries(initial));
  }
  public getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

function useStorage(storage: unknown): void {
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

const everyEntry = destinations.map((destination) => destination.id);

describe("the default choice", () => {
  test("a computer shows every destination", () => {
    expect(defaultNavChoice.computer).toEqual(everyEntry);
  });

  test("a phone shows Chats, Projects, Files and Schedules", () => {
    expect(defaultNavChoice.phone).toEqual(["chats", "projects", "files", "schedules"]);
    expect(defaultNavChoice.phone.length).toBeLessThanOrEqual(maxPhoneEntries);
  });
});

describe("readNavChoice", () => {
  afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

  test("gives the defaults when the browser keeps nothing", () => {
    useStorage(new FakeStorage());
    expect(readNavChoice()).toEqual(defaultNavChoice);
  });

  test("gives the defaults when the storage throws, as in a private window", () => {
    useStorage({
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readNavChoice()).toEqual(defaultNavChoice);
  });

  test("gives the defaults when no storage exists", () => {
    expect(readNavChoice()).toEqual(defaultNavChoice);
  });

  test("gives the defaults for a value that is not a choice", () => {
    for (const stored of ["not json", "42", "null", "[]", '{"computer":"chats"}']) {
      useStorage(new FakeStorage({ [navChoiceKey]: stored }));
      expect(readNavChoice(), stored).toEqual(defaultNavChoice);
    }
  });

  test("drops an unknown id, keeps the fixed order and adds Settings on a computer", () => {
    useStorage(
      new FakeStorage({
        [navChoiceKey]: JSON.stringify({ computer: ["files", "nothing", 7, "chats"], phone: ["pets", "old", "chats"] }),
      }),
    );
    expect(readNavChoice()).toEqual({ computer: ["chats", "files", "settings"], phone: ["chats", "pets"] });
  });

  test("keeps the default of one form when only the other is bad", () => {
    useStorage(new FakeStorage({ [navChoiceKey]: JSON.stringify({ computer: ["chats"], phone: "files" }) }));
    expect(readNavChoice()).toEqual({ computer: ["chats", "settings"], phone: defaultNavChoice.phone });
  });

  test("keeps no more than the phone can hold", () => {
    useStorage(new FakeStorage({ [navChoiceKey]: JSON.stringify({ computer: [], phone: everyEntry }) }));
    expect(readNavChoice().phone).toEqual(["chats", "projects", "files", "schedules"]);
  });
});

describe("toggled", () => {
  test("turns an entry off, then on again in its place", () => {
    const off = toggled(defaultNavChoice, "computer", "cases");
    if (!off.ok) throw new Error(off.reason);
    expect(off.choice.computer).not.toContain("cases");
    expect(off.choice.phone).toEqual(defaultNavChoice.phone);
    const on = toggled(off.choice, "computer", "cases");
    if (!on.ok) throw new Error(on.reason);
    expect(on.choice.computer).toEqual(defaultNavChoice.computer);
  });

  test("refuses to hide Settings on a computer, and says why", () => {
    const result = toggled(defaultNavChoice, "computer", "settings");
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("Settings") as unknown as string });
    expect(isFixedEntry("computer", "settings")).toBe(true);
    expect(isFixedEntry("phone", "settings")).toBe(false);
  });

  test("Eva's face is fixed on both forms, and the reason says what it opens", () => {
    expect(faceFixedReason).toContain("home page");
  });

  test("lets a phone show Settings in place of another entry", () => {
    const off = toggled(defaultNavChoice, "phone", "files");
    if (!off.ok) throw new Error(off.reason);
    const on = toggled(off.choice, "phone", "settings");
    if (!on.ok) throw new Error(on.reason);
    expect(on.choice.phone).toEqual(["chats", "projects", "schedules", "settings"]);
  });

  test("refuses a fifth phone entry, and says why", () => {
    const result = toggled(defaultNavChoice, "phone", "pets");
    if (result.ok) throw new Error("The phone took a fifth entry.");
    expect(result.reason).toContain(String(maxPhoneEntries));
  });

  test("lets a phone show no entry at all beside Eva's face", () => {
    let choice: NavChoice = defaultNavChoice;
    for (const id of defaultNavChoice.phone) {
      const result = toggled(choice, "phone", id);
      if (!result.ok) throw new Error(result.reason);
      choice = result.choice;
    }
    expect(choice.phone).toEqual([]);
  });
});

describe("shownDestinations", () => {
  test("a computer shows its list in the fixed order, with Settings last", () => {
    const choice: NavChoice = { computer: ["files", "chats", "settings"], phone: [] };
    expect(shownDestinations(choice, false).map((destination) => destination.id)).toEqual([
      "chats",
      "files",
      "settings",
    ]);
  });

  test("a phone shows its own list", () => {
    expect(shownDestinations(defaultNavChoice, true).map((destination) => destination.label)).toEqual([
      "Chats",
      "Projects",
      "Files",
      "Schedules",
    ]);
  });
});

describe("the store", () => {
  beforeEach(() => useStorage(new FakeStorage()));
  afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

  test("a saved choice reaches each listener at once and stays in the browser", () => {
    const storage = new FakeStorage();
    useStorage(storage);
    let calls = 0;
    const stop = onNavChoiceChange(() => (calls += 1));
    const next: NavChoice = { computer: ["chats", "settings"], phone: ["chats"] };
    saveNavChoice(next);
    expect(calls).toBe(1);
    expect(navChoice()).toEqual(next);
    expect(JSON.parse(storage.getItem(navChoiceKey) ?? "null")).toEqual(next);
    stop();
    saveNavChoice(defaultNavChoice);
    expect(calls).toBe(1);
    expect(navChoice()).toEqual(defaultNavChoice);
  });

  test("a storage that refuses to write still changes the page until a reload", () => {
    useStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
    });
    const next: NavChoice = { computer: ["settings"], phone: [] };
    saveNavChoice(next);
    expect(navChoice()).toEqual(next);
    saveNavChoice(defaultNavChoice);
  });
});
