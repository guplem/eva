/**
 * The person's last location, from their phone (#371). Scripts with no AI, such as a weather
 * forecast, read it. It is a fact about the person, so it lives as `lastLocation` in the header of
 * `Life/About me.md` (#689), and every computer reads it there. Only the hub writes it.
 *
 * A live location sends a point every few seconds, and each write becomes a vault commit. So the
 * hub keeps the newest point in memory, and writes it at most once every 15 minutes, only after a
 * real move or when the stored point gets old. A person who stays in one place makes a few
 * commits a day.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readJsonTolerant, readTextTolerant, writeFileAtomic } from "../../shared/files.ts";
import {
  aboutMeFile,
  lastLocationKey,
  parseLastLocation,
  readLastLocation,
  withHeaderField,
  type LastLocation,
  type LocationSource,
} from "../vault/about-me.ts";

export type { LastLocation, LocationSource } from "../vault/about-me.ts";

export interface LocationInput {
  readonly latitude: number;
  readonly longitude: number;
  /** The radius of the error, in meters, or null when the phone does not say. */
  readonly accuracy: number | null;
}

const pointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).nullable(),
});

/**
 * The file where Eva kept the location before #689, in the instance folder of the hub. Eva still
 * reads it once, to move its point into the note. Remove it after one release.
 */
export const oldLocationFileSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracy: z.number().min(0).nullable(),
  at: z.string().refine((at) => !Number.isNaN(Date.parse(at))),
  source: z.enum(["telegram", "web"]),
});

/** A point of a live stream waits this long after the last one, so a burst costs nothing. */
const streamEveryMs = 60_000;
/** The shortest time between two writes, so a car trip makes at most four commits an hour. */
const writeEveryMs = 15 * 60_000;
/** A smaller move is no move: a phone's point drifts by a few meters. */
const moveMeters = 50;
/** An older stored point is written again, so another computer sees a fresh time. */
const refreshAfterMs = 6 * 60 * 60_000;
/** A note that changes between each read and write makes Eva wait for the next try. */
const writeAttempts = 3;

const earthRadiusMeters = 6_371_000;

type Point = Pick<LastLocation, "latitude" | "longitude">;

