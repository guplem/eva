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
  /** The newest revision of the store. */
  readonly revision: number;
  readonly texts: Readonly<Record<string, UnsentText>>;
  /**
   * The revision that removed each text that is gone. A key in neither list is one that Eva does not
   * know, such as after a lost file, so a page sends its copy again.
   */
  readonly removed: Readonly<Record<string, number>>;
}

/** The answer to a write. A refused write built on an older text: the page takes Eva's text instead. */
export type UnsentTextAnswer =
  | { readonly accepted: true; readonly revision: number }
  | { readonly accepted: false; readonly text: string | null; readonly revision: number };

/** What the store keeps of each key. A null text is a removed text, which the store keeps to tell it from an unknown one. */
interface Entry {
  readonly text: string | null;
  readonly revision: number;
  /** The page that wrote it, so that page may write over it with an older base. Null for the core. */
  readonly writer: string | null;
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

const entrySchema = z.object({
  text: z.string().nullable(),
  revision: z.number().int().min(0),
  writer: z.string().nullable().catch(null),
});

export class UnsentTextStore {
  private readonly path: string;
  private readonly redactor: Redactor;
  private readonly maxTexts: number;
  private readonly now: () => number;
  private readonly listeners: Set<(event: UnsentTextEvent) => void>;
  private revision: number;
  private readonly entries: Map<string, Entry>;

  constructor(path: string, redactor: Redactor, options: UnsentTextStoreOptions = {}) {
    this.path = path;
    this.redactor = redactor;
    this.maxTexts = options.maxTexts ?? defaultMaxTexts;
    this.now = options.now ?? Date.now;
    this.listeners = new Set();
    this.revision = 0;
    this.entries = new Map();
    this.read();
  }

  list(): UnsentTexts {
    const texts: Record<string, UnsentText> = {};
    const removed: Record<string, number> = {};
    for (const [key, { text, revision }] of this.entries) {
      if (text === null) removed[key] = revision;
      else texts[key] = { text, revision };
    }
    return { revision: this.revision, texts, removed };
  }

  /**
   * Keeps the text of a chat. An empty text removes it, unless `keepEmpty` keeps the clear: a chat
   * that starts with a summary would show the summary again.
   *
   * `base` is the revision that the page built on, or null when the page knew none. A write on an
   * older base is refused, so a page that comes back from sleep never writes over a newer text,
   * or brings back a sent one. Only the page that made the newer text may write over it.
   */
  set(key: string, text: string, keepEmpty: boolean, writer: string, base: number | null): UnsentTextAnswer {
    const current = this.entries.get(key);
    if (base !== null && current !== undefined && current.revision > base && current.writer !== writer)
      return { accepted: false, text: current.text, revision: current.revision };
    const kept = text === "" && !keepEmpty ? null : this.redactor.redact(text);
    return { accepted: true, revision: this.change(key, kept, writer) };
  }

  /** Removes the text of a deleted chat. */
  remove(key: string): void {
    const current = this.entries.get(key);
    if (current !== undefined && current.text !== null) this.change(key, null, null);
  }

  subscribe(listener: (event: UnsentTextEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private change(key: string, text: string | null, writer: string | null): number {
    // An open page keeps the revisions that it saw. The clock keeps each new one higher, also after a lost file.
    this.revision = Math.max(this.revision + 1, this.now());
    const revision = this.revision;
    // Each change puts the key last, so the oldest entry is first to go.
    this.entries.delete(key);
    this.entries.set(key, { text, revision, writer });
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxTexts) break;
      this.entries.delete(oldest);
    }
    this.write();
    for (const listener of this.listeners) listener({ kind: "unsent_text", key, text, revision, writer });
    return revision;
  }

  private read(): void {
    const read = readJsonTolerant(this.path);
    if (!read.ok || read.value === null || typeof read.value !== "object") return;
    const { revision, entries } = read.value as { revision?: unknown; entries?: unknown };
    if (typeof revision === "number" && Number.isSafeInteger(revision) && revision > 0) this.revision = revision;
    if (entries === null || typeof entries !== "object") return;
    const kept: [string, Entry][] = [];
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      const parsed = entrySchema.safeParse(value);
      if (parsed.success) kept.push([key, parsed.data]);
    }
    kept.sort((first, second) => first[1].revision - second[1].revision);
    for (const [key, entry] of kept) {
      this.entries.set(key, entry);
      this.revision = Math.max(this.revision, entry.revision);
    }
  }

  private write(): void {
    const file = { revision: this.revision, entries: Object.fromEntries(this.entries) };
    try {
      writeFileAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`);
    } catch {
      // A full disk loses the texts only at a restart. The pages still share them until then.
    }
  }
}
