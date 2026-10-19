/** The seed colour of Settings > Appearance: the 15 seeds of the design, and any other colour. */
import type { ReactElement } from "react";
import { seedColours, seedName } from "./appearance.ts";

export function SeedColourPicker({ seed, onPick }: { seed: string; onPick: (seed: string) => void }): ReactElement {
  return (
    <>
      <div className="seed-swatches" role="group" aria-label="Colour">
        {seedColours.map((colour) => (
          <button
            key={colour.hex}
            type="button"
            className="seed-swatch"
            title={colour.name}
            aria-label={colour.name}
            aria-pressed={colour.hex === seed}
            style={{ background: colour.hex }}
            onClick={() => onPick(colour.hex)}
          />
        ))}
      </div>
      <div className="seed-custom">
        <label>
          <input type="color" value={seed} onChange={(event) => onPick(event.target.value.toLowerCase())} />
          Any colour
        </label>
        <span className="seed-name">{seedName(seed)}</span>
      </div>
    </>
  );
}
