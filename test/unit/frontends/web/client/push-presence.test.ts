import { describe, expect, test } from "bun:test";
import { startPushPresence, type PresencePage } from "../../../../../src/frontends/web/client/push-presence.ts";

type Listener = () => void;

interface FakePage {
  readonly page: PresencePage;
  readonly sent: [string, string, boolean, readonly string[]][];
  inView: boolean;
  chats: readonly string[];
  endpoint: string | null;
  readonly fire: (name: "view" | "chats" | "leave" | "device" | "timer") => void;
  readonly listening: () => number;
}

function fakePage(): FakePage {
  const listeners = new Map<string, Listener>();
  const on =
    (name: string) =>
    (listener: Listener): (() => void) => {
      listeners.set(name, listener);
      return () => listeners.delete(name);
    };
  const fake: FakePage = {
    sent: [],
    inView: true,
    chats: [],
    endpoint: "https://fcm.googleapis.com/fcm/send/phone",
    fire: (name) => listeners.get(name)?.(),
    listening: () => listeners.size,
    page: {
      isInView: () => fake.inView,
      readEndpoint: () => Promise.resolve(fake.endpoint),
      shownChats: () => fake.chats,
      send: (endpoint, pageId, inView, chats) => {
        fake.sent.push([endpoint, pageId, inView, chats]);
        return Promise.resolve();
      },
      onViewChange: on("view"),
      onChatsChange: on("chats"),
      onLeave: on("leave"),
      onDeviceChange: on("device"),
      setInterval: (callback) => on("timer")(callback),
      pageId: "tab-1",
    },
  };
  return fake;
}

const settle = (): Promise<void> => Bun.sleep(0);

describe("the page's claim that it is in view", () => {
  test("goes out at the start, on each change, on each renewal in view, and when the page closes", async () => {
    const fake = fakePage();
    startPushPresence(fake.page);
    await settle();
    fake.fire("timer");
    fake.inView = false;
    fake.fire("view");
    // Out of view, the renewal sends nothing: the claim must end.
    fake.fire("timer");
    fake.inView = true;
    fake.fire("view");
    fake.fire("leave");
    const endpoint = fake.endpoint ?? "";
    expect(fake.sent).toEqual([
      [endpoint, "tab-1", true, []],
      [endpoint, "tab-1", true, []],
      [endpoint, "tab-1", false, []],
      [endpoint, "tab-1", true, []],
      [endpoint, "tab-1", false, []],
    ]);
  });

  test("sends only a change: a blur and a hide together send one claim", async () => {
    const fake = fakePage();
    startPushPresence(fake.page);
    await settle();
    fake.inView = false;
    fake.fire("view");
    fake.fire("view");
    fake.fire("leave");
    expect(fake.sent.map(([, , inView]) => inView)).toEqual([true, false]);
  });

  test("names the chats that the page shows, and goes out again when they change (#614)", async () => {
    const fake = fakePage();
    fake.chats = ["chat-a"];
    startPushPresence(fake.page);
    await settle();
    fake.chats = ["chat-b"];
    fake.fire("chats");
    fake.fire("chats");
    fake.fire("timer");
    fake.inView = false;
    fake.chats = [];
    fake.fire("chats");
    expect(fake.sent.map(([, , inView, chats]) => [inView, chats])).toEqual([
      [true, ["chat-a"]],
      [true, ["chat-b"]],
      [true, ["chat-b"]],
      [false, []],
    ]);
  });

  test("ends its claim when it stops, as after a logout", async () => {
    const fake = fakePage();
    const stop = startPushPresence(fake.page);
    await settle();
    stop();
    expect(fake.sent.map(([, , inView]) => inView)).toEqual([true, false]);
    expect(fake.listening()).toBe(0);
  });

  test("goes out in the same tick as the change, with no wait for the browser", async () => {
    const fake = fakePage();
    startPushPresence(fake.page);
    await settle();
    fake.sent.length = 0;
    fake.inView = false;
    fake.fire("view");
    expect(fake.sent).toHaveLength(1);
  });

  test("starts when the device turns notifications on, while the page is in view", async () => {
    const fake = fakePage();
    fake.endpoint = null;
    startPushPresence(fake.page);
    await settle();
    fake.fire("timer");
    expect(fake.sent).toEqual([]);
    fake.endpoint = "https://fcm.googleapis.com/fcm/send/new";
    fake.fire("device");
    await settle();
    expect(fake.sent).toEqual([[fake.endpoint, "tab-1", true, []]]);
  });

  test("a failed claim or a failed read stays quiet", async () => {
    const fake = fakePage();
    startPushPresence({ ...fake.page, send: () => Promise.reject(new Error("offline")) });
    startPushPresence({ ...fake.page, readEndpoint: () => Promise.reject(new Error("no worker")) });
    await settle();
    expect(fake.sent).toEqual([]);
  });
});
