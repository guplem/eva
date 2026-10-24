import { afterEach, describe, expect, test } from "bun:test";
import {
  answerLeave,
  askToLeave,
  hasUnsavedChanges,
  holdLeave,
  isAskingToLeave,
  leaveQuestion,
  subscribeToLeave,
  watchLeaving,
  type LeaveHold,
  type LeaveWindow,
} from "../../../../../src/frontends/web/client/leave-guard.ts";

const holds: LeaveHold[] = [];
const hold = (save: (() => Promise<boolean>) | null = () => Promise.resolve(true)): LeaveHold => {
  const held = holdLeave(save);
  holds.push(held);
  return held;
};

afterEach(async () => {
  await answerLeave("stay");
  for (const held of holds.splice(0)) held.release();
});

describe("askToLeave", () => {
  test("with nothing unsaved, the move runs at once", () => {
    let moved = false;
    askToLeave(() => (moved = true));
    expect(moved).toBe(true);
    expect(isAskingToLeave()).toBe(false);
  });

  test("with an unsaved change, the move waits and the listeners hear it", () => {
    let heard = 0;
    const stop = subscribeToLeave(() => heard++);
    hold();
    let moved = false;
    askToLeave(() => (moved = true));
    expect(moved).toBe(false);
    expect(leaveQuestion()).toEqual({ move: "leave", canSave: true });
    expect(heard).toBe(1);
    stop();
  });

  test("a released guard asks no more", () => {
    const held = holdLeave(() => Promise.resolve(true));
    expect(hasUnsavedChanges()).toBe(true);
    held.release();
    expect(hasUnsavedChanges()).toBe(false);
  });

  test("a guard with no save hides Save for the whole question", () => {
    hold();
    hold(null);
    askToLeave(() => undefined);
    expect(leaveQuestion()).toEqual({ move: "leave", canSave: false });
  });
});

describe("LeaveHold.ask", () => {
  test("asks about its own guard only, with the name of the move", async () => {
    const saved: string[] = [];
    hold(() => {
      saved.push("page");
      return Promise.resolve(true);
    });
    const dialog = hold(() => {
      saved.push("dialog");
      return Promise.resolve(true);
    });
    let closed = false;
    dialog.ask(() => (closed = true), "close");
    expect(leaveQuestion()).toEqual({ move: "close", canSave: true });
    expect(await answerLeave("save")).toBe(true);
    expect(saved).toEqual(["dialog"]);
    expect(closed).toBe(true);
  });

  test("a guard with no save under a page with one still hides Save only for itself", () => {
    hold(null);
    const page = hold();
    page.ask(() => undefined, "load again");
    expect(leaveQuestion()).toEqual({ move: "load again", canSave: true });
  });

  test("after its release, the move runs at once", () => {
    const held = holdLeave(() => Promise.resolve(true));
    held.release();
    let moved = false;
    held.ask(() => (moved = true), "close");
    expect(moved).toBe(true);
  });
});

describe("answerLeave", () => {
  test("Stay keeps the page and the guard", async () => {
    hold();
    let moved = false;
    askToLeave(() => (moved = true));
    expect(await answerLeave("stay")).toBe(false);
    expect(moved).toBe(false);
    expect(isAskingToLeave()).toBe(false);
    expect(hasUnsavedChanges()).toBe(true);
  });

  test("Discard makes the move without a save, and the move itself asks no more", async () => {
    let saves = 0;
    hold(() => {
      saves++;
      return Promise.resolve(true);
    });
    let inner = false;
    askToLeave(() => askToLeave(() => (inner = true)));
    expect(await answerLeave("discard")).toBe(true);
    expect(inner).toBe(true);
    expect(saves).toBe(0);
  });

  test("Discard keeps each guard until its form releases it, so a form that stays still asks later", async () => {
    hold();
    askToLeave(() => undefined);
    await answerLeave("discard");
    expect(hasUnsavedChanges()).toBe(true);
  });

  test("Save runs every save, then makes the move", async () => {
    const saved: string[] = [];
    hold(() => {
      saved.push("first");
      return Promise.resolve(true);
    });
    hold(() => {
      saved.push("second");
      return Promise.resolve(true);
    });
    let moved = false;
    askToLeave(() => (moved = true));
    expect(await answerLeave("save")).toBe(true);
    expect(saved).toEqual(["first", "second"]);
    expect(moved).toBe(true);
  });

  test("a failed save keeps the page, so the form can show why", async () => {
    hold(() => Promise.resolve(false));
    let moved = false;
    askToLeave(() => (moved = true));
    expect(await answerLeave("save")).toBe(false);
    expect(moved).toBe(false);
    expect(isAskingToLeave()).toBe(false);
    expect(hasUnsavedChanges()).toBe(true);
  });

  test("Save does nothing for a guard with no save", async () => {
    hold(null);
    let moved = false;
    askToLeave(() => (moved = true));
    expect(await answerLeave("save")).toBe(false);
    expect(moved).toBe(false);
  });

  test("with no move waiting, an answer does nothing", async () => {
    expect(await answerLeave("discard")).toBe(false);
  });
});

/** A window with an address, its history and listeners in order, as a browser has. */
class FakeWindow extends EventTarget implements LeaveWindow {
  address = "#/projects";
  readonly seen: string[] = [];
  readonly history = {
    replaceState: (_data: unknown, _unused: string, url: string): void => {
      this.address = new URL(url, "http://eva.test/").hash;
    },
  };

  constructor() {
    super();
    watchLeaving(this);
    // A view listens after the watch, as App does.
    this.addEventListener("hashchange", () => this.seen.push(this.address));
  }

  /** The person taps a link or the back button: the address changes first, then the event comes. */
  go(hash: string): void {
    const oldURL = `http://eva.test/${this.address}`;
    this.address = hash;
    this.dispatchEvent(Object.assign(new Event("hashchange"), { oldURL, newURL: `http://eva.test/${hash}` }));
  }
}

describe("watchLeaving", () => {
  test("with nothing unsaved, a new address reaches the views", () => {
    const window = new FakeWindow();
    window.go("#/chats");
    expect(window.seen).toEqual(["#/chats"]);
  });

  test("with an unsaved change, the old address stays until the person answers", async () => {
    const window = new FakeWindow();
    hold();
    window.go("#/chats");
    expect(window.address).toBe("#/projects");
    expect(window.seen).toEqual([]);
    expect(isAskingToLeave()).toBe(true);

    expect(await answerLeave("discard")).toBe(true);
    expect(window.address).toBe("#/chats");
    expect(window.seen).toEqual(["#/chats"]);
  });

  test("Stay keeps the old address", async () => {
    const window = new FakeWindow();
    hold();
    window.go("#/settings");
    await answerLeave("stay");
    expect(window.address).toBe("#/projects");
    expect(window.seen).toEqual([]);
  });

  test("a reload or a closed tab asks the browser only with an unsaved change", () => {
    const window = new FakeWindow();
    const unload = (): Event => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event;
    };
    expect(unload().defaultPrevented).toBe(false);
    hold();
    expect(unload().defaultPrevented).toBe(true);
  });
});
