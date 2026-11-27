/**
 * The warning about a file that Eva encrypted while the vault remote still holds it plain (#1110).
 * Eva never rewrites the git history, so she tells the person once to change each key in the file.
 * The notice stays open until the person reads it: a satellite's report then carries it to the hub.
 */
import type { AlertProblem } from "../alerts/alert-center.ts";
import { plainHistoryProblem } from "../alerts/problem-rules.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";

const keyPrefix = "vault_plain_history:";

/** The alert key of one file: each file is its own notice, so a second file reaches the phone too. */
export function plainHistoryKey(file: string): string {
  return `${keyPrefix}${file}`;
}

interface PlainHistoryNotices {
  /** Each file that Eva warned about: it never gets a second notice. */
  readonly warned: readonly string[];
  /** The files whose notice the person did not read yet. A restart opens them again, unsent. */
  readonly open: readonly string[];
}

export interface PlainHistoryWatchOptions {
  /** This computer's state file of the notices. */
  readonly statePath: string;
  /** The paths whose remote history holds a plain version, or null when git cannot say. */
  readonly plainOnRemote: (paths: readonly string[]) => Promise<string[] | null>;
  readonly notice: (key: string, problem: AlertProblem, send: boolean) => void;
}

export class PlainHistoryWatch {
  private readonly options: PlainHistoryWatchOptions;
  /** The path whose history to read, for each file that waits for a check: the old name of a renamed file. */
  private readonly waiting: Map<string, string>;
  private queue: Promise<void>;

  constructor(options: PlainHistoryWatchOptions) {
    this.options = options;
    this.waiting = new Map();
    this.queue = Promise.resolve();
  }

  /**
   * Checks the files that became encrypted. `oldNames` maps the new name of each file that the
   * Encrypt action renamed to its old name, under which the plain versions sit.
   */
  consider(encrypted: readonly string[], oldNames: ReadonlyMap<string, string>): Promise<void> {
    // One check at a time: a second one that starts while git answers the first would warn twice.
    const next = this.queue.then(() => this.considerNow(encrypted, oldNames));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async considerNow(encrypted: readonly string[], oldNames: ReadonlyMap<string, string>): Promise<void> {
    // A later report of the same file keeps the old name that an earlier one gave.
    for (const file of encrypted) if (!this.waiting.has(file)) this.waiting.set(file, oldNames.get(file) ?? file);
    for (const [file, old] of oldNames) this.waiting.set(file, old);
    const warned = new Set(this.notices().warned);
    for (const file of [...this.waiting.keys()]) if (warned.has(file)) this.waiting.delete(file);
    if (this.waiting.size === 0) return;
    const checked = new Map(this.waiting);
    const found = await this.options.plainOnRemote([...new Set(checked.values())]);
    // Git could not say, such as during a long push: the files wait for the next round.
    if (found === null) return;
    for (const file of checked.keys()) this.waiting.delete(file);
    const plain = new Set(found);
    const files = [...checked].filter(([, history]) => plain.has(history)).map(([file]) => file);
    if (files.length === 0) return;
    const notices = this.notices();
    this.save({ warned: [...new Set([...notices.warned, ...files])], open: [...new Set([...notices.open, ...files])] });
    for (const file of files) this.options.notice(plainHistoryKey(file), plainHistoryProblem(file), true);
  }

  /** Opens each unread notice again, unsent, such as after a restart. */
  reopen(): void {
    for (const file of this.notices().open)
      this.options.notice(plainHistoryKey(file), plainHistoryProblem(file), false);
  }

  /** The person read a notice: it stays closed. False for a key that is not one of these notices. */
  read(key: string): boolean {
    if (!key.startsWith(keyPrefix)) return false;
    const file = key.slice(keyPrefix.length);
    const notices = this.notices();
    this.save({ ...notices, open: notices.open.filter((each) => each !== file) });
    return true;
  }

  private notices(): PlainHistoryNotices {
    const read = readJsonTolerant(this.options.statePath);
    const value: unknown = read.ok ? read.value : null;
    const list = (name: string): string[] => {
      const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[name] : null;
      return Array.isArray(raw) ? raw.filter((each): each is string => typeof each === "string") : [];
    };
    return { warned: list("warned"), open: list("open") };
  }

  private save(notices: PlainHistoryNotices): void {
    writeFileAtomic(this.options.statePath, `${JSON.stringify(notices, null, 2)}\n`);
  }
}
