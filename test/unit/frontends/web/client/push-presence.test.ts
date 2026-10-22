import { describe, expect, test } from "bun:test";
import { startPushPresence, type PresencePage } from "../../../../../src/frontends/web/client/push-presence.ts";

interface FakePage {
  readonly page: PresencePage;
  readonly sent: [string, boolean][];
  inView: boolean;
  endpoint: string | null;
  readonly viewChange: () => void;
  readonly leave: () => void;
  readonly tick: () => void;
  readonly stopped: () => boolean;
}

function fakePage(): FakePage {
  const listeners: { view: (() => void) | null; leave: (() => void) | null; timer: (() => void) | null } = {
    view: null,
    leave: null,
    timer: null,
  };
  const fake: FakePage = {
    sent: [],
    inView: true,
    endpoint: "https://fcm.googleapis.com/fcm/send/phone",
    viewChange: () => listeners.view?.(),
    leave: () => listeners.leave?.(),
    tick: () => listeners.timer?.(),
    stopped: () => listeners.view === null && listeners.leave === null && listeners.timer === null,
    page: {
      isInView: () => fake.inView,
      endpoint: () => Promise.resolve(fake.endpoint),
      send: (endpoint, inView) => {
        fake.sent.push([endpoint, inView]);
        return Promise.resolve();
      },
      onViewChange: (listener) => {
        listeners.view = listener;
        return () => {
          listeners.view = null;
        };
      },
      onLeave: (listener) => {
        listeners.leave = listener;
        return () => {
          listeners.leave = null;
        };
      },
      setInterval: (callback) => {
        listeners.timer = callback;
        return () => {
          listeners.timer = null;
        };
      },
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
    fake.tick();
    await settle();
    fake.inView = false;
    fake.viewChange();
    await settle();
    // Out of view, the renewal sends nothing: the claim must end.
    fake.tick();
    await settle();
    fake.inView = true;
    fake.leave();
    await settle();
    const endpoint = fake.endpoint ?? "";
    expect(fake.sent).toEqual([
      [endpoint, true],
      [endpoint, true],
      [endpoint, false],
      [endpoint, false],
    ]);
    stop();
    expect(fake.stopped()).toBe(true);
  });

  test("sends nothing from a device that gets no notifications", async () => {
    const fake = fakePage();
    fake.endpoint = null;
    startPushPresence(fake.page);
    await settle();
    expect(fake.sent).toEqual([]);
  });

  test("a failed claim stays quiet", async () => {
    const fake = fakePage();
    startPushPresence({ ...fake.page, send: () => Promise.reject(new Error("offline")) });
    await settle();
    expect(fake.sent).toEqual([]);
  });
});
