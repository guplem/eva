import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { festiveArt, sceneMarkup } from "./festive-art.ts";
import type { SpecialDayId } from "./special-days.ts";
import { startRotation, visorClassName, type Face, type VisorSize } from "./visor-faces.ts";

interface VisorProps {
  readonly size?: VisorSize;
  readonly face?: Face;
  /** Cycles the faces of the login page. With reduced motion, the visor stays on the first face. */
  readonly rotate?: boolean;
  /** A special day replaces the face with that day's eyes. Only welcome places pass it. */
  readonly festive?: SpecialDayId | null;
}

/**
 * EVE's visor. Only the eyes change: a new face morphs from the last one, because React keeps
 * the same element and changes only its class. It is decorative: the text next to it speaks.
 */
export function Visor({ size = 36, face = "neutral", rotate = false, festive = null }: VisorProps): ReactElement {
  const [rotatingFace, setRotatingFace] = useState<Face>("searching");

  useEffect(() => {
    if (!rotate || festive !== null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return startRotation(setRotatingFace);
  }, [rotate, festive]);

  if (festive !== null) return <FestiveVisor id={festive} size={size} />;

  return (
    <span className={visorClassName(rotate ? rotatingFace : face, size)} aria-hidden="true">
      <span className="eyes">
        <i />
        <i />
      </span>
    </span>
  );
}

function FestiveVisor({ id, size }: { readonly id: SpecialDayId; readonly size: VisorSize }): ReactElement {
  const art = festiveArt[id];
  // Hats and scenes need room: the small visors of the nav rail and the messages show only the eyes.
  const large = size >= 76;
  const tokens = { "--festive-hue": art.hue, "--festive-chroma": art.chroma } as CSSProperties;
  // The markup is constant art from festive-art.ts, never text from a person or an engine.
  return (
    <span className={`${visorClassName("neutral", size)} festive ${art.motion}`} style={tokens} aria-hidden="true">
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
