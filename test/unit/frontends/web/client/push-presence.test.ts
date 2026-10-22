import { describe, expect, test } from "bun:test";
import { startPushPresence, type PresencePage } from "../../../../../src/frontends/web/client/push-presence.ts";

type Listener = () => void;

interface FakePage {
  readonly page: PresencePage;
  readonly sent: [string, string, boolean][];
  inView: boolean;
  endpoint: string | null;
  readonly fire: (name: "view" | "leave" | "device" | "timer") => void;
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
    endpoint: "https://fcm.googleapis.com/fcm/send/phone",
    fire: (name) => listeners.get(name)?.(),
    listening: () => listeners.size,
    page: {
      isInView: () => fake.inView,
      readEndpoint: () => Promise.resolve(fake.endpoint),
      send: (endpoint, pageId, inView) => {
        fake.sent.push([endpoint, pageId, inView]);
        return Promise.resolve();
      },
      onViewChange: on("view"),
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
    const stop = startPushPresence(fake.page);
    await settle();
    fake.fire("timer");
    fake.inView = false;
    fake.fire("view");
    // Out of view, the renewal sends nothing: the claim must end.
    fake.fire("timer");
    fake.inView = true;
    fake.fire("leave");
    const endpoint = fake.endpoint ?? "";
    expect(fake.sent).toEqual([
      [endpoint, "tab-1", true],
      [endpoint, "tab-1", true],
      [endpoint, "tab-1", false],
      [endpoint, "tab-1", false],
    ]);
    stop();
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
    expect(fake.sent).toEqual([[fake.endpoint, "tab-1", true]]);
  });

  test("a failed claim or a failed read stays quiet", async () => {
    const fake = fakePage();
    startPushPresence({ ...fake.page, send: () => Promise.reject(new Error("offline")) });
    startPushPresence({ ...fake.page, readEndpoint: () => Promise.reject(new Error("no worker")) });
    await settle();
    expect(fake.sent).toEqual([]);
  });
});
