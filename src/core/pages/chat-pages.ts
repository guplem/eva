/**
 * The pages of the chats (#1129): one HTML file that Eva writes and names with a `[[show: <path>]]`
 * line. The web app shows it in a sandboxed frame inside the answer, from a token path under
 * `/widgets/`, with the policy of `page-policy.ts`. A token maps to the marker path, never to the
 * bytes, so each request checks the file again.
 */
import { randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { extname } from "node:path";
import { containsSecretPattern } from "../../shared/redaction.ts";
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

export type ShownPage =
  | { readonly state: "ready"; readonly path: string; readonly relativePath: string }
  | { readonly state: PageNote; readonly reason: string };

export type PageFrame =
  | { readonly state: "ready"; readonly src: string; readonly token: string }
  | { readonly state: PageNote; readonly reason: string };

const pageExtensions: ReadonlySet<string> = new Set([".html", ".htm"]);
/** The name of the page under its token. A fixed name keeps the path of the file out of the address. */
const pageName = "page.html";

/**
 * Turns the path of a `[[show:]]` marker into the file to serve. The rules of `[[attach:]]` apply:
 * inside the vault after links resolve, no clone, no git data, no encrypted file, no secret.
 * A saved or pinned page (#1130) changes only this function.
 */
export function resolveShownPage(vaultPath: string, requested: string): ShownPage {
  const file = resolveSendableFile(vaultPath, requested, { verb: "show", maxBytes: maxPageBytes });
  if (!file.ok) {
    if (file.missing === true) return { state: "gone", reason: `${requested} does not exist.` };
    return { state: file.tooLarge === true ? "too-large" : "refused", reason: file.reason };
  }
  // The extension of the real file, so a link named `.html` cannot show a note as a page.
  if (!pageExtensions.has(extname(file.path).toLowerCase()))
    return { state: "refused", reason: `${requested} is not an HTML page.` };
  return { state: "ready", path: file.path, relativePath: file.relativePath };
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
    return { state: "ready", src: `/widgets/${token}/${pageName}`, token };
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
function readPage(path: string): Buffer | null {
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
