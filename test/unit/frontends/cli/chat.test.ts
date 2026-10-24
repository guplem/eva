import { describe, expect, test } from "bun:test";
import { createEventPrinter, runChat } from "../../../../src/frontends/cli/chat.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import type { EngineEventPayload, SessionEvent } from "../../../../src/shared/events.ts";

let seq = 0;
function stamped(payload: EngineEventPayload): SessionEvent {
  seq += 1;
  return { ...payload, sessionId: "s1", seq, at: "2026-10-20T10:00:00.000Z" };
}

function printed(payloads: readonly EngineEventPayload[]): string {
  const print = createEventPrinter();
  return payloads.map((payload) => print(stamped(payload)) ?? "").join("");
}

const finished: EngineEventPayload = {
  kind: "turn_finished",
  engineSessionId: "e1",
  lastMessageId: null,
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: null,
  contextTokens: null,
  contextWindow: null,
  model: null,
};

describe("createEventPrinter", () => {
  test("writes each piece at once, and only the rest of the block at its final text", () => {
    expect(
      printed([
        { kind: "text_delta", text: "Hello " },
        { kind: "text_delta", text: "there " },
        { kind: "text", text: "Hello there friend.", messageId: "m1" },
        finished,
      ]),
    ).toBe("Hello there friend.\n");
  });

  test("a block that starts again goes on a new line, and its final text follows it", () => {
    expect(
      printed([
        { kind: "text_delta", text: "Hello ", startsBlock: true },
        { kind: "text_delta", text: "Hello world ", startsBlock: true },
        { kind: "text", text: "Hello world now.", messageId: "m1" },
      ]),
    ).toBe("Hello \nHello world now.\n");
  });

  test("a block with no pieces prints whole, as before", () => {
    expect(printed([{ kind: "text", text: "Done.", messageId: "m1" }, finished])).toBe("Done.\n");
  });

  test("a final text that differs from the pieces starts on a new line, in full", () => {
    expect(
      printed([
        { kind: "text_delta", text: "-----BEGIN RSA " },
        { kind: "text", text: "[redacted]", messageId: "m1" },
      ]),
    ).toBe("-----BEGIN RSA \n[redacted]\n");
  });

  test("another line during the pieces ends the open line, and the block never prints twice", () => {
    expect(
      printed([
        { kind: "text_delta", text: "Let me " },
        { kind: "tool_finished", toolUseId: "t1", isError: false },
        { kind: "notice", text: "A server did not start." },
        { kind: "text", text: "Let me look.", messageId: "m1" },
      ]),
    ).toBe("Let me \n  (A server did not start.)\nlook.\n");
  });

  test("a turn that fails during the pieces ends the open line", () => {
    expect(
      printed([
        { kind: "text_delta", text: "Let me " },
        { kind: "turn_failed", reason: "stopped" },
      ]),
    ).toBe("Let me \n  The turn failed: stopped\n");
    expect(printed([{ kind: "text_delta", text: "Half " }, finished])).toBe("Half \n");
  });
});

interface FakeSocket {
  send: (data: string) => unknown;
  close: () => void;
}

/**
 * A local API with one chat, s1. `onOpen` and `onMessage` decide when the event stream drops.
 * It records the path of each request.
 */
function fakeLocalApi(handlers: {
  onOpen?: (socket: FakeSocket) => void;
  onMessage?: (sockets: readonly FakeSocket[]) => void;
}): { url: string; paths: string[]; stop: () => Promise<void> } {
  const sockets: FakeSocket[] = [];
  const paths: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, bunServer) => {
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path === "/api/events") return bunServer.upgrade(request) ? undefined : new Response(null, { status: 400 });
      if (path === "/api/sessions") return Response.json({ id: "s1", startFolder: "vault" }, { status: 201 });
      if (path === "/api/sessions/s1/messages") handlers.onMessage?.(sockets);
      return Response.json({}, { status: 202 });
    },
    websocket: {
      open: (socket) => {
        sockets.push(socket);
        handlers.onOpen?.(socket);
      },
      message: () => undefined,
    },
  });
  return { url: `http://127.0.0.1:${String(server.port)}`, paths, stop: () => server.stop(true) };
}

/** Runs a chat with these lines, then a person who types nothing more. Returns what it threw. */
async function chatUntilEnd(url: string, lines: string[]): Promise<unknown> {
  return runChat({
    baseUrl: url,
    token: "token",
    mode: "assistant",
    readLine: () => {
      const line = lines.shift();
      return line === undefined ? new Promise<string | null>(() => undefined) : Promise.resolve(line);
    },
    write: () => undefined,
  }).then(
    () => null,
    (error: unknown) => error,
  );
}

function expectClosed(failure: unknown): void {
  // An EvaError, so `eva chat` exits 1 with one line and no stack.
  expect(isEvaError(failure, "request_failed")).toBe(true);
  expect((failure as Error).message).toBe("Eva closed the connection.");
}

describe("runChat", () => {
  test("fails, and never hangs, when the event stream drops during a turn", async () => {
    const api = fakeLocalApi({
      onMessage: (sockets) => {
        for (const socket of sockets) socket.close();
      },
    });
    try {
      const lines = ["Hello", "never read"];
      expectClosed(await chatUntilEnd(api.url, lines));
      expect(lines).toEqual(["never read"]);
    } finally {
      await api.stop();
    }
  });

  test("fails at once when the stream drops while the prompt waits for a line", async () => {
    const api = fakeLocalApi({
      onOpen: (socket) => {
        setTimeout(() => {
          socket.close();
        }, 50);
      },
    });
    try {
      expectClosed(await chatUntilEnd(api.url, []));
      expect(api.paths).not.toContain("/api/sessions/s1/messages");
    } finally {
      await api.stop();
    }
  });

  test("sends no answer to a question when the stream drops while the question waits", async () => {
    const api = fakeLocalApi({
      onMessage: (sockets) => {
        for (const socket of sockets) {
          socket.send(
            JSON.stringify({
              kind: "approval_needed",
              requestId: "r1",
              toolName: "Bash",
              summary: "git push",
              sessionId: "s1",
              seq: 1,
              at: "2026-10-20T10:00:00.000Z",
            }),
          );
          setTimeout(() => {
            socket.close();
          }, 50);
        }
      },
    });
    try {
      expectClosed(await chatUntilEnd(api.url, ["push it"]));
      expect(api.paths.some((path) => path.startsWith("/api/approvals"))).toBe(false);
    } finally {
      await api.stop();
    }
  });
});
