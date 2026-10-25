import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  goTo,
  goUp,
  leaveFor,
  openLayer,
  replaceAddress,
  restoreLayer,
  watchLayers,
  type LayerWindow,
} from "../../../../../src/frontends/web/client/back-layers.ts";
import { answerLeave, holdLeave, type LeaveHold } from "../../../../../src/frontends/web/client/leave-guard.ts";

interface Entry {
  hash: string;
  state: unknown;
}

/** A browser history: a step runs only when the test lets it arrive, as a real step runs later. */
interface FakeBrowser extends LayerWindow {
  readonly entries: Entry[];
  readonly index: number;
  readonly current: Entry;
  readonly steps: number[];
  readonly timers: Map<number, () => void>;
  /** The step that the page asked for arrives. */
  arrive(): void;
  /** The person presses Back. */
  back(): void;
  /** The person presses Forward. */
  forward(): void;
}

function fakeBrowser(): FakeBrowser {
  const entries: Entry[] = [{ hash: "#/chats", state: { evaPlace: 0 } }];
  let index = 0;
  const steps: number[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const listeners: ((event: Event) => void)[] = [];
  const current = (): Entry => entries[index] ?? { hash: "", state: null };
  const add = (entry: Entry): void => {
    entries.splice(index + 1);
    entries.push(entry);
    index += 1;
  };
  const firePopState = (): void => {
    for (const listener of listeners) listener(new Event("popstate"));
  };
  return {
    entries,
    get index(): number {
      return index;
    },
    get current(): Entry {
      return current();
    },
    steps,
    timers,
    location: {
      get hash(): string {
        return current().hash;
      },
      set hash(address: string) {
        add({ hash: address, state: null });
        firePopState();
      },
    },
    history: {
      get state(): unknown {
        return current().state;
      },
      pushState: (data: unknown): void => add({ hash: current().hash, state: data }),
      replaceState: (data: unknown, _unused: string, url?: string): void => {
        entries[index] = { hash: url ?? current().hash, state: data };
      },
      go: (delta: number): void => {
        steps.push(delta);
      },
    },
    addEventListener: (type: string, listener: (event: Event) => void): void => {
      if (type === "popstate") listeners.push(listener);
    },
    setTimeout: (handler: () => void): unknown => {
      const id = nextTimer++;
      timers.set(id, handler);
      return id;
    },
    clearTimeout: (id: unknown): void => {
      timers.delete(id as number);
    },
    arrive: (): void => {
      const delta = steps.shift();
      if (delta === undefined) throw new Error("No step waits.");
      index += delta;
      firePopState();
    },
    back: (): void => {
      index -= 1;
      firePopState();
    },
    forward: (): void => {
      index += 1;
      firePopState();
    },
  };
}

let browser: FakeBrowser;
const holds: LeaveHold[] = [];

beforeEach(() => {
  browser = fakeBrowser();
  watchLayers(browser);
});

afterEach(async () => {
  await answerLeave("stay");
  for (const held of holds.splice(0)) held.release();
});

describe("openLayer", () => {
  test("adds an entry on the same address, and Back closes the layer", () => {
    let closed = 0;
    openLayer("dialog", () => (closed += 1));
    expect(browser.entries).toHaveLength(2);
    expect(browser.current.hash).toBe("#/chats");
    browser.back();
    expect(closed).toBe(1);
  });

  test("the entry keeps the state of the page, such as the place of the unsaved changes guard", () => {
    openLayer("dialog", () => undefined);
    expect(browser.current.state).toMatchObject({ evaPlace: 0, evaLayers: ["dialog"] });
  });

  test("Back closes only the top layer", () => {
    const closed: string[] = [];
    openLayer("sheet", () => closed.push("sheet"));
    openLayer("dialog", () => closed.push("dialog"));
    browser.back();
    expect(closed).toEqual(["dialog"]);
    browser.back();
    expect(closed).toEqual(["dialog", "sheet"]);
  });

  test("a close from the page steps back over its entry, and Back then calls nothing", () => {
    let closed = 0;
    const layer = openLayer("dialog", () => (closed += 1));
    layer.close();
    expect(browser.steps).toEqual([-1]);
    browser.arrive();
    expect(browser.index).toBe(0);
    expect(closed).toBe(0);
    layer.close();
    expect(browser.steps).toEqual([]);
  });

  test("a layer that opens while a step runs waits for it, so the step does not take its entry", () => {
    openLayer("menu", () => undefined).close();
    let closed = 0;
    openLayer("dialog", () => (closed += 1));
    expect(browser.entries).toHaveLength(2);
    browser.arrive();
    expect(browser.index).toBe(1);
    expect(browser.current.state).toMatchObject({ evaLayers: ["dialog"] });
    browser.back();
    expect(closed).toBe(1);
  });

  test("a layer that closes before the history is free adds no entry", () => {
    openLayer("menu", () => undefined).close();
    openLayer("dialog", () => undefined).close();
    browser.arrive();
    expect(browser.index).toBe(0);
    expect(browser.steps).toEqual([]);
  });

  test("a new address leaves the layers open with no entry, so Back goes to the page before", () => {
    let closed = 0;
    const layer = openLayer("menu", () => (closed += 1));
    goTo("#/chats/b");
    expect(browser.current.hash).toBe("#/chats/b");
    layer.close();
    expect(browser.steps).toEqual([]);
    expect(closed).toBe(0);
  });

  test("a step that never arrives frees the history after a while", () => {
    openLayer("menu", () => undefined).close();
    goTo("#/files");
    expect(browser.current.hash).toBe("#/chats");
    for (const timer of browser.timers.values()) timer();
    expect(browser.current.hash).toBe("#/files");
  });
});

describe("restoreLayer", () => {
  test("Back to the entry of a layer with a restorer opens it again, and the layer takes that entry", () => {
    let restored = 0;
    const stop = restoreLayer("list", () => {
      restored += 1;
      openLayer("list", () => undefined);
    });
    openLayer("list", () => undefined);
    goTo("#/chats/b");
    browser.back();
    expect(restored).toBe(1);
    expect(browser.entries).toHaveLength(3);
    expect(browser.index).toBe(1);
    stop();
  });

  test("two layers open again in the order of their entry, whatever order the page opens them in", () => {
    const closed: string[] = [];
    const stops = [restoreLayer("list", () => undefined), restoreLayer("archived", () => undefined)];
    openLayer("list", () => undefined);
    openLayer("archived", () => undefined);
    goTo("#/chats/b");
    browser.back();
    // A child opens before its parent.
    openLayer("archived", () => closed.push("archived"));
    openLayer("list", () => closed.push("list"));
    expect(browser.entries).toHaveLength(4);
    browser.back();
    expect(closed).toEqual(["archived"]);
    browser.back();
    expect(closed).toEqual(["archived", "list"]);
    for (const stop of stops) stop();
  });

  test("a layer that is not restored adds its own entry, even with the same key as a closed one", () => {
    openLayer("layer", () => undefined);
    goTo("#/chats/b");
    browser.back();
    browser.arrive();
    openLayer("layer", () => undefined);
    expect(browser.index).toBe(1);
    expect(browser.entries).toHaveLength(2);
  });

  test("Forward over the entry of a closed dialog skips it forward", () => {
    openLayer("dialog", () => undefined);
    goTo("#/chats/b");
    browser.back();
    browser.arrive();
    browser.forward();
    expect(browser.steps).toEqual([1]);
    browser.arrive();
    expect(browser.current.hash).toBe("#/chats/b");
  });

  test("with an unsaved change, Back to the chat list does not open it", () => {
    let restored = 0;
    const stop = restoreLayer("list", () => (restored += 1));
    openLayer("list", () => undefined);
    goTo("#/chats/b");
    holds.push(holdLeave(null));
    browser.back();
    expect(restored).toBe(0);
    stop();
  });

  test("Back to the entry of a closed dialog skips it", () => {
    openLayer("dialog", () => undefined);
    goTo("#/chats/b");
    browser.back();
    expect(browser.steps).toEqual([-1]);
    browser.arrive();
    expect(browser.index).toBe(0);
  });

  test("with an unsaved change, the guard owns the steps, so no skip runs", () => {
    openLayer("dialog", () => undefined);
    goTo("#/chats/b");
    holds.push(holdLeave(null));
    browser.back();
    expect(browser.steps).toEqual([]);
  });

  test("a stopped restorer opens nothing", () => {
    let restored = 0;
    restoreLayer("list", () => (restored += 1))();
    openLayer("list", () => undefined);
    goTo("#/chats/b");
    browser.back();
    expect(restored).toBe(0);
  });
});

describe("goTo and goUp", () => {
  test("goTo adds an entry that remembers the address before", () => {
    goTo("#/projects/p");
    expect(browser.entries.map((entry) => entry.hash)).toEqual(["#/chats", "#/projects/p"]);
    expect(browser.current.state).toMatchObject({ evaFrom: "#/chats" });
  });

  test("goTo to the same address runs onSame and adds no entry", () => {
    let same = 0;
    goTo("#/chats", () => (same += 1));
    expect(same).toBe(1);
    expect(browser.entries).toHaveLength(1);
  });

  test("goUp to the page that the person came from steps back", () => {
    goTo("#/projects");
    goTo("#/projects/p");
    goUp("#/projects");
    expect(browser.steps).toEqual([-1]);
    browser.arrive();
    expect(browser.current.hash).toBe("#/projects");
  });

  test("goUp to another page adds an entry", () => {
    goTo("#/projects/p/chat/c");
    goUp("#/projects/p");
    expect(browser.steps).toEqual([]);
    expect(browser.current.hash).toBe("#/projects/p");
  });

  test("goUp from a layer's entry adds an entry, because Back from there goes to the same page", () => {
    goTo("#/projects/p");
    openLayer("menu", () => undefined);
    goUp("#/chats");
    expect(browser.current.hash).toBe("#/chats");
  });

  test("leaveFor steps back to the page above when the person came from there", () => {
    goTo("#/projects/p");
    goTo("#/projects/p/chat/c");
    let replaced = 0;
    leaveFor("#/projects/p", () => (replaced += 1));
    expect(browser.steps).toEqual([-1]);
    expect(replaced).toBe(0);
  });

  test("leaveFor gives this entry the address above otherwise, so Back never returns to the page that is gone", () => {
    goTo("#/projects/p/chat/c");
    let replaced = 0;
    leaveFor("#/projects/p", () => (replaced += 1));
    expect(browser.entries.map((entry) => entry.hash)).toEqual(["#/chats", "#/projects/p"]);
    expect(replaced).toBe(1);
  });

  test("replaceAddress changes the address of this entry and keeps its state", () => {
    replaceAddress("#/chats/a");
    expect(browser.entries).toHaveLength(1);
    expect(browser.current).toMatchObject({ hash: "#/chats/a", state: { evaPlace: 0 } });
  });
});

describe("watchLayers", () => {
  test("a reload drops the layers of the entry, because no layer is open after it", () => {
    browser.entries[0] = { hash: "#/chats", state: { evaPlace: 0, evaLayers: ["dialog"] } };
    watchLayers(browser);
    expect(browser.current.state).toMatchObject({ evaPlace: 0, evaLayers: [] });
  });
});
