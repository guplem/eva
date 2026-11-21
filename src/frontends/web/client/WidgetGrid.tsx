/**
 * The widgets of the home page (#691): the grid of the day panel (#972). Each widget runs in a
 * sandboxed frame with no origin, from its own token path, so it cannot read Eva's API, the login
 * cookie or another widget. A tap inside a frame goes to the widget; the corner button outside it
 * opens full screen. With no widget on, the grid shows nothing, and the page looks as before.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import type { WidgetSize } from "../../../core/widgets/widget-kinds.ts";
import { placeHome, type LayoutBox } from "../../../core/widgets/widget-layout.ts";
import { widgetSandbox } from "../../../shared/widget-sandbox.ts";
import { api, type WidgetFrame } from "./api.ts";
import { useBackLayer } from "./back-layer-hook.ts";
import { goTo } from "./back-layers.ts";
import { useIsPhone } from "./ChatHeader.tsx";
import { Icon } from "./icons.tsx";
import { settingsHash } from "./settings-routes.ts";
import { contractColours, frameAddress, onReconnect, pageScheme, refreshDue } from "./widget-frames.ts";
import { layoutWidgetsOfFrames } from "./widget-layout-draft.ts";
import { fillNewChat } from "./new-chat-text.ts";
import {
  askRequestOf,
  checkAsk,
  openAddressOf,
  textAfterTyped,
  type AskAnswer,
  type AskRequest,
} from "./widget-asks.ts";

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

/**
 * The day panel's widgets: the greeting row with its header slot (#1007), and the grid. The width
 * chooses the layout. The preview of Settings places the cards with the same function (#985). On a
 * computer the widget of the header slot sits at the right of the greeting; on a phone there is no
 * room, so it is the first row of the grid, at the full width.
 */
