/**
 * A fake Telegram Bot API server for tests (docs/plan.md §10, P4). It records every call,
 * serves the updates a test queues, and can answer a method with an error.
 */
import type { Server } from "bun";

export interface RecordedCall {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

interface ScriptedError {
  readonly code: number;
  readonly description: string;
  remaining: number;
}

export class FakeTelegram {
  readonly calls: RecordedCall[] = [];
  readonly token = "123456:fake-telegram-token-for-tests";
  private readonly updates: Record<string, unknown>[] = [];
  private readonly errors = new Map<string, ScriptedError>();
  private nextUpdateId = 1;
  private nextMessageId = 100;
  private nextTopicId = 500;
  private readonly server: Server<undefined>;

  constructor() {
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        const method = url.pathname.split("/").pop() ?? "";
        const params = request.method === "POST" ? ((await request.json()) as Record<string, unknown>) : {};
        this.calls.push({ method, params });
        const error = this.errors.get(method);
        if (error !== undefined && error.remaining > 0) {
          error.remaining -= 1;
          return Response.json(
            { ok: false, error_code: error.code, description: error.description },
            { status: error.code },
          );
        }
        return Response.json({ ok: true, result: this.result(method, params) });
      },
    });
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${String(this.server.port)}`;
  }

  /** A text message from a chat, optionally inside a topic. */
  sendText(chatId: number, text: string, topicId?: number): void {
    this.updates.push({
      update_id: this.nextUpdateId++,
      message: {
        message_id: this.nextMessageId++,
        chat: { id: chatId, type: "private" },
        text,
        ...(topicId === undefined ? {} : { message_thread_id: topicId, is_topic_message: true }),
      },
    });
  }

  /** A button press on a message. */
  pressButton(chatId: number, data: string, topicId?: number): void {
    this.updates.push({
      update_id: this.nextUpdateId++,
      callback_query: {
        id: `callback-${String(this.nextUpdateId)}`,
        data,
        message: {
          message_id: 1,
          chat: { id: chatId, type: "private" },
          ...(topicId === undefined ? {} : { message_thread_id: topicId, is_topic_message: true }),
        },
      },
    });
  }

  failNext(method: string, code: number, description: string, times = 1): void {
    this.errors.set(method, { code, description, remaining: times });
  }

  callsTo(method: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  sentTexts(): string[] {
    return this.callsTo("sendMessage").map((call) => String(call.params["text"]));
  }

  stop(): void {
    void this.server.stop(true);
  }

  private result(method: string, params: Record<string, unknown>): unknown {
    switch (method) {
      case "getUpdates": {
        const offset = Number(params["offset"] ?? 0);
        while (this.updates.length > 0 && Number(this.updates[0]?.["update_id"]) < offset) this.updates.shift();
        return this.updates.filter((update) => Number(update["update_id"]) >= offset);
      }
      case "createForumTopic":
        return { message_thread_id: this.nextTopicId++, name: params["name"] };
      case "sendMessage":
        return { message_id: this.nextMessageId++ };
      case "getMe":
        return { id: 1, is_bot: true, username: "eva_test_bot" };
      default:
        return true;
    }
  }
}
