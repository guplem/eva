/**
 * A page of a chat answer (#1129): one HTML file that Eva wrote, in a sandboxed frame inside the
 * bubble, with a full-screen button. The frame has no origin and the page has no network, so the
 * page cannot read Eva's API, the login cookie or the internet. A frame asks for its token only
 * while it is in view, and the token ends at the frame's load: a loaded page needs no request.
 * Under the page, a row says how the page is kept and has Save and Pin (#1130). The row stays out of
 * the frame, so the buttons never cover the page.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { pageSandbox } from "../../../shared/widget-sandbox.ts";
import { api, type PageFrame as PageToken } from "./api.ts";
import { FullScreenFrame } from "./FullScreenFrame.tsx";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import { PageKeep, PagePin, RemoveSavedButton, type ReadyPage } from "./PageActions.tsx";
import { useChatPages } from "./page-context.ts";
import { afterLoad, pageFailedNote, pageLabel, pageName, pageNote } from "./page-frames.ts";
import { contractColours } from "./widget-frames.ts";
import { currentScheme } from "./WidgetGrid.tsx";

/** A frame asks for its token a little before it scrolls into view, so the page is ready when the person gets there. */
const viewMargin = "200px";

/**
 * `answer` shows the page in a bubble, with its row of actions. `column` fills the pinned column,
 * whose header holds the actions.
 */
export type PagePlace = "answer" | "column";

export function PageFrame({
  path,
  place = "answer",
}: {
  readonly path: string;
  readonly place?: PagePlace;
}): ReactElement {
  const holder = useRef<HTMLDivElement>(null);
  const inView = useInView(holder);
  const [full, setFull] = useState(false);
  const closeFull = useCallback(() => setFull(false), []);
  const { version } = useChatPages();
  const shown = usePageToken(path, inView, version);
  const name = pageName(path);
  const note = noteOf(shown);
  const ready = shown.token?.state === "ready" ? shown.token : null;
  return (
    <div ref={holder} className={`page-frame in-${place}${note === null ? "" : " is-note"}`}>
      {note === null ? (
        <div className="page-box">
          <PageView shown={shown} path={path} />
          <div className="frame-corner">
            <button
              type="button"
              className="icon-button widget-full-button"
              aria-label={`Open ${name} in full screen`}
              onClick={() => setFull(true)}
            >
              <Icon name="expand" />
            </button>
          </div>
        </div>
      ) : (
        <PageNote text={note} />
      )}
      {note !== null && shown.token !== null && shown.token.state !== "ready" && shown.token.saved !== undefined && (
        <div className="page-caption">
          <RemoveSavedButton marker={path} />
        </div>
      )}
      {place === "answer" && ready !== null && note === null && (
        <div className="page-caption">
          <PageKeep marker={path} page={ready} />
          <PagePin marker={path} page={ready} />
        </div>
      )}
      {full && <PageFullScreen path={path} page={ready} onClose={closeFull} />}
    </div>
  );
}

/** A page in full screen, with Pin before the close button. The pinned bar of a phone opens it too. */
export function PageFullScreen({
  path,
  page,
  onClose,
}: {
  readonly path: string;
  /** The page as the frame that opens full screen knows it, or null before its first token. */
  readonly page: ReadyPage | null;
  readonly onClose: () => void;
}): ReactElement {
  return (
    <FullScreenFrame
      label={pageName(path)}
      onClose={onClose}
      actions={page === null ? undefined : <PagePin marker={path} page={page} words={false} />}
    >
      <FullPage path={path} />
    </FullScreenFrame>
  );
}

/** Full screen loads the page again in a frame of its own, with a token of its own, or shows the same note as the bubble. */
function FullPage({ path }: { readonly path: string }): ReactElement {
  const { version } = useChatPages();
  const shown = usePageToken(path, true, version);
  const note = noteOf(shown);
  return note === null ? (
    <PageView shown={shown} path={path} />
  ) : (
    <div className="page-full-note">
      <PageNote text={note} />
    </div>
  );
}

function PageNote({ text }: { readonly text: string }): ReactElement {
  return (
    <p className="page-note">
      <Icon name="info" />
      <span>{text}</span>
    </p>
  );
}

/**
 * The frame, with a progress bar over it until the page loads. A new version of a page, such as
 * after a turn of Eva, loads behind the old one, which stays in view until then: no blank flash.
 */
