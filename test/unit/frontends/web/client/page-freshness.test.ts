import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  browserPage,
  type PagePlace,
  pageFiles,
  reloadIfStale,
  reloadPauseMs,
} from "../../../../../src/frontends/web/client/page-freshness.ts";

const oldHead =
  '<head><link rel="manifest" href="/manifest-a1.webmanifest"><link rel="stylesheet" crossorigin href="/chunk-old1.css">' +
  '<script type="module" crossorigin src="/chunk-old2.js"></script></head>';
const newPage =
  '<!doctype html><html><head><link rel="stylesheet" crossorigin href="/chunk-new1.css">' +
  '<script type="module" crossorigin src="/chunk-new2.js"></script></head><body><div id="root"></div></body></html>';

function place(overrides: Partial<PagePlace> = {}): PagePlace & { reloads: number; stored: number | null } {
  const state = {
    reloads: 0,
    stored: null as number | null,
    loadedHead: oldHead,
    fetchPage: (): Promise<string | null> => Promise.resolve(newPage),
    reload: (): void => {
      state.reloads += 1;
    },
    now: (): number => 100_000,
    lastReloadAt: (): number | null => state.stored,
    rememberReload: (at: number): void => {
      state.stored = at;
    },
    ...overrides,
  };
  return state;
}

describe("pageFiles", () => {
  test("lists the scripts and stylesheets of a page in order", () => {
    expect(pageFiles(oldHead)).toEqual(["/chunk-old1.css", "/chunk-old2.js"]);
  });

  test("lists nothing for a page without bundled files", () => {
    expect(pageFiles("<html><body>Bad gateway</body></html>")).toEqual([]);
  });
});

describe("reloadIfStale", () => {
  test("reloads a page whose files Eva no longer serves", async () => {
    const page = place();
    expect(await reloadIfStale(page)).toBe(true);
    expect(page.reloads).toBe(1);
    expect(page.stored).toBe(100_000);
  });

  test("keeps a page whose files Eva still serves", async () => {
    const page = place({ fetchPage: () => Promise.resolve(`<!doctype html>${oldHead}<body></body>`) });
    expect(await reloadIfStale(page)).toBe(false);
    expect(page.reloads).toBe(0);
  });

  test("keeps the page when Eva sends no page, as during a restart", async () => {
    const page = place({ fetchPage: () => Promise.resolve(null) });
    expect(await reloadIfStale(page)).toBe(false);
    expect(page.reloads).toBe(0);
  });

  test("keeps the page when the answer lists no files, as a proxy error page", async () => {
    const page = place({ fetchPage: () => Promise.resolve("<html><body>Bad gateway</body></html>") });
    expect(await reloadIfStale(page)).toBe(false);
  });

  test("keeps the page when the read fails", async () => {
    const page = place({
      fetchPage: () => Promise.reject(new Error("offline")),
    });
    expect(await reloadIfStale(page)).toBe(false);
  });

  test("reloads at most once in a pause, so a cache on the way cannot loop the page", async () => {
    const page = place();
    page.stored = 100_000 - reloadPauseMs + 1;
    expect(await reloadIfStale(page)).toBe(false);
    expect(page.reloads).toBe(0);
    page.stored = 100_000 - reloadPauseMs;
    expect(await reloadIfStale(page)).toBe(true);
  });
});

describe("browserPage", () => {
  const stored = new Map<string, string>();
  const reloads: string[] = [];
  let answer: Response = new Response(newPage);
  const define = (name: string, value: unknown): void => {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    stored.clear();
    reloads.length = 0;
    answer = new Response(newPage);
    define("document", { head: { outerHTML: oldHead } });
    define("window", { location: { pathname: "/", reload: () => reloads.push("reload") } });
    define("sessionStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    define("fetch", (path: string, init: RequestInit): Promise<Response> => {
      expect(path).toBe("/");
      expect(init.cache).toBe("no-store");
      return Promise.resolve(answer);
    });
  });

  afterEach(() => {
    for (const name of ["document", "window", "sessionStorage"]) Reflect.deleteProperty(globalThis, name);
    define("fetch", realFetch);
  });

  test("reloads the tab once when Eva serves new files", async () => {
    expect(await reloadIfStale(browserPage())).toBe(true);
    expect(await reloadIfStale(browserPage())).toBe(false);
    expect(reloads).toEqual(["reload"]);
  });

  test("reads an error answer as no page", async () => {
    answer = new Response("Bad gateway", { status: 502 });
    expect(await reloadIfStale(browserPage())).toBe(false);
  });

  test("reloads when the browser blocks the storage", async () => {
    define("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(await reloadIfStale(browserPage())).toBe(true);
  });
});
