import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from "react";
import { festiveArt, sceneMarkup } from "./festive-art.ts";
import type { SpecialDayId } from "./special-days.ts";
import { startRotation, visorClassName, type Face, type VisorSize } from "./visor-faces.ts";
import { gazeDelayMs, gazeOffset, pointerQuery } from "./visor-gaze.ts";

interface VisorProps {
  readonly size?: VisorSize;
  readonly face?: Face;
  /** Cycles the faces of the login page. With reduced motion, the visor stays on the first face. */
  readonly rotate?: boolean;
  /** A special day replaces the face with that day's eyes. Only welcome places pass it. */
  readonly festive?: SpecialDayId | null;
  /** After a short wait, the eyes follow the mouse. Only on a device with a mouse, and with motion on. */
  readonly followPointer?: boolean;
  /** An unread error: the crosses glow red and pulse (#566). */
  readonly alarm?: boolean;
}

/**
 * EVE's visor. Only the eyes change: a new face morphs from the last one, because React keeps
 * the same element and changes only its class. It is decorative: the text next to it speaks.
 */
export function Visor({
  size = 36,
  face = "neutral",
  rotate = false,
  festive = null,
  followPointer = false,
  alarm = false,
}: VisorProps): ReactElement {
  const [rotatingFace, setRotatingFace] = useState<Face>("searching");
  const visor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!rotate || festive !== null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return startRotation(setRotatingFace);
  }, [rotate, festive]);

  useEffect(() => {
    if (!followPointer) return;
    return followGaze(visor);
  }, [followPointer]);

  if (festive !== null) return <FestiveVisor ref={visor} id={festive} size={size} />;

  return (
    <span
      ref={visor}
      className={`${visorClassName(rotate ? rotatingFace : face, size)}${alarm ? " alarm" : ""}`}
      aria-hidden="true"
    >
      <span className="eyes">
        <i />
        <i />
      </span>
    </span>
  );
}

/**
 * Moves the eyes toward the mouse after `gazeDelayMs`, through the `--gaze-*` properties of the
 * visor. Returns a function that stops it. A phone has no pointer to follow, so it does nothing there.
 */
function followGaze(visor: RefObject<HTMLSpanElement | null>): () => void {
  if (!window.matchMedia(pointerQuery).matches) return () => undefined;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => undefined;
  let frame = 0;
  let pointer: { readonly x: number; readonly y: number } | null = null;
  const look = (): void => {
    frame = 0;
    const element = visor.current;
    if (element === null) return;
    const box = element.getBoundingClientRect();
    const offset =
      pointer === null
        ? { x: 0, y: 0 }
        : gazeOffset(pointer.x - (box.left + box.width / 2), pointer.y - (box.top + box.height / 2));
    element.style.setProperty("--gaze-x", `${offset.x.toFixed(3)}em`);
    element.style.setProperty("--gaze-y", `${offset.y.toFixed(3)}em`);
  };
  // One update per frame, however fast the mouse moves.
  const lookSoon = (): void => {
    if (frame === 0) frame = requestAnimationFrame(look);
  };
  const move = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    pointer = { x: event.clientX, y: event.clientY };
    lookSoon();
  };
  // A pointer that leaves the window gives no more news, so EVE looks ahead again.
  const leave = (event: PointerEvent): void => {
    if (event.relatedTarget !== null) return;
    pointer = null;
    lookSoon();
  };
  const timer = setTimeout(() => {
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerout", leave);
  }, gazeDelayMs);
  return () => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", move);
    document.documentElement.removeEventListener("pointerout", leave);
    visor.current?.style.removeProperty("--gaze-x");
    visor.current?.style.removeProperty("--gaze-y");
  };
}

function FestiveVisor({
  ref,
  id,
  size,
}: {
  readonly ref: RefObject<HTMLSpanElement | null>;
  readonly id: SpecialDayId;
  readonly size: VisorSize;
}): ReactElement {
  const art = festiveArt[id];
  // Hats and scenes need room: the small visors of the nav rail and the messages show only the eyes.
  const large = size >= 76;
  const tokens = { "--festive-hue": art.hue, "--festive-chroma": art.chroma } as CSSProperties;
  // The markup is constant art from festive-art.ts, never text from a person or an engine.
  return (
    <span
      ref={ref}
      className={`${visorClassName("neutral", size)} festive ${art.motion}`}
      style={tokens}
      aria-hidden="true"
    >
      {large && art.scene !== undefined && (
        <span className="festive-scene" dangerouslySetInnerHTML={{ __html: sceneMarkup(art.scene) }} />
      )}
      <span className="eyes">
        <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: art.eyes[0] }} />
        <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: art.eyes[1] }} />
      </span>
      {large && art.decoration !== undefined && (
        <span className="festive-decoration" dangerouslySetInnerHTML={{ __html: art.decoration }} />
      )}
    </span>
  );
}
