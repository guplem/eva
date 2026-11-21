/**
 * Keeps a card or a heading at the top of its scroll box while the page around it loads (issue 720).
 * A card above the target can fill after the first scroll, such as Eva's rules, and push the target down.
 * A card below it can fill late too: until then, the box is too short to bring the target to the top.
 */

/** A slow phone can take this long to read a card's data. */
const holdMs = 15_000;

/** The person's own scroll or key press ends the hold, so Eva never fights the person. */
const personEvents = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/** Scrolls `target` to the top of `box`, and holds it there until a person acts or time runs out. Returns a stop function. */
export function holdInView(box: Element, target: HTMLElement): () => void {
  target.scrollIntoView({ block: "start" });
  let layout = layoutOf(box, target);
  let frame = 0;
  const started = performance.now();
  const check = (): void => {
    if (performance.now() - started > holdMs || !target.isConnected) {
      stop();
      return;
    }
    const now = layoutOf(box, target);
    if (now !== layout) {
      target.scrollIntoView({ block: "start" });
      layout = layoutOf(box, target);
    }
    frame = requestAnimationFrame(check);
  };
  const stop = (): void => {
    cancelAnimationFrame(frame);
    for (const name of personEvents) window.removeEventListener(name, stop, true);
  };
  for (const name of personEvents) window.addEventListener(name, stop, { capture: true, passive: true });
  frame = requestAnimationFrame(check);
  return stop;
}

/** The place of the target and the height of the page, rounded, so a change of either shows. */
function layoutOf(box: Element, target: Element): string {
  const top = target.getBoundingClientRect().top - box.getBoundingClientRect().top;
  return `${String(Math.round(top))}/${String(box.scrollHeight)}`;
}

/**
 * Calls `found` once the element with `id` shows in the page, such as a card that fills after its own data loads.
 * The person's own scroll or key press, or the end of the time, stops the wait. Returns a stop function.
 */
export function waitForElement(id: string, found: (element: HTMLElement) => void): () => void {
  const check = (): void => {
    const element = document.getElementById(id);
    if (element === null) return;
    stop();
    found(element);
  };
  const observer = new MutationObserver(check);
  const timer = setTimeout(() => stop(), holdMs);
  const stop = (): void => {
    observer.disconnect();
    clearTimeout(timer);
    for (const name of personEvents) window.removeEventListener(name, stop, true);
  };
  observer.observe(document.body, { childList: true, subtree: true });
  for (const name of personEvents) window.addEventListener(name, stop, { capture: true, passive: true });
  return stop;
}
