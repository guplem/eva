/**
 * The one tooltip of the page. An element asks for one with `data-tooltip="Text"`, never with
 * `title`: the browser draws a `title` in its own grey box that ignores the EVE theme.
 * One layer listens on the document, so a component adds no wrapper and no state of its own.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { placeTooltip, type TooltipPlace } from "./tooltip-place.ts";

/** A pointer that rests this long on an element shows its tooltip, so a pass over the rail shows none. */
const hoverDelayMs = 400;
const tooltipId = "eva-tooltip";

interface Shown {
  readonly anchor: Element;
  readonly text: string;
}

function tooltipAnchor(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest("[data-tooltip]") : null;
}

export function TooltipLayer(): ReactElement | null {
  const [shown, setShown] = useState<Shown | null>(null);
  const [place, setPlace] = useState<TooltipPlace | null>(null);
  const tip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Element | null = null;
    const show = (anchor: Element): void => {
      const text = anchor.getAttribute("data-tooltip") ?? "";
      if (text === "") return;
      current = anchor;
      setShown({ anchor, text });
    };
    const hide = (): void => {
      clearTimeout(timer);
      current = null;
      setShown(null);
    };
    const onPointerOver = (event: PointerEvent): void => {
      // A touch has no hover. On a phone, the label or the visible words carry the meaning.
      if (event.pointerType === "touch") return;
      // A pointer with a button down drags, as on a column divider: a tooltip then hides what it moves.
      if (event.buttons !== 0) return;
      const anchor = tooltipAnchor(event.target);
      if (anchor === current) return;
      clearTimeout(timer);
      if (anchor === null) {
        hide();
      } else if (current !== null) {
        // From one tooltip to the next, the next one shows at once, as in a toolbar.
        show(anchor);
      } else {
        timer = setTimeout(() => show(anchor), hoverDelayMs);
      }
    };
    const onFocusIn = (event: FocusEvent): void => {
      const anchor = tooltipAnchor(event.target);
      // A click also moves the focus. Only a focus from the keyboard shows the tooltip.
      if (anchor?.matches(":focus-visible") === true) show(anchor);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKeyDown);
    // The tooltip has a fixed place, so it would stay behind when its element moves.
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  // The element names the tooltip, so a screen reader reads the hint too.
  useEffect(() => {
    if (shown === null) return undefined;
    const before = shown.anchor.getAttribute("aria-describedby");
    if (before === null) shown.anchor.setAttribute("aria-describedby", tooltipId);
    return () => {
      if (before === null) shown.anchor.removeAttribute("aria-describedby");
    };
  }, [shown]);

  // Measure before the paint, so the tooltip never shows at a wrong place.
  useLayoutEffect(() => {
    if (shown === null || tip.current === null || !shown.anchor.isConnected) {
      setPlace(null);
      return;
    }
    const size = tip.current.getBoundingClientRect();
    const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
    const prefer = shown.anchor.getAttribute("data-tooltip-side") === "right" ? "right" : "above";
    setPlace(placeTooltip(shown.anchor.getBoundingClientRect(), size, viewport, prefer));
  }, [shown]);

  if (shown === null) return null;
  return (
    <div
      ref={tip}
      id={tooltipId}
      role="tooltip"
      className={`tooltip${place === null ? "" : ` ${place.side}`}`}
      style={place === null ? { visibility: "hidden" } : { left: place.left, top: place.top }}
    >
      {shown.text}
    </div>
  );
}
