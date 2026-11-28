/**
 * The pages of the chats (#1129): one HTML file that Eva writes and names with a `[[show: <path>]]`
 * line. The web app shows it in a sandboxed frame inside the answer, from a token path under
 * `/widgets/`, with the policy of `page-policy.ts`. A token maps to the marker path, never to the
 * bytes, so each request checks the file again.
 */
import { randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { extname, join } from "node:path";
import { containsSecretPattern } from "../../shared/redaction.ts";
import { plainPageFile } from "./page-entries.ts";
import { pageNameOf, realRoot } from "./page-names.ts";
import { resolveSendableFile } from "../files/vault-files.ts";
import type { WidgetAnswer } from "../widgets/widget-data.ts";
import { themeCss, type WidgetTheme } from "../widgets/widget-policy.ts";

/** A page is small: the frame shows one chart or one small tool. */
export const maxPageBytes = 2 * 1024 * 1024;
/**
 * A token works only while its frame loads: the web app releases it at the frame's load. So a
 * short life is enough, and a token that a page never used ends soon.
 */
export const pageTokenLifeMs = 5 * 60_000;
/** At most this many tokens live. A new one ends the oldest, so a page that asks and asks again cannot fill the memory. */
export const maxPageTokens = 100;

/** Why Eva does not show a page. */
export type PageNote = "gone" | "too-large" | "refused";

/**
 * How a page stays (#1130): `temporary` in a scratch folder, which Eva empties after 7 days,
 * `saved` in `.eva/pages/`, or `note` in a folder of the person's notes.
 */
export type PageKept = "temporary" | "saved" | "note";

export type ShownPage =
  | { readonly state: "ready"; readonly path: string; readonly relativePath: string; readonly kept: PageKept }
  | RefusedPage;

/**
 * A page that Eva does not show. `saved` names a saved page that she refuses, such as one that grew
 * past 2 MB or took a secret, so the person can still remove it from the chat (#1130).
 */
export interface RefusedPage {
  readonly state: PageNote;
  readonly reason: string;
  readonly saved?: string;
}

export type PageFrame =
  | {
      readonly state: "ready";
      readonly src: string;
      readonly token: string;
      readonly kept: PageKept;
      /** The vault path of the file that the frame shows, which can be the saved copy of the marker's path. */
      readonly path: string;
      /** The saved path of the page's name, which a pin stores, or null for a page in a notes folder. */
      readonly saved: string | null;
    }
  | RefusedPage;

/** The extensions of a page. Save checks the name of the file that it would replace with them. */
export const pageExtensions: ReadonlySet<string> = new Set([".html", ".htm"]);
/** The name of the page under its token. A fixed name keeps the path of the file out of the address. */
const pageName = "page.html";

/**
 * The saved path of the page that a marker leads to, or null for a page elsewhere, such as a note.
 * Save keeps the name, so a stored `[[show: .eva/scratch/<name>.html]]` line finds the saved file
 * with no rewrite.
 */
export function savedPathOf(vaultPath: string, requested: string): string | null {
  return pageNameOf(vaultPath, requested)?.saved ?? null;
}

/**
 * Turns the path of a `[[show:]]` marker into the file to serve. The rules of `[[attach:]]` apply:
 * inside the vault after links resolve, no clone, no git data, no encrypted file, no secret.
 * A page has two places (#1130), and `page-names.ts` gives both from the real path of the marker.
 * The scratch file is the newest version, because Save removes the scratch copy, so it answers while
 * it is a file that Eva shows. Otherwise the saved file of the name answers. The rule needs no
 * state, and a later edit of the saved file shows in every old answer and in a pin.
 */
export function resolveShownPage(vaultPath: string, requested: string): ShownPage {
  const page = pageNameOf(vaultPath, requested);
  const root = realRoot(vaultPath);
  if (page === null || root === null) return shownFile(vaultPath, requested, requested, "note");
  // Each place counts only through plain entries: a link at any level is no version of a page.
  const scratch =
    plainPageFile(root, page.scratch) === null ? null : shownFile(vaultPath, page.scratch, requested, "temporary");
  if (scratch?.state === "ready" || !hasEntry(join(root, page.saved)))
    return scratch ?? { state: "gone", reason: `${requested} does not exist.` };
  // A saved place that is no plain file, such as a link, keeps its path, so Remove can take the link away.
  const saved =
    plainPageFile(root, page.saved) === null
      ? { state: "refused" as const, reason: `${page.saved} is not a plain file, so Eva does not show it.` }
      : shownFile(vaultPath, page.saved, requested, "saved");
  // A saved page that Eva refuses keeps its path, so the person can still remove it from the chat.
  return saved.state === "ready" ? saved : { ...saved, saved: page.saved };
}

/** One place of a page, with the checks of `[[attach:]]`. `requested` names the page in each reason. */
function shownFile(vaultPath: string, path: string, requested: string, kept: PageKept): ShownPage {
  const file = resolveSendableFile(vaultPath, path, { verb: "show", maxBytes: maxPageBytes });
  if (!file.ok) {
    if (file.missing === true) return { state: "gone", reason: `${requested} does not exist.` };
    return { state: file.tooLarge === true ? "too-large" : "refused", reason: file.reason };
  }
  // The extension of the real file, so a link named `.html` cannot show a note as a page.
  if (!pageExtensions.has(extname(file.path).toLowerCase()))
    return { state: "refused", reason: `${requested} is not an HTML page.` };
  return { state: "ready", path: file.path, relativePath: file.relativePath, kept };
}

/** Any entry, also a link that leads nowhere or a folder: the saved place answers then, with its reason. */
function hasEntry(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

interface PageSession {
  readonly requested: string;
  readonly theme: WidgetTheme;
  readonly expiresAt: number;
  /** The token served the page itself, so its frame shows the page and not a 404. */
  served: boolean;
}

export interface ChatPagesOptions {
  readonly vaultPath: string;
  readonly now: () => Date;
}

/** The tokens of the page frames, in memory: a restart ends them, and the web app asks again. */
export class ChatPages {
  private readonly options: ChatPagesOptions;
  private readonly sessions = new Map<string, PageSession>();

  constructor(options: ChatPagesOptions) {
    this.options = options;
  }

  /** A token for one page, with the theme that its frame shows, or the note of a page that Eva cannot show. */
  frame(requested: string, theme: WidgetTheme): PageFrame {
    const shown = resolveShownPage(this.options.vaultPath, requested);
    if (shown.state !== "ready") return shown;
    const now = this.options.now().getTime();
    for (const [token, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(token);
    // A map keeps the order of insertion, so the first key is the oldest token.
    while (this.sessions.size >= maxPageTokens) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, { requested, theme, expiresAt: now + pageTokenLifeMs, served: false });
    return {
      state: "ready",
      src: `/widgets/${token}/${pageName}`,
      token,
      kept: shown.kept,
      path: shown.relativePath,
      saved: savedPathOf(this.options.vaultPath, requested),
    };
  }

  /** Ends the tokens of frames that loaded or closed. */
  release(tokens: readonly string[]): void {
    for (const token of tokens) this.sessions.delete(token);
  }

  /** True while the token works. The route asks the pages before the widgets. */
  has(token: string): boolean {
    return this.liveSession(token) !== null;
  }

  /** Answers one request of a page frame, or null for a token that does not work. */
  serve(token: string, path: string, method: string): WidgetAnswer | null {
    const session = this.liveSession(token);
    if (session === null) return null;
    if (method !== "GET" && method !== "HEAD") return { status: 405 };
    if (path === "eva/theme.css")
      return { status: 200, contentType: "text/css; charset=utf-8", body: themeCss(session.theme) };
    if (path !== pageName) return { status: 404 };
    const shown = resolveShownPage(this.options.vaultPath, session.requested);
    if (shown.state !== "ready") return { status: 404 };
    const body = readPage(shown.path);
    // The file can change between the check and the read, so the bytes that go out pass the checks again.
    if (body === null || containsSecretPattern(body.toString("utf8"))) return { status: 404 };
    if (method === "GET") session.served = true;
    return { status: 200, contentType: "text/html; charset=utf-8", body };
  }

  /**
   * The frame of the token loaded: true when the token served the page, and the token ends. A frame
   * also loads after a 404, such as for a token that expired or that a newer one ended, and the
   * web app cannot see into the frame. So it asks here, and asks for a new token after a false.
   */
  loaded(token: string): boolean {
    const served = this.liveSession(token)?.served === true;
    this.sessions.delete(token);
    return served;
  }

  private liveSession(token: string): PageSession | null {
    const session = this.sessions.get(token);
    if (session === undefined) return null;
    if (session.expiresAt <= this.options.now().getTime()) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }
}

/** Windows has no such flag. There, the link check of `resolveSendableFile` runs just before. */
const noFollow: number = (constants as Partial<typeof constants>).O_NOFOLLOW ?? 0;

/** The bytes of a real file of 2 MB at most, or null: a link put in its place is not followed. */
export function readPage(path: string): Buffer | null {
  let handle: number;
  try {
    handle = openSync(path, constants.O_RDONLY | noFollow);
  } catch {
    return null;
  }
  try {
    const stats = fstatSync(handle);
    if (!stats.isFile() || stats.size > maxPageBytes) return null;
    const bytes = Buffer.alloc(stats.size);
    return bytes.subarray(0, readSync(handle, bytes, 0, stats.size, 0));
  } finally {
    closeSync(handle);
  }
}
