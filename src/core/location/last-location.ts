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

/** A phone sends a live location every few seconds; Eva keeps one every 15 minutes. */
const saveEveryMs = 15 * 60_000;

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

  /** Keeps the location, unless the last one is younger than 15 minutes. True when it saved. */
  save(input: LocationInput, source: LocationSource): boolean {
    const now = this.options.now();
    const location = { ...input, at: now.toISOString(), source };
    if (!storedLocationSchema.safeParse(location).success) return false;
    const last = this.read();
    if (last !== null && now.getTime() - Date.parse(last.at) < saveEveryMs) return false;
    writeFileAtomic(this.options.path, JSON.stringify(location, null, 2) + "\n");
    return true;
  }
}
