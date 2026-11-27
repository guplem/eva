/**
 * What the widget feeds of Google share (#778, #1102): a read of each page of a Google list, a
 * short cache, and the days of a window. Each read throws `google_failed`, never Google's own text.
 */
import { EvaError } from "../../shared/errors.ts";
import { googleUrls } from "./google-login.ts";

const requestTimeoutMs = 30_000;
const cacheLifeMs = 60_000;
/** Each window of each widget is a cache entry: the cap keeps the cache small. */
const maxCacheEntries = 32;

export interface GooglePagesRequest {
  /** Google's address; a test points it at a fake server. */
  readonly baseUrl?: string | undefined;
  readonly accessToken: string;
  readonly path: string;
  readonly query: URLSearchParams;
  /** The cap keeps a huge list bounded. */
  readonly maxPages: number;
  /** What Google refused to show, for the message, such as "the calendar". */
  readonly what: string;
}

/** Every item of a list of Google, page by page. Throws `google_failed`. */
export async function readGooglePages<Item>(request: GooglePagesRequest): Promise<Item[]> {
  const items: Item[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < request.maxPages; page++) {
    const pageQuery = new URLSearchParams(request.query);
    if (pageToken !== null) pageQuery.set("pageToken", pageToken);
    const address = `${googleUrls(request.baseUrl).api}${request.path}?${pageQuery.toString()}`;
    const body = await readJson(address, request.accessToken, request.what);
    const { items: found, nextPageToken } = (body ?? {}) as { items?: unknown; nextPageToken?: unknown };
    if (Array.isArray(found)) items.push(...(found as Item[]));
    pageToken = googleText(nextPageToken);
    if (pageToken === null) break;
  }
  return items;
}

async function readJson(address: string, accessToken: string, what: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(address, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    throw new EvaError("google_failed", "Eva could not reach Google. Check the machine's internet connection.", {
      cause: error,
    });
  }
  // Only the status: the answer can hold the person's text, which must not reach a log.
  if (!response.ok)
    throw new EvaError("google_failed", `Google refused to show ${what} (HTTP ${String(response.status)}).`);
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    throw new EvaError("google_failed", "Google sent an answer that Eva cannot read.", { cause: error });
  }
}

interface CacheEntry {
  readonly at: number;
  readonly value: Promise<unknown>;
}

/** Keeps a grid of widgets from calling Google on each draw. */
export class GoogleAnswerCache {
  private readonly now: () => Date;
  private readonly entries: Map<string, CacheEntry>;

  constructor(now: () => Date) {
    this.now = now;
    this.entries = new Map();
  }

  /** Shares one call among the widgets that ask at the same time, and keeps its answer for a minute. */
  cached<Value>(key: string, read: () => Promise<Value>): Promise<Value> {
    const now = this.now().getTime();
    for (const [old, entry] of this.entries) if (now - entry.at >= cacheLifeMs) this.entries.delete(old);
    const found = this.entries.get(key);
    if (found !== undefined) return found.value as Promise<Value>;
    const value = read();
    this.entries.set(key, { at: now, value });
    // A failure is not kept: the next draw asks Google again.
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    const oldest = this.entries.keys().next().value;
    if (this.entries.size > maxCacheEntries && oldest !== undefined) this.entries.delete(oldest);
    return value;
  }

  /** Drops a kept answer, so the next call asks Google again. */
  forget(key: string): void {
    this.entries.delete(key);
  }
}

/** A text of Google, or null for a missing or empty one. */
export function googleText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real day in the form YYYY-MM-DD. */
export function isDay(value: string): boolean {
  return dayPattern.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

const dayMs = 86_400_000;

export function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + dayMs).toISOString().slice(0, 10);
}

export function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - dayMs).toISOString().slice(0, 10);
}
