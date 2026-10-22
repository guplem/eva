/** A test page: each of EVE's faces at each size, the login rotation, and the festive eyes of each special day. */
import { useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { Visor } from "../../src/frontends/web/client/Visor.tsx";
import { festiveArt } from "../../src/frontends/web/client/festive-art.ts";
import type { SpecialDayId } from "../../src/frontends/web/client/special-days.ts";
import { faces, type Face, type VisorSize } from "../../src/frontends/web/client/visor-faces.ts";

const sizes: readonly VisorSize[] = [28, 36, 76, 128];

/** A press shows the next face, so a test sees the morph of the reference. */
function FaceRow({ start }: { readonly start: Face }): ReactElement {
  const [face, setFace] = useState(start);
  const next = (): void => setFace(faces[(faces.indexOf(face) + 1) % faces.length] ?? "neutral");
  return (
    <figure aria-label={start} data-face={face} onClick={next}>
      {sizes.map((size) => (
        <Visor key={size} size={size} face={face} />
      ))}
      <figcaption>{face}</figcaption>
    </figure>
  );
}

function Gallery(): ReactElement {
  return (
    <main className="gallery">
      {faces.map((face) => (
        <FaceRow key={face} start={face} />
      ))}
      <figure aria-label="rotate">
        <Visor size={128} rotate />
        <figcaption>rotate</figcaption>
      </figure>
      {(Object.keys(festiveArt) as SpecialDayId[]).map((id) => (
        <figure key={id} aria-label={`festive ${id}`}>
          {sizes.map((size) => (
            <Visor key={size} size={size} festive={id} />
          ))}
          <figcaption>{id}</figcaption>
        </figure>
      ))}
    </main>
  );
}

const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<Gallery />);
