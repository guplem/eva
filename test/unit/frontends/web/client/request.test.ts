import { afterEach, describe, expect, test } from "bun:test";
import { ApiError, quickRead, quickSend, request } from "../../../../../src/frontends/web/client/request.ts";

interface Call {
  readonly path: string;
  readonly init: RequestInit;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];

/** Puts a fetch in place that records each call and answers with `answer`. */
function fakeFetch(answer: (init: RequestInit) => Promise<Response>): void {
  calls = [];
  const fetcher = (path: string, init: RequestInit): Promise<Response> => {
    calls.push({ path, init });
    return answer(init);
  };
  Object.defineProperty(globalThis, "fetch", { value: fetcher, configurable: true, writable: true });
}

/** An answer that never comes, as on a network that hangs. It fails only at the abort. */
function hang(init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", { value: realFetch, configurable: true, writable: true });
});

describe("request", () => {
  test("a send that hangs says that the message may have been sent, and aborts the fetch", async () => {
    fakeFetch(hang);
    const error: unknown = await request(
      "POST",
      "/api/sessions/s1/messages",
      { text: "hi" },
      {
        limit: { ...quickSend, ms: 10 },
      },
    ).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe(quickSend.message);
    expect(quickSend.message).toContain("may have been sent");
    expect(calls[0]?.init.signal?.aborted).toBe(true);
  });

  test("a request with no limit passes no signal, and the limit never reaches fetch", async () => {
    fakeFetch(() => Promise.resolve(new Response(JSON.stringify({ path: "Scratch/a.txt" }))));
    expect(await request("POST", "/api/files/received?name=a.txt", new Blob(["a"]))).toEqual({ path: "Scratch/a.txt" });
    expect(calls[0]?.init.signal).toBeUndefined();
    fakeFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    await request("GET", "/api/status", undefined, { limit: quickRead, keepalive: true });
    expect("limit" in (calls[0]?.init ?? {})).toBe(false);
    expect(calls[0]?.init.keepalive).toBe(true);
    expect(calls[0]?.init.signal).toBeDefined();
  });

  test("a failure gives the error and code of Eva's answer", async () => {
    fakeFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "No such chat.", code: "session_not_found" }), { status: 404 }),
      ),
    );
    const error: unknown = await request("GET", "/api/sessions").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).code).toBe("session_not_found");
    expect((error as ApiError).message).toBe("No such chat.");
  });

  test("a failure that is not JSON keeps the text", async () => {
    fakeFetch(() => Promise.resolve(new Response("Bad gateway", { status: 502 })));
    const error: unknown = await request("GET", "/api/sessions").catch((caught: unknown) => caught);
    expect((error as ApiError).message).toBe("Bad gateway");
    expect((error as ApiError).code).toBeNull();
  });
});
