/**
 * The unsent text of each chat, in `state/unsent-texts.json` (issue 652). The person can start a
 * message on the computer and finish it on the phone, so every page of the web app reads one store.
 * A half-written message is not knowledge, so it stays on the machine, out of the vault.
 */
import { z } from "zod";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { Redactor } from "../../shared/redaction.ts";

/** The most texts that the store keeps. A forgotten text must not grow the file without end. */
const defaultMaxTexts = 200;

export interface UnsentText {
  readonly text: string;
  /** The revision of the write that gave this text. A page drops a reply older than what it knows. */
  readonly revision: number;
}

export interface UnsentTexts {
  /** The newest revision of the store. A key with no text has no text up to this revision. */
  readonly revision: number;
  readonly texts: Readonly<Record<string, UnsentText>>;
}

/** A change of one text, for every page. */
export interface UnsentTextEvent {
  readonly kind: "unsent_text";
  readonly key: string;
  /** Null when the text is gone. */
  readonly text: string | null;
  readonly revision: number;
  /** The page that wrote it, so that page does not take its own text back. Null for a change of the core. */
  readonly writer: string | null;
}

export interface UnsentTextStoreOptions {
  /** The clock, in milliseconds. */
  readonly now?: () => number;
  readonly maxTexts?: number;
}

const textSchema = z.object({ text: z.string(), revision: z.number().int().min(0) });

export class UnsentTextStore {
  private readonly path: string;
  private readonly redactor: Redactor;
  private readonly maxTexts: number;
  private readonly now: () => number;
  private readonly listeners: Set<(event: UnsentTextEvent) => void>;
  private revision: number;
  private readonly texts: Map<string, UnsentText>;

  constructor(path: string, redactor: Redactor, options: UnsentTextStoreOptions = {}) {
    this.path = path;
    this.redactor = redactor;
    this.maxTexts = options.maxTexts ?? defaultMaxTexts;
    this.now = options.now ?? Date.now;
    this.listeners = new Set();
    this.revision = 0;
    this.texts = new Map();
    this.read();
  }

  list(): UnsentTexts {
    return { revision: this.revision, texts: Object.fromEntries(this.texts) };
  }

  /**
   * Keeps the text of a chat, and gives its revision. An empty text removes it, unless `keepEmpty`
   * keeps the clear: a chat that starts with a summary would show the summary again.
   */
  set(key: string, text: string, keepEmpty: boolean, writer: string): number {
    const kept = text === "" && !keepEmpty ? null : this.redactor.redact(text);
    return this.change(key, kept, writer);
  }

  /** Removes the text of a deleted chat. */
  remove(key: string): void {
    if (this.texts.has(key)) this.change(key, null, null);
  }

  subscribe(listener: (event: UnsentTextEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private change(key: string, text: string | null, writer: string | null): number {
    // An open page keeps the revisions that it saw. The clock keeps each new one higher, also after a lost file.
    this.revision = Math.max(this.revision + 1, this.now());
    const revision = this.revision;
    // A delete and a set put the key last, so the oldest text is first to go.
    this.texts.delete(key);
    if (text !== null) this.texts.set(key, { text, revision });
    for (const oldest of this.texts.keys()) {
      if (this.texts.size <= this.maxTexts) break;
      this.texts.delete(oldest);
    }
    this.write();
    for (const listener of this.listeners) listener({ kind: "unsent_text", key, text, revision, writer });
    return revision;
  }

  private read(): void {
    const read = readJsonTolerant(this.path);
    if (!read.ok || read.value === null || typeof read.value !== "object") return;
    const { revision, texts } = read.value as { revision?: unknown; texts?: unknown };
    if (typeof revision === "number" && Number.isSafeInteger(revision) && revision > 0) this.revision = revision;
    if (texts === null || typeof texts !== "object") return;
    const entries: [string, UnsentText][] = [];
    for (const [key, value] of Object.entries(texts as Record<string, unknown>)) {
      const parsed = textSchema.safeParse(value);
      if (parsed.success) entries.push([key, parsed.data]);
    }
    entries.sort((first, second) => first[1].revision - second[1].revision);
    for (const [key, text] of entries) {
      this.texts.set(key, text);
      this.revision = Math.max(this.revision, text.revision);
    }
  }

  private write(): void {
    try {
      writeFileAtomic(this.path, `${JSON.stringify(this.list(), null, 2)}\n`);
    } catch {
      // A full disk loses the texts only at a restart. The pages still share them until then.
    }
  }
}
