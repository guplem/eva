/**
 * A page of a chat answer (#1129): one HTML file that Eva wrote, in a sandboxed frame inside the
 * bubble, with a full-screen button. The frame has no origin and the page has no network, so the
 * page cannot read Eva's API, the login cookie or the internet. Each frame asks for its token when
 * it comes into view, and releases the token as soon as it loads: a loaded page needs no request.
 * The corner takes more buttons, such as Save and Pin (#1130).
 */
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { pageSandbox } from "../../../shared/widget-sandbox.ts";
import { api, type PageFrame as PageToken } from "./api.ts";
import { FullScreenFrame } from "./FullScreenFrame.tsx";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import { pageName, pageNote } from "./page-frames.ts";
import { contractColours } from "./widget-frames.ts";
import { currentScheme } from "./WidgetGrid.tsx";

/** A frame asks for its token a little before it scrolls into view, so the page is ready when the person gets there. */
const viewMargin = "200px";

export function PageFrame({ path, actions }: { readonly path: string; readonly actions?: ReactNode }): ReactElement {
  const holder = useRef<HTMLDivElement>(null);
  const seen = useSeen(holder);
  const [full, setFull] = useState(false);
  const closeFull = useCallback(() => setFull(false), []);
  const shown = usePageToken(path, seen);
  const name = pageName(path);
  const note = shown.token !== null && shown.token.state !== "ready" ? pageNote(shown.token) : shown.failed;
  return (
    <div ref={holder} className={note === null ? "page-frame" : "page-frame is-note"}>
      {note === null ? (
        <>
          <PageView shown={shown} name={name} />
          <div className="frame-corner">
            {actions}
            <button
              type="button"
              className="icon-button widget-full-button"
              aria-label={`Open ${name} in full screen`}
              onClick={() => setFull(true)}
            >
              <Icon name="expand" />
            </button>
          </div>
        </>
      ) : (
        <p className="page-note">
          <Icon name="info" />
          <span>{note}</span>
        </p>
      )}
      {full && (
        <FullScreenFrame label={name} onClose={closeFull} actions={actions}>
          <FullPage path={path} name={name} />
        </FullScreenFrame>
      )}
    </div>
  );
}

/** Full screen loads the page again in a frame of its own, with a token of its own. */
function FullPage({ path, name }: { readonly path: string; readonly name: string }): ReactElement {
  const shown = usePageToken(path, true);
  return <PageView shown={shown} name={name} />;
}

/** The frame, with a progress bar over it until the page loads. */
function PageView({ shown, name }: { readonly shown: ShownToken; readonly name: string }): ReactElement {
  const src = shown.token?.state === "ready" ? shown.token.src : null;
  return (
    <>
      {src !== null && (
        <iframe
          key={src}
          className="widget-frame"
          aria-label={name}
          src={src}
          sandbox={pageSandbox}
          referrerPolicy="no-referrer"
          style={{ colorScheme: shown.scheme }}
          onLoad={shown.loaded}
        />
      )}
      {!shown.ready && (
        <div className="page-wait">
          <ProgressBar label="Loading the page" />
        </div>
      )}
    </>
  );
}

interface ShownToken {
  /** The answer of Eva, or null while the frame waits for it. */
  readonly token: PageToken | null;
  /** The note of a request that failed, or null. */
  readonly failed: string | null;
  readonly scheme: "light" | "dark";
  /** True after the frame loaded. */
  readonly ready: boolean;
  readonly loaded: () => void;
}

/**
 * Asks for the token of one page while `active` is true, and again after a change of the theme, so
 * the page loads with the new colours. The token ends at the frame's load, at unmount and when the
 * browser leaves the page.
 */
function usePageToken(path: string, active: boolean): ShownToken {
  const [token, setToken] = useState<PageToken | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [scheme, setScheme] = useState(currentScheme);
  const [ready, setReady] = useState(false);
  // The token that still works, so the frame releases it once.
  const live = useRef<string | null>(null);
  const release = useCallback((): void => {
    const held = live.current;
    live.current = null;
    if (held !== null) void api.releasePageFrames([held]).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    let current = true;
    const ask = (): void => {
      const style = getComputedStyle(document.documentElement);
      const shownScheme = currentScheme();
      api
        .pageFrame(
          path,
          shownScheme,
          contractColours((name) => style.getPropertyValue(name)),
        )
        .then((next) => {
          if (!current) {
            if (next.state === "ready") void api.releasePageFrames([next.token]).catch(() => undefined);
            return;
          }
          release();
          if (next.state === "ready") live.current = next.token;
          setScheme(shownScheme);
          setReady(false);
          setFailed(null);
          setToken(next);
        })
        .catch(() => {
          if (current) setFailed("Eva could not load this page. Reload the chat to try again.");
        });
    };
    ask();
    const themeWatch = new MutationObserver(ask);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", ask);
    window.addEventListener("pagehide", release);
    return () => {
      current = false;
      themeWatch.disconnect();
      media.removeEventListener("change", ask);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [path, active, release]);

  const loaded = useCallback((): void => {
    release();
    setReady(true);
  }, [release]);
  return { token, failed, scheme, ready, loaded };
}

/** True once the element came near the view. It stays true, so a page that loaded stays as it is. */
function useSeen(element: { readonly current: HTMLElement | null }): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const target = element.current;
    if (seen || target === null) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: viewMargin },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [element, seen]);
  return seen;
}