function PageView({ shown, path }: { readonly shown: ShownToken; readonly path: string }): ReactElement {
  const src = shown.token?.state === "ready" ? shown.token.src : null;
  const [lastShown, setLastShown] = useState<string | null>(null);
  if (shown.ready && src !== null && lastShown !== src) setLastShown(src);
  const behind = !shown.ready && lastShown !== null && lastShown !== src ? lastShown : null;
  // One list in a fixed order: the old frame keeps its place, because a frame that moves in the page loads again.
  const frames = [behind, src].filter((each): each is string => each !== null);
  return (
    <>
      {frames.map((each) =>
        each === src ? (
          <iframe
            key={each}
            className={behind === null ? "widget-frame" : "widget-frame is-loading"}
            aria-label={pageLabel(path)}
            src={each}
            sandbox={pageSandbox}
            referrerPolicy="no-referrer"
            style={{ colorScheme: shown.scheme }}
            onLoad={shown.loaded}
          />
        ) : (
          // The token of the old page ended at its load, so the browser keeps only what it shows.
          <iframe
            key={each}
            className="widget-frame"
            aria-hidden="true"
            tabIndex={-1}
            src={each}
            sandbox={pageSandbox}
            referrerPolicy="no-referrer"
            style={{ colorScheme: shown.scheme }}
          />
        ),
      )}
      {!shown.ready && behind === null && (
        <div className="page-wait">
          <ProgressBar label="Loading the page" />
        </div>
      )}
    </>
  );
}

/** The note of a page that Eva cannot show, or null. */
function noteOf(shown: ShownToken): string | null {
  if (shown.failed) return pageFailedNote;
  return shown.token !== null && shown.token.state !== "ready" ? pageNote(shown.token) : null;
}

interface ShownToken {
  /** The answer of Eva, or null while the frame waits for it. */
  readonly token: PageToken | null;
  /** True when the frame gave up: a request failed, or no token served the page. */
  readonly failed: boolean;
  readonly scheme: "light" | "dark";
  /** True after the frame loaded the page. */
  readonly ready: boolean;
  readonly loaded: () => void;
}

/**
 * The token of one page. The frame asks for one while it is in view and has no page of the
 * current theme: at first, after a change of the theme, and after a token that served no page,
 * such as one that expired before the load. A token ends at the load, at unmount and when the
 * browser leaves the page. A new `version` of the chat's pages asks again too (#1130), and a frame
 * out of view asks once it comes into view.
 */
function usePageToken(path: string, inView: boolean, version: number): ShownToken {
  const [token, setToken] = useState<PageToken | null>(null);
  const [failed, setFailed] = useState(false);
  const [scheme, setScheme] = useState(currentScheme);
  const [ready, setReady] = useState(false);
  // Each change of the theme, and each token that served no page, asks for a new token.
  const [wanted, setWanted] = useState(0);
  const [have, setHave] = useState(-1);
  // The token that still works, so the frame releases it once.
  const live = useRef<string | null>(null);
  const tries = useRef(0);
  // The theme of the last ask, so a change of the root's style that keeps the colours asks nothing.
  const askedTheme = useRef("");
  const release = useCallback((): void => {
    const held = live.current;
    live.current = null;
    if (held !== null) void api.releasePageFrames([held]).catch(() => undefined);
  }, []);

  const askedVersion = useRef(version);
  useEffect(() => {
    if (askedVersion.current === version) return;
    askedVersion.current = version;
    // A page that was gone can come back, such as when Eva writes it again.
    tries.current = 0;
    setFailed(false);
    setWanted((count) => count + 1);
  }, [version]);

  useEffect(() => {
    const again = (): void => {
      // The style of the root changes for other reasons too: only new colours load the page again.
      if (themeKey() === askedTheme.current) return;
      tries.current = 0;
      setWanted((count) => count + 1);
    };
    const themeWatch = new MutationObserver(again);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", again);
    window.addEventListener("pagehide", release);
    return () => {
      themeWatch.disconnect();
      media.removeEventListener("change", again);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [release]);

  useEffect(() => {
    if (!inView || have === wanted || failed) return undefined;
    let current = true;
    const { scheme: shownScheme, colours } = shownTheme();
    askedTheme.current = themeKey();
    api
      .pageFrame(path, shownScheme, colours)
      .then((next) => {
        if (!current) {
          if (next.state === "ready") void api.releasePageFrames([next.token]).catch(() => undefined);
          return;
        }
        release();
        if (next.state === "ready") live.current = next.token;
        setScheme(shownScheme);
        setReady(false);
        setToken(next);
        setHave(wanted);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [path, inView, have, wanted, failed, release]);

  const loaded = useCallback((): void => {
    const held = live.current;
    live.current = null;
    if (held === null) return;
    api
      .pageLoaded(held)
      .then(({ served }) => {
        const next = afterLoad(served, tries.current + 1);
        if (next === "ready") {
          tries.current = 0;
          setReady(true);
        } else if (next === "retry") {
          tries.current += 1;
          setHave(-1);
        } else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, []);
  return { token, failed, scheme, ready, loaded };
}

/** The mode and the contract colours that the page shows now. */
function shownTheme(): { readonly scheme: "light" | "dark"; readonly colours: Record<string, string> } {
  const style = getComputedStyle(document.documentElement);
  return { scheme: currentScheme(), colours: contractColours((name) => style.getPropertyValue(name)) };
}

function themeKey(): string {
  const { scheme, colours } = shownTheme();
  return `${scheme} ${JSON.stringify(colours)}`;
}

/** True while the element is near the view. */
function useInView(element: { readonly current: HTMLElement | null }): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const target = element.current;
    if (target === null) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry !== undefined) setInView(entry.isIntersecting);
      },
      { rootMargin: viewMargin },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [element]);
  return inView;
}
