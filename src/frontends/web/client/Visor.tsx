import { useEffect, useState, type ReactElement } from "react";
import { startRotation, visorClassName, type Face, type VisorSize } from "./visor-faces.ts";

interface VisorProps {
  readonly size?: VisorSize;
  readonly face?: Face;
  /** Cycles the faces of the login page. With reduced motion, the visor stays on the first face. */
  readonly rotate?: boolean;
}

/**
 * EVE's visor. Only the eyes change: a new face morphs from the last one, because React keeps
 * the same element and changes only its class. It is decorative: the text next to it speaks.
 */
export function Visor({ size = 36, face = "neutral", rotate = false }: VisorProps): ReactElement {
  const [rotatingFace, setRotatingFace] = useState<Face>("searching");

  useEffect(() => {
    if (!rotate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    return startRotation(setRotatingFace);
  }, [rotate]);

  return (
    <span className={visorClassName(rotate ? rotatingFace : face, size)} aria-hidden="true">
      <span className="eyes">
        <i />
        <i />
      </span>
    </span>
  );
}
