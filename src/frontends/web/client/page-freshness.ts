/**
 * Reloads a page that an update made old. An open page, such as the app on a phone, keeps the
 * code that it loaded, so after an update it looks as if nothing changed. Each bundled file has a
 * hash of its content in its name, so a page whose files Eva no longer serves is old. Eva sends the
 * page itself with `no-cache`, so a plain reload gets the new files.
 */

/** A second reload in this time means that something on the way keeps the old page. */
export const reloadPauseMs = 60_000;

const reloadKey = "eva-page-reloaded-at";

export interface PagePlace {
  /** The head of the page as the browser loaded it. */
  readonly loadedHead: string;
  /** The page as Eva serves it now, or null when she does not answer with it. */
  readonly fetchPage: () => Promise<string | null>;
  readonly reload: () => void;
  readonly now: () => number;
  readonly lastReloadAt: () => number | null;
  readonly rememberReload: (at: number) => void;
}

/** The scripts and stylesheets of a page. */
export function pageFiles(html: string): string[] {
  return [...html.matchAll(/\b(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1] ?? "");
}

/** Reloads the page when Eva serves other files than the page has. True when it reloads. */
export async function reloadIfStale(place: PagePlace): Promise<boolean> {
  let served: string | null;
  try {
    served = await place.fetchPage();
  } catch {
    // Eva may restart now. The next reconnect asks again.
    return false;
  }
  if (served === null) return false;
  const servedFiles = pageFiles(served);
  // A proxy error page has no files. It says nothing about the version.
  if (servedFiles.length === 0) return false;
  if (servedFiles.join("\n") === pageFiles(place.loadedHead).join("\n")) return false;
  const last = place.lastReloadAt();
  if (last !== null && place.now() - last < reloadPauseMs) return false;
  place.rememberReload(place.now());
  place.reload();
  return true;
}

/** The page in this browser tab. */
export function browserPage(): PagePlace {
  return {
    loadedHead: document.head.outerHTML,
    fetchPage: async () => {
      const response = await fetch(window.location.pathname, { cache: "no-store" });
      return response.ok ? await response.text() : null;
    },
    reload: () => window.location.reload(),
    now: () => Date.now(),
    lastReloadAt: () => {
      try {
        const stored = Number(sessionStorage.getItem(reloadKey));
        return Number.isFinite(stored) && stored > 0 ? stored : null;
      } catch {
        return null;
      }
    },
    rememberReload: (at) => {
      try {
        sessionStorage.setItem(reloadKey, String(at));
      } catch {
        // A browser without storage still reloads. The pause then does not apply.
      }
    },
  };
}
