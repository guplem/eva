/** The React side of `back-layers.ts`: a layer that Back closes, for as long as `open` is true. */
import { useEffect, useRef, useState } from "react";
import { openLayer, restoreLayer } from "./back-layers.ts";

/**
 * Back calls `onBack`. A layer that stays open after it, such as a dialog that waits for a request
 * or asks about unsaved changes, gets a new entry, so the next Back asks again. With `restore`,
 * Back to an entry of the layer opens it again, such as the chat list after Back from a chat.
 */
export function useBackLayer(open: boolean, onBack: () => void, key = "layer", restore?: () => void): void {
  const back = useRef(onBack);
  back.current = onBack;
  const again = useRef(restore);
  again.current = restore;
  // Each Back and each restore runs the effect again, also when `open` does not change.
  const [runs, setRuns] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    const layer = openLayer(key, () => {
      back.current();
      setRuns((count) => count + 1);
    });
    return layer.close;
  }, [open, key, runs]);
  const canRestore = restore !== undefined;
  useEffect(() => {
    if (!canRestore) return undefined;
    return restoreLayer(key, () => {
      again.current?.();
      setRuns((count) => count + 1);
    });
  }, [key, canRestore]);
}