/** The distance on the Earth between two points, in meters (the haversine formula). */
export function distanceMeters(from: Point, to: Point): number {
  const radians = (degrees: number): number => (degrees * Math.PI) / 180;
  const latitudeChange = radians(to.latitude - from.latitude);
  const longitudeChange = radians(to.longitude - from.longitude);
  const a =
    Math.sin(latitudeChange / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeChange / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * True when the new point must replace the stored one. A move counts only when it is also larger
 * than the error radius of the new point: indoors, a phone's point can jump 100 m with no move.
 */
function isDue(stored: LastLocation | null, point: LastLocation, now: number): boolean {
  if (stored === null) return true;
  if (now - timeOf(stored, now) > refreshAfterMs) return true;
  const moved = distanceMeters(stored, point);
  return moved > moveMeters && (point.accuracy === null || moved > point.accuracy);
}

/**
 * The time of a point. A hub with a fast clock, or a hand edit, can store a time in the future.
 * Such a time says nothing, so it reads as the oldest time: every new point then wins.
 */
function timeOf(point: LastLocation, now: number): number {
  const at = Date.parse(point.at);
  return at > now ? 0 : at;
}

function newer(first: LastLocation | null, second: LastLocation | null, now: number): LastLocation | null {
  if (first === null || second === null) return first ?? second;
  return timeOf(first, now) >= timeOf(second, now) ? first : second;
}

/**
 * The line above a new field. Git sees a change on the next line as a conflict, so this line keeps
 * the hub's writes apart from an edit of the last field, such as a new allergy from another computer.
 */
const commentLine = "# Eva's code fills lastLocation from your phone. Keep it as it is.";

/** The header line, in flow form, so a write changes one line of the note. */
function headerLine(point: LastLocation): string {
  const accuracy = point.accuracy === null ? "null" : String(point.accuracy);
  return (
    `${lastLocationKey}: { latitude: ${String(point.latitude)}, longitude: ${String(point.longitude)}, ` +
    `accuracy: ${accuracy}, at: ${JSON.stringify(point.at)}, source: ${point.source} }`
  );
}

/**
 * What a write did. "waiting" keeps the point for a later try, before Eva could read the note.
 * "not_due" keeps it too, but the note is fine. "no_note" and "broken_note" say why Eva cannot
 * save it, so the person can fix the note.
 */
export type LocationWrite = "written" | "nothing" | "waiting" | "not_due" | "no_note" | "broken_note";

export interface LocationKeeperOptions {
  /** Null when no vault is configured: the point then stays in memory. */
  readonly vaultPath: string | null;
  /** The file of an older Eva, which the first write moves into the note. */
  readonly oldFilePath: string;
  readonly now: () => Date;
}

export class LocationKeeper {
  private readonly options: LocationKeeperOptions;
  /** The newest point that the note does not have yet. */
  private pending: LastLocation | null;
  /** In memory: a restart allows one write at once, but only when a rule says yes. */
  private lastWriteAt: number | null;
  private oldFileRead: boolean;

  constructor(options: LocationKeeperOptions) {
    this.options = options;
    this.pending = null;
    this.lastWriteAt = null;
    this.oldFileRead = false;
  }

  /**
   * Keeps a point in memory, with the time when the phone took it. An older point than the newest
   * one is dropped, such as a backlog that comes after a restart. A point of a live stream waits a
   * minute after the last one. A point that the person shared on purpose is always kept. True when
   * Eva kept it.
   */
  keep(input: LocationInput, source: LocationSource, takenAt: Date, shared: boolean): boolean {
    if (!pointSchema.safeParse(input).success || Number.isNaN(takenAt.getTime())) return false;
    const now = this.options.now().getTime();
    // A phone with a clock ahead of this computer would block every later point.
    const at = Math.min(takenAt.getTime(), now);
    const last = this.newest();
    const lastAt = last === null ? null : timeOf(last, now);
    // At the same time, the later message wins: Telegram gives the time in whole seconds.
    if (lastAt !== null && at < lastAt) return false;
    if (lastAt !== null && !shared && at - lastAt < streamEveryMs) return false;
    const { latitude, longitude, accuracy } = input;
    this.pending = { latitude, longitude, accuracy, at: new Date(at).toISOString(), source };
    return true;
  }

  /** True when a write has something to do: a point in memory, or the old file to read. */
  get hasWork(): boolean {
    return this.pending !== null || !this.oldFileRead;
  }

  /** The newest point that Eva knows: the one in memory, or else the note's. */
  newest(): LastLocation | null {
    const vaultPath = this.options.vaultPath;
    return newer(this.pending, vaultPath === null ? null : readLastLocation(vaultPath), this.options.now().getTime());
  }

  /**
   * Writes the point in memory into the note, when the rules say so. Eva writes only when the
   * note did not change since she read it, so an edit by the person at the same time stays. Run
   * it only between two sync steps, and never during an Assistant turn.
   */
  writeIfDue(): LocationWrite {
    this.adoptOldFile();
    const point = this.pending;
    if (point === null) return "nothing";
    const vaultPath = this.options.vaultPath;
    // A vault that is not cloned yet has no note to fix, so this is no problem.
    if (vaultPath === null || !existsSync(vaultPath)) return "waiting";
    const now = this.options.now().getTime();
    if (this.lastWriteAt !== null && now - this.lastWriteAt < writeEveryMs) return "waiting";
    const path = join(vaultPath, aboutMeFile);
    for (let attempt = 0; attempt < writeAttempts; attempt += 1) {
      const text = readTextTolerant(path);
      if (text === null) return "no_note";
      const stored = parseLastLocation(text);
      // At the same time, the newer message wins, as in keep.
      if (stored !== null && timeOf(stored, now) > Date.parse(point.at)) return this.written("nothing");
      if (!isDue(stored, point, now)) return "not_due";
      const changed = withHeaderField(text, lastLocationKey, headerLine(point), commentLine);
      if (changed === null) return "broken_note";
      // The person, an app or a sync can save the note between the read and the write.
      if (readTextTolerant(path) !== text) continue;
      writeFileAtomic(path, changed);
      this.lastWriteAt = now;
      return this.written("written");
    }
    return "waiting";
  }

  /** The note has the newest point now, so the old file has nothing more to give. */
  private written(outcome: "written" | "nothing"): LocationWrite {
    this.pending = null;
    if (existsSync(this.options.oldFilePath)) rmSync(this.options.oldFilePath, { force: true });
    return outcome;
  }

  /** Takes the point of an older Eva's file once, as the newest point in memory. */
  private adoptOldFile(): void {
    if (this.oldFileRead) return;
    this.oldFileRead = true;
    const read = readJsonTolerant(this.options.oldFilePath);
    const parsed = read.ok ? oldLocationFileSchema.safeParse(read.value) : null;
    if (parsed?.success !== true) return;
    const { lat, lon, accuracy, at, source } = parsed.data;
    const old: LastLocation = { latitude: lat, longitude: lon, accuracy, at: new Date(at).toISOString(), source };
    this.pending = newer(this.pending, old, this.options.now().getTime());
  }
}
