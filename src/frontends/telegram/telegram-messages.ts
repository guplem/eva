/** The parts of a Telegram update that the bot reads, and the helpers that read them. */

interface TelegramChat {
  readonly id: number;
}

export interface TelegramFile {
  readonly file_id: string;
  readonly file_unique_id?: string;
  readonly file_size?: number;
  readonly file_name?: string;
}

interface TelegramPhotoSize extends TelegramFile {
  readonly width: number;
  readonly height: number;
}

interface TelegramMessage {
  readonly chat: TelegramChat;
  readonly from?: { readonly id: number };
  readonly text?: string;
  readonly caption?: string;
  readonly document?: TelegramFile;
  readonly voice?: TelegramFile;
  readonly audio?: TelegramFile;
  /** One photo in several sizes. */
  readonly photo?: readonly TelegramPhotoSize[];
  readonly message_thread_id?: number;
  readonly is_topic_message?: boolean;
}

export interface TelegramUpdate {
  readonly update_id: number;
  readonly message?: TelegramMessage;
  readonly callback_query?: {
    readonly id: string;
    readonly from?: { readonly id: number };
    readonly data?: string;
    readonly message?: TelegramMessage;
  };
}

/**
 * Message contents that Eva cannot read yet: the Telegram field, then its name in the reply.
 * A venue also carries a location, so it comes first. A service message (a new topic, a pin) gets no reply.
 */
const unreadableContents: readonly (readonly [string, string])[] = [
  ["sticker", "stickers"],
  ["video", "videos"],
  ["video_note", "video notes"],
  ["animation", "GIFs"],
  ["venue", "places"],
  ["location", "locations"],
  ["contact", "contacts"],
  ["poll", "polls"],
  ["dice", "dice"],
];

/** The topic of a message, or null for the main chat. */
export function topicOf(message: TelegramMessage | undefined): number | null {
  return message?.is_topic_message === true ? (message.message_thread_id ?? null) : null;
}

export function keyOf(chatId: number, topicId: number | null): string {
  return `${String(chatId)}:${topicId === null ? "main" : String(topicId)}`;
}

export function threadOf(topicId: number | null): Record<string, number> {
  return topicId === null ? {} : { message_thread_id: topicId };
}

export function titleOf(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "Chat";
  return line.length > 60 ? `${line.slice(0, 59)}…` : line || "Chat";
}

/** The file that a message holds and Eva saves: a document, an audio file, or the largest size of a photo. */
export function receivedFileOf(message: TelegramMessage): TelegramFile | null {
  if (message.document !== undefined) return message.document;
  if (message.audio !== undefined) return message.audio;
  const largest = (message.photo ?? []).reduce<TelegramPhotoSize | null>(
    (best, size) => (best === null || size.width * size.height > best.width * best.height ? size : best),
    null,
  );
  if (largest === null) return null;
  // A photo has no file name; Telegram always sends it as a JPEG.
  return { ...largest, file_name: `photo-${largest.file_unique_id ?? largest.file_id}.jpg` };
}

/** The name of the content that Eva cannot read yet, or null. */
export function unreadableContentOf(message: TelegramMessage): string | null {
  return unreadableContents.find(([field]) => field in message)?.[1] ?? null;
}
