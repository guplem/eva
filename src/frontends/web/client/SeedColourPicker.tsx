/** A colour of Settings > Appearance: the 15 seeds of the design, and any other colour. */
import type { ReactElement } from "react";
import { seedColours, seedName } from "./appearance.ts";
import { Icon } from "./icons.tsx";

export function SeedColourPicker({
  seed,
  onPick,
  label = "Colour",
  customLabel = "Any colour",
}: {
  seed: string;
  onPick: (seed: string) => void;
  /** The name of the swatch group. Each picker on a page needs its own. */
  label?: string;
  /** The name of the free colour input. Each picker on a page needs its own. */
  customLabel?: string;
}): ReactElement {
  const custom = !seedColours.some((colour) => colour.hex === seed);
  return (
    <>
      <div className="seed-swatches" role="group" aria-label={label}>
        {seedColours.map((colour) => (
          <button
            key={colour.hex}
            type="button"
            className="seed-swatch"
            data-tooltip={colour.name}
            aria-label={colour.name}
            aria-pressed={colour.hex === seed}
            style={{ background: colour.hex }}
            onClick={() => onPick(colour.hex)}
          />
        ))}
        {/* The native input covers the round swatch, so a tap on it opens the browser's colour dialog. */}
        <label
          className="seed-swatch seed-custom"
          data-tooltip="Any colour"
          data-selected={custom}
          style={custom ? { background: seed } : undefined}
        >
          <Icon name="palette" />
          <input
            type="color"
            aria-label={customLabel}
            value={seed}
            onChange={(event) => onPick(event.target.value.toLowerCase())}
          />
        </label>
      </div>
      <span className="field-hint" aria-live="polite">
        Selected: {seedName(seed)}
      </span>
    </>
  );
}
