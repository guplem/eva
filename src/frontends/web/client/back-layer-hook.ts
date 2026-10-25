/** The React side of `back-layers.ts`: a layer that Back closes, for as long as `open` is true. */
import { useEffect, useRef, useState } from "react";
import { openLayer, restoreLayer } from "./back-layers.ts";

/**
 * Back calls `onBack`. A layer that stays open after it, such as a dialog that waits for a request
 * or asks about unsaved changes, gets a new entry, so the next Back asks again.
 */
export function useBackLayer(open: boolean, onBack: () => void, key = "layer"): void {
  const back = useRef(onBack);
  back.current = onBack;
  const [backs, setBacks] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    const layer = openLayer(key, () => {
      back.current();
      setBacks((count) => count + 1);
    });
    return layer.close;
  }, [open, key, backs]);
}

/** Back to an entry of the layer `key` runs `restore`, which opens the layer again. */
export function useRestoreLayer(key: string, restore: (() => void) | null): void {
  const run = useRef(restore);
  run.current = restore;
  const active = restore !== null;
  useEffect(() => (active ? restoreLayer(key, () => run.current?.()) : undefined), [key, active]);
}
