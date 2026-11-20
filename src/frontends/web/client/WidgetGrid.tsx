/**
 * The widgets of the home page (#691): the grid of the day panel (#972). Each widget runs in a
 * sandboxed frame with no origin, from its own token path, so it cannot read Eva's API, the login
 * cookie or another widget. A tap inside a frame goes to the widget; the corner button outside it
 * opens full screen. With no widget on, the grid shows nothing, and the page looks as before.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { placeWidgets, type LayoutBox } from "../../../core/widgets/widget-layout.ts";
import { widgetSandbox } from "../../../shared/widget-sandbox.ts";
import { api, type WidgetFrame } from "./api.ts";
import { useBackLayer } from "./back-layer-hook.ts";
import { goTo } from "./back-layers.ts";
import { useIsPhone } from "./ChatHeader.tsx";
import { Icon } from "./icons.tsx";
import { settingsHash } from "./settings-routes.ts";
import { contractColours, frameAddress, onReconnect, pageScheme, refreshDue } from "./widget-frames.ts";
import { layoutWidgetsOfFrames } from "./widget-layout-draft.ts";

/** The light or dark mode that the page shows now. The clone preview (#693) sends it too. */
export function currentScheme(): "light" | "dark" {
  return pageScheme(
    document.documentElement.getAttribute("data-theme"),
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
}

/** The cards of the home grid, and the mode that their tokens carry. */
export interface WidgetFrames {
  readonly frames: readonly WidgetFrame[];
  readonly scheme: "light" | "dark";
}

/**
 * Asks Eva for the cards of the home grid, and keeps their tokens fresh: after a reconnect, after a
 * change of the theme, and each minute while the page is in view. The page above the grid reads the
 * cards too: with at least one, it becomes the day panel (#972). It releases the tokens as it goes.
 */
export function useWidgetFrames(): WidgetFrames {
  const [frames, setFrames] = useState<readonly WidgetFrame[]>([]);
  const [scheme, setScheme] = useState(currentScheme);
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

  return { frames, scheme };
}

export function WidgetGrid({ widgets }: { readonly widgets: WidgetFrames }): ReactElement | null {
  const { frames, scheme } = widgets;
  // By id, so the full-screen frame takes the new token after each ask, as the grid does.
  const [fullId, setFullId] = useState<string | null>(null);
  const full = frames.find((frame) => frame.id === fullId && frame.src !== null) ?? null;
  const closeFull = useCallback(() => setFullId(null), []);
  useBackLayer(full !== null, closeFull, "widget-full");
  // The width chooses the layout. The preview of Settings places the cards with the same function (#985).
  const form = useIsPhone() ? "phone" : "computer";

  if (frames.length === 0) return null;
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  return (
    <>
      <div className="widget-grid" role="group" aria-label="Widgets">
        {placeWidgets(layoutWidgetsOfFrames(frames), form).map((card) => {
          const frame = byId.get(card.id);
          if (frame === undefined) return null;
          const place = gridPlace(card);
          return frame.src === null ? (
            <div key={frame.id} className="card widget-card widget-approve" style={place}>
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
            <div key={frame.id} className="card widget-card" style={place}>
              {/* The size is in the frame's address, so a new size loads the widget again. */}
              <WidgetFrameView frame={frame} size={card.size} scheme={scheme} />
              <button
                type="button"
                className="icon-button widget-full-button"
                aria-label={`Open ${frame.name} in full screen`}
                onClick={() => setFullId(frame.id)}
              >
                <Icon name="expand" />
              </button>
            </div>
          );
        })}
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

/** The explicit place of a card in a CSS grid: the home grid and the preview of Settings both use it. */
export function gridPlace(card: LayoutBox): CSSProperties {
  return {
    gridColumn: `${String(card.column)} / span ${String(card.columns)}`,
    gridRow: `${String(card.row)} / span ${String(card.rows)}`,
  };
}

/**
 * One frame, with the sandbox of `widgetSandbox`. The clone preview (#693) uses it too. The frame takes the page's `color-scheme`, so a widget that follows `prefers-color-scheme` follows Eva.
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
      sandbox={widgetSandbox}
      referrerPolicy="no-referrer"
      style={{ colorScheme: scheme }}
    />
  );
}
