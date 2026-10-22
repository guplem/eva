/**
 * The person's last known location, from their phone (#371). Scripts with no AI, such as a weather
 * forecast, read it. It lives in the instance folder, never in the vault: a location that changes
 * all day would make a git commit each time.
 */
import { z } from "zod";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";

/** Where the location came from: a live location in Telegram, or the open web app. */
export type LocationSource = "telegram" | "web";

export interface LocationInput {
  readonly lat: number;
  readonly lon: number;
  /** The radius of the error, in meters, or null when the phone does not say. */
  readonly accuracy: number | null;
}

export const storedLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracy: z.number().nullable(),
  at: z.string(),
  source: z.enum(["telegram", "web"]),
});

export type LastLocation = z.infer<typeof storedLocationSchema>;

/**
 * A live location sends a move every few seconds. Eva writes at most one a minute, so the point
 * that scripts read is never more than a minute behind the phone.
 */
const streamEveryMs = 60_000;

export interface LocationStoreOptions {
  readonly path: string;
  readonly now: () => Date;
}

export class LocationStore {
  private readonly options: LocationStoreOptions;

  constructor(options: LocationStoreOptions) {
    this.options = options;
  }

  read(): LastLocation | null {
    const read = readJsonTolerant(this.options.path);
    const parsed = read.ok ? storedLocationSchema.safeParse(read.value) : null;
    return parsed?.success === true ? parsed.data : null;
  }

  /**
   * Keeps the location, with the time when the phone took it. An older point than the kept one is
   * dropped, such as a backlog that comes after a restart. A point of a live stream waits a minute
   * after the last one. A point that the person shared on purpose is always kept. True when it saved.
   */
  save(input: LocationInput, source: LocationSource, takenAt: Date, shared: boolean): boolean {
    const now = this.options.now().getTime();
    // A phone with a clock ahead of this computer would block every later point.
    const at = Math.min(takenAt.getTime(), now);
    const location = { ...input, at: new Date(at).toISOString(), source };
    if (!storedLocationSchema.safeParse(location).success) return false;
    const last = this.read();
    const lastAt = last === null ? null : Date.parse(last.at);
    // At the same time, the later message wins: Telegram gives the time in whole seconds.
    if (lastAt !== null && at < lastAt) return false;
    if (lastAt !== null && !shared && at - lastAt < streamEveryMs) return false;
    writeFileAtomic(this.options.path, JSON.stringify(location, null, 2) + "\n");
    return true;
  }
}
