import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { serviceWorkerScript } from "../../../../src/frontends/web/service-worker-script.ts";

interface Shown {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly renotify?: boolean;
  readonly data: { readonly url: string };
}

type Listener = (event: { waitUntil: (work: Promise<unknown>) => void; notification?: unknown }) => void;

/** Runs the worker script with a fake browser: a cache, a fetch of the alert list, and notifications. */
interface FakeWorker {
  readonly shown: Shown[];
  readonly opened: string[];
  readonly push: () => Promise<void>;
  readonly click: (url: string) => Promise<void>;
}

function worker(alerts: () => unknown[]): FakeWorker {
  const listeners = new Map<string, Listener>();
  const shown: Shown[] = [];
  const store = new Map<string, string>();
  const opened: string[] = [];
  const self = {
    addEventListener: (name: string, listener: Listener) => listeners.set(name, listener),
    skipWaiting: () => undefined,
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve([]),
      openWindow: (url: string) => opened.push(url),
    },
    registration: {
      showNotification: (title: string, options: Omit<Shown, "title">) => {
        shown.push({ title, ...options });
        return Promise.resolve();
      },
    },
    location: { origin: "https://eva.example.ts.net" },
  };
  const caches = {
    open: () =>
      Promise.resolve({
        match: (url: string) => Promise.resolve(store.has(url) ? new Response(store.get(url)) : undefined),
        put: (url: string, response: Response): Promise<void> =>
          response.text().then((text) => {
            store.set(url, text);
          }),
      }),
  };
  const fetch = (): Promise<Response> => Promise.resolve(new Response(JSON.stringify({ alerts: alerts() })));
  runInNewContext(serviceWorkerScript, { self, caches, fetch, Response, URL, Promise });
  const run = async (name: string, notification?: unknown): Promise<void> => {
    let work: Promise<unknown> = Promise.resolve();
    listeners.get(name)?.({
      waitUntil: (promise) => {
        work = promise;
      },
      notification,
    });
    await work;
  };
  return {
    shown,
    opened,
    push: () => run("push"),
    click: (url: string) => run("notificationclick", { close: () => undefined, data: { url } }),
  };
}

const alert = (seq: number, key: string, level = "warn"): Record<string, unknown> => ({
  seq,
  key,
  level,
  message: `Alert ${String(seq)}`,
  at: "",
});

describe("the service worker", () => {
  test("shows each new alert once, also when two come close together", async () => {
    let list = [alert(2, "vault_sync"), alert(1, "schedule:lunch", "error")];
    const sw = worker(() => list);
    await sw.push();
    expect(sw.shown.map((each) => [each.title, each.body, each.data.url])).toEqual([
      ["Eva: problem", "Alert 1", "/#/schedules"],
      ["Eva: problem", "Alert 2", "/#/settings"],
    ]);
    // The second push of the pair finds nothing new, so it only shows the newest again.
    await sw.push();
    expect(sw.shown.at(-1)?.body).toBe("Alert 2");
    list = [alert(3, "template_alignment", "resolved"), ...list];
    await sw.push();
    expect(sw.shown.at(-1)).toMatchObject({
      title: "Eva: solved",
      renotify: false,
      data: { url: "/#/settings/vault/template-alignment" },
    });
  });

  test("shows a generic notice when it cannot read the alerts, as after a logout", async () => {
    const sw = worker(() => []);
    await sw.push();
    expect(sw.shown).toMatchObject([{ title: "Eva", body: "Eva has news. Open Eva to see it." }]);
  });

  test("after a restart of Eva, the numbers start again and every listed alert is new", async () => {
    let list = [alert(7, "a")];
    const sw = worker(() => list);
    await sw.push();
    list = [alert(1, "b")];
    await sw.push();
    expect(sw.shown.map((each) => each.body)).toEqual(["Alert 7", "Alert 1"]);
  });

  test("a tap opens the page that fixes the problem", async () => {
    const sw = worker(() => []);
    await sw.click("/#/schedules");
    expect(sw.opened).toEqual(["/#/schedules"]);
  });
});
