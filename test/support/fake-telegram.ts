/**
 * A fake Telegram Bot API server for tests (docs/plan.md §10, P4). It records every call,
 * serves the updates a test queues, and can answer a method with an error.
 */
import type { Server } from "bun";

export interface RecordedCall {
  readonly method: string;
  readonly params: Record<string, unknown>;
  /** What the fake answered; undefined for a scripted error. */
  result?: unknown;
}

interface ScriptedError {
  readonly code: number;
  readonly description: string;
  readonly retryAfterSeconds: number | null;
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
  private readonly files = new Map<string, Uint8Array<ArrayBuffer>>();

  constructor() {
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname.startsWith("/file/")) {
          const bytes = this.files.get(url.pathname.split("/").slice(3).join("/"));
          return bytes === undefined ? new Response("missing", { status: 404 }) : new Response(bytes);
        }
        const method = url.pathname.split("/").pop() ?? "";
        const params = await readParams(request);
        const call: RecordedCall = { method, params };
        this.calls.push(call);
        const error = this.errors.get(method);
        if (error !== undefined && error.remaining > 0) {
          error.remaining -= 1;
          return Response.json(
            {
              ok: false,
              error_code: error.code,
              description: error.description,
              ...(error.retryAfterSeconds === null ? {} : { parameters: { retry_after: error.retryAfterSeconds } }),
            },
            { status: error.code },
          );
        }
        call.result = this.result(method, params);
        return Response.json({ ok: true, result: call.result });
      },
    });
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${String(this.server.port)}`;
  }

  /** A text message from a chat, optionally inside a topic. */
  sendText(chatId: number, text: string, topicId?: number, fromId: number = chatId): void {
    this.updates.push({
      update_id: this.nextUpdateId++,
      message: {
        message_id: this.nextMessageId++,
        chat: { id: chatId, type: "private" },
        from: { id: fromId },
        text,
        ...(topicId === undefined ? {} : { message_thread_id: topicId, is_topic_message: true }),
      },
    });
  }

  /** A button press on a message. */
  pressButton(chatId: number, data: string, topicId?: number, fromId: number = chatId): void {
    this.updates.push({
      update_id: this.nextUpdateId++,
      callback_query: {
        id: `callback-${String(this.nextUpdateId)}`,
        from: { id: fromId },
        data,
        message: {
          message_id: 1,
          chat: { id: chatId, type: "private" },
          ...(topicId === undefined ? {} : { message_thread_id: topicId, is_topic_message: true }),
        },
      },
    });
  }

  /** A file message from a chat: a document, a voice note or an audio file, with bytes that getFile serves. */
  sendFile(
    chatId: number,
    kind: "document" | "voice" | "audio",
    bytes: Uint8Array<ArrayBuffer>,
    options: { fileName?: string; topicId?: number; reportedSize?: number } = {},
  ): void {
    const { fileName, topicId } = options;
    const fileId = `file-${String(this.nextUpdateId)}`;
    this.files.set(`${fileId}.bin`, bytes);
    this.updates.push({
      update_id: this.nextUpdateId++,
      message: {
        message_id: this.nextMessageId++,
        chat: { id: chatId, type: "private" },
        [kind]: {
          file_id: fileId,
          file_size: options.reportedSize ?? bytes.length,
          ...(fileName === undefined ? {} : { file_name: fileName }),
        },
        ...(topicId === undefined ? {} : { message_thread_id: topicId, is_topic_message: true }),
      },
    });
  }

  /** A phone photo: Telegram sends several sizes, smallest first. Only the largest has bytes to download. */
  sendPhoto(chatId: number, bytes: Uint8Array<ArrayBuffer>, caption?: string): void {
    const fileId = `photo-${String(this.nextUpdateId)}`;
    this.files.set(`${fileId}.bin`, bytes);
    this.sendMessageWith(chatId, {
      photo: [
        { file_id: `${fileId}-small`, file_unique_id: `small-${fileId}`, width: 90, height: 60, file_size: 10 },
        { file_id: fileId, file_unique_id: `large-${fileId}`, width: 1280, height: 853, file_size: bytes.length },
      ],
      ...(caption === undefined ? {} : { caption }),
    });
  }

  /** A message with any other content, such as `{ sticker: {...} }` or a service message. */
  sendMessageWith(chatId: number, content: Record<string, unknown>): void {
    this.updates.push({
      update_id: this.nextUpdateId++,
      message: {
        message_id: this.nextMessageId++,
        chat: { id: chatId, type: "private" },
        from: { id: chatId },
        ...content,
      },
    });
  }

  /** The next `times` calls of a method fail; a 429 can carry Telegram's `retry_after`. */
  failNext(
    method: string,
    code: number,
    description: string,
    times = 1,
    retryAfterSeconds: number | null = null,
  ): void {
    this.errors.set(method, { code, description, retryAfterSeconds, remaining: times });
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
      case "getFile":
        return { file_id: params["file_id"], file_path: `${String(params["file_id"])}.bin` };
      case "sendDocument":
        return { message_id: this.nextMessageId++ };
      case "getMe":
        return { id: 1, is_bot: true, username: "eva_test_bot" };
      default:
        return true;
    }
  }
}

/** JSON for a call; a multipart form for an upload, with the file recorded as its name and size. */
async function readParams(request: Request): Promise<Record<string, unknown>> {
  if (request.method !== "POST") return {};
  if (!(request.headers.get("content-type") ?? "").startsWith("multipart/")) {
    return (await request.json()) as Record<string, unknown>;
  }
  const params: Record<string, unknown> = {};
  for (const [key, value] of (await request.formData()).entries()) {
    const entry: unknown = value;
    params[key] = entry instanceof File ? { name: entry.name, size: entry.size } : entry;
  }
  return params;
}
