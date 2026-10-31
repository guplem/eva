/**
 * The widgets of the home page (#691), below EVE's face and the greeting. Each widget runs in a
 * sandboxed frame with no origin, from its own token path, so it cannot read Eva's API, the login
 * cookie or another widget. A tap inside a frame goes to the widget; the corner button outside it
 * opens full screen. With no widget on, the grid shows nothing, and the page looks as before.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { api, type WidgetFrame } from "./api.ts";
import { useBackLayer } from "./back-layer-hook.ts";
import { goTo } from "./back-layers.ts";
import { Icon } from "./icons.tsx";
import { settingsHash } from "./settings-routes.ts";
import { contractColours, frameAddress, onReconnect, pageScheme, refreshDue } from "./widget-frames.ts";

/** The light or dark mode that the page shows now. The clone preview (#693) sends it too. */
export function currentScheme(): "light" | "dark" {
  return pageScheme(
    document.documentElement.getAttribute("data-theme"),
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
}

export function WidgetGrid(): ReactElement | null {
  const [frames, setFrames] = useState<readonly WidgetFrame[]>([]);
  const [scheme, setScheme] = useState(currentScheme);
  // By id, so the full-screen frame takes the new token after each ask, as the grid does.
  const [fullId, setFullId] = useState<string | null>(null);
  const tokens = useRef<readonly string[]>([]);
  const askedAt = useRef<number | null>(null);
  // The number of the newest ask, so an older answer that comes late changes nothing.
  const latest = useRef(0);

  /** `keep`: false after a change of the theme, so each frame loads again with the new colours. */
  const ask = useCallback((keep: boolean): void => {
    const style = getComputedStyle(document.documentElement);
    const shownScheme = currentScheme();
    askedAt.current = Date.now();
    latest.current += 1;
    const asked = latest.current;
    api
      .widgetFrames(
        shownScheme,
        contractColours((name) => style.getPropertyValue(name)),
        keep ? tokens.current : [],
      )
      .then((next) => {
        // A newer ask started since: its answer wins, or this one would keep tokens that it released.
        if (asked !== latest.current) {
          const unused = next.flatMap((frame) =>
            frame.token === null || tokens.current.includes(frame.token) ? [] : [frame.token],
          );
          if (unused.length > 0) void api.releaseWidgetFrames(unused).catch(() => undefined);
          return;
        }
        const old = tokens.current.filter((token) => !next.some((frame) => frame.token === token));
        if (old.length > 0) void api.releaseWidgetFrames(old).catch(() => undefined);
        tokens.current = next.flatMap((frame) => (frame.token === null ? [] : [frame.token]));
        setScheme(shownScheme);
        setFrames(next);
      })
      // Without an answer the grid keeps what it shows; the next reconnect asks again.
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    ask(true);
    const stopReconnect = onReconnect(() => ask(true));
    const onVisible = (): void => {
      if (document.visibilityState === "visible" && refreshDue(askedAt.current, Date.now())) ask(true);
    };
    const timer = setInterval(onVisible, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    // A change of the theme or the colour in this browser, or of the system's mode.
    const themeWatch = new MutationObserver(() => ask(false));
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = (): void => ask(false);
    media.addEventListener("change", onSystemChange);
    const release = (): void => {
      if (tokens.current.length > 0) void api.releaseWidgetFrames(tokens.current).catch(() => undefined);
      tokens.current = [];
    };
    window.addEventListener("pagehide", release);
    // A page back from the back-forward cache released its tokens as it left: ask for new ones.
    const onShow = (event: PageTransitionEvent): void => {
      if (event.persisted) ask(true);
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      stopReconnect();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      themeWatch.disconnect();
      media.removeEventListener("change", onSystemChange);
      window.removeEventListener("pagehide", release);
      window.removeEventListener("pageshow", onShow);
      release();
    };
  }, [ask]);

  const full = frames.find((frame) => frame.id === fullId && frame.src !== null) ?? null;
  const closeFull = useCallback(() => setFullId(null), []);
  useBackLayer(full !== null, closeFull, "widget-full");

  if (frames.length === 0) return null;
  return (
    <>
      <div className="widget-grid" role="group" aria-label="Widgets">
        {frames.map((frame) =>
          frame.src === null ? (
            <div key={frame.id} className={`card widget-card size-${frame.size} widget-approve`}>
              <Icon name="lock" />
              <strong>{frame.name}</strong>
              <span>Approve to show this widget</span>
              <button
                type="button"
                className="ghost"
                onClick={() => goTo(settingsHash({ section: "personalize", item: "widgets" }))}
              >
                Approve
              </button>
            </div>
          ) : (
            <div key={frame.id} className={`card widget-card size-${frame.size}`}>
              <WidgetFrameView frame={frame} size={frame.size} scheme={scheme} />
              <button
                type="button"
                className="icon-button widget-full-button"
                aria-label={`Open ${frame.name} in full screen`}
                onClick={() => setFullId(frame.id)}
              >
                <Icon name="expand" />
              </button>
            </div>
          ),
        )}
      </div>
      {full !== null && (
        <div className="widget-full" role="dialog" aria-modal="true" aria-label={full.name}>
          <WidgetFrameView frame={full} size="full" scheme={scheme} />
          <button
            type="button"
            className="icon-button widget-full-button"
            aria-label="Close full screen"
            onClick={closeFull}
          >
            <Icon name="shrink" />
          </button>
        </div>
      )}
    </>
  );
}

/**
 * One frame. `sandbox` with no `allow-same-origin` gives the widget no origin of its own. The
 * frame takes the page's `color-scheme`, so a widget that follows `prefers-color-scheme` follows Eva.
 */
export function WidgetFrameView({
  frame,
  size,
  scheme,
}: {
  readonly frame: Pick<WidgetFrame, "name" | "src">;
  readonly size: WidgetFrame["size"] | "full";
  readonly scheme: "light" | "dark";
}): ReactElement | null {
  if (frame.src === null) return null;
  return (
    <iframe
      className="widget-frame"
      aria-label={frame.name}
      src={frameAddress(frame.src, size)}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      style={{ colorScheme: scheme }}
    />
  );
}