export function WidgetGrid({
  widgets,
  greeting,
}: {
  readonly widgets: WidgetFrames;
  /** The content of the greeting row: EVE, the greeting, and an action such as a setup button. */
  readonly greeting: ReactNode;
}): ReactElement {
  const { frames, scheme } = widgets;
  // By id, so the full-screen frame takes the new token after each ask, as the grid does.
  const [fullId, setFullId] = useState<string | null>(null);
  const full = frames.find((frame) => frame.id === fullId && frame.src !== null) ?? null;
  const closeFull = useCallback(() => setFullId(null), []);
  const onAsk = useCallback(
    (frame: WidgetFrame, request: AskRequest, tapped: boolean) => answerAsk(frame, request, tapped, closeFull),
    [closeFull],
  );
  useBackLayer(full !== null, closeFull, "widget-full");
  const gridRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrowGrid(gridRef);
  // A computer window with the chat list open can leave the panel too narrow for four columns (#1023).
  const form = useIsPhone() || narrow ? "phone" : "computer";

  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const home = placeHome(layoutWidgetsOfFrames(frames), form);
  const header = home.header === null ? undefined : byId.get(home.header);
  // On a phone the header widget takes the first row, so every other card moves one row down.
  const below = form === "phone" && header !== undefined ? 1 : 0;
  const card = (frame: WidgetFrame, size: WidgetSize, place: CSSProperties, className = ""): ReactElement =>
    frame.src === null ? (
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
      <div key={frame.id} className={`card widget-card${className}`} style={place}>
        {/* The size is in the frame's address, so a new size loads the widget again. */}
        <WidgetFrameView
          frame={frame}
          size={size}
          scheme={scheme}
          onAsk={(request, tapped) => onAsk(frame, request, tapped)}
        />
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

  return (
    <>
      <div className="day-greeting">
        {greeting}
        {form === "computer" && header !== undefined && card(header, "header", {}, " widget-header")}
      </div>
      <div
        ref={gridRef}
        className={form === "computer" ? "widget-grid is-computer" : "widget-grid"}
        role="group"
        aria-label="Widgets"
      >
        {form === "phone" && header !== undefined && card(header, "header", { gridColumn: "1 / -1", gridRow: "1" })}
        {home.cards.map((placed) => {
          const frame = byId.get(placed.id);
          return frame === undefined
            ? null
            : card(frame, placed.size, gridPlace({ ...placed, row: placed.row + below }));
        })}
      </div>
      {full !== null && (
        <div className="widget-full" role="dialog" aria-modal="true" aria-label={full.name}>
          <WidgetFrameView
            frame={full}
            size="full"
            scheme={scheme}
            onAsk={(request, tapped) => onAsk(full, request, tapped)}
          />
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
 * The narrowest panel that keeps the computer layout. Below it a column is under about 160 px. It is
 * also the width at which the header slot leaves the greeting row (`widgets.css`).
 */
const computerGridMinPx = 680;

/** True when the grid is narrower than `computerGridMinPx`. The grid's width is the panel's width. */
function useNarrowGrid(ref: { readonly current: HTMLElement | null }): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = (): void => setNarrow(element.clientWidth > 0 && element.clientWidth < computerGridMinPx);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return narrow;
}

/** The explicit place of a card in a CSS grid: the home grid and the preview of Settings both use it. */
export function gridPlace(card: LayoutBox): CSSProperties {
  return {
    gridColumn: `${String(card.column)} / span ${String(card.columns)}`,
    gridRow: `${String(card.row)} / span ${String(card.rows)}`,
  };
}

/**
 * Does what a widget asks (contract 3, #696, #1006), and gives the answer. `chat` puts the text in
 * the message box of the home page, and `open` opens the best page for a vault path. Both close full
 * screen first, so the person sees the result.
 */
async function answerAsk(
  frame: WidgetFrame,
  request: AskRequest,
  tapped: boolean,
  closeFull: () => void,
): Promise<AskAnswer> {
  const approved = frame.asks;
  const reason = checkAsk(request, { approved, tapped, preview: false });
  if (reason !== null) return { ok: false, reason };
  if (request.ask === "chat") {
    closeFull();
    const text = request.text as string;
    fillNewChat((typed) => textAfterTyped(typed, text), frame.name);
    return { ok: true };
  }
  if (request.ask === "open") {
    const path = (request.path as string).replace(/\/+$/, "");
    const address = openAddressOf(path);
    if (address === null) return { ok: false, reason: "not-found" };
    const existing = await api.existingFiles([path]).catch((): readonly string[] => []);
    if (!existing.includes(path)) return { ok: false, reason: "not-found" };
    closeFull();
    goTo(address);
    return { ok: true };
  }
  return { ok: true, asks: approved };
}

/**
 * True when the person tapped this frame just now. A tap in a frame activates Eva's page too, so the
 * page also checks that the frame holds the focus: a tap elsewhere on the page moves the focus away.
 * A browser with no `userActivation` has only the focus check.
 */
function tappedFrame(element: HTMLIFrameElement): boolean {
  const activation = (navigator as { userActivation?: UserActivation }).userActivation;
  return (activation?.isActive ?? true) && document.activeElement === element;
}

/**
 * One frame, with the sandbox of `widgetSandbox`. The clone preview (#693) uses it too. The frame takes the page's `color-scheme`, so a widget that follows `prefers-color-scheme` follows Eva.
 * It answers each ask of its widget (contract 3) with `onAsk`. With no `onAsk`, as in the preview of
 * a clone, it refuses each ask, so the widget hides what needs Eva.
 */
export function WidgetFrameView({
  frame,
  size,
  scheme,
  onAsk,
}: {
  readonly frame: Pick<WidgetFrame, "name" | "src">;
  readonly size: WidgetFrame["size"] | "full";
  readonly scheme: "light" | "dark";
  readonly onAsk?: (request: AskRequest, tapped: boolean) => Promise<AskAnswer>;
}): ReactElement | null {
  const element = useRef<HTMLIFrameElement>(null);
  const ask = useRef(onAsk);
  ask.current = onAsk;
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const own = element.current;
      // Eva knows the widget by its frame: `event.origin` is "null" for every widget.
      const target = own?.contentWindow ?? null;
      if (own === null || target === null || event.source !== target) return;
      const request = askRequestOf(event.data);
      if (request === null) return;
      const reply = (answer: AskAnswer): void => target.postMessage({ eva: "widget", id: request.id, ...answer }, "*");
      const handle = ask.current;
      if (handle === undefined) {
        reply({ ok: false, reason: checkAsk(request, { approved: [], tapped: false, preview: true }) ?? "unknown" });
        return;
      }
      handle(request, tappedFrame(own)).then(reply, () => reply({ ok: false, reason: "unknown" }));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  if (frame.src === null) return null;
  return (
    <iframe
      ref={element}
      className="widget-frame"
      aria-label={frame.name}
      src={frameAddress(frame.src, size)}
      sandbox={widgetSandbox}
      referrerPolicy="no-referrer"
      style={{ colorScheme: scheme }}
    />
  );
}
