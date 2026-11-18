/**
 * Scrolls the chat to its end while the send morph flies (#943). Without it, the chat jumps to the end in one frame, and
 * the new bubble sits behind the message box until the content around it has grown. Here the chat moves with the morph,
 * so the bubble lands in its place as one motion.
 */
import { glideAt } from "./send-morph.ts";

/** The glides that run now, by scroll box, with the function that ends each one. */
const running = new WeakMap<Element, () => void>();

/** The person's own scroll ends the glide, so Eva never fights the person. A key press does not: the person types the next message. */
const personEvents = ["wheel", "touchstart", "pointerdown"] as const;

/** True while a glide owns the scroll of `box`. The chat must not snap to its end then: the glide gets there. */
export function isGliding(box: Element): boolean {
  return running.has(box);
}

/**
 * Starts to scroll `box` to its end, over `duration` milliseconds. The end is read again each frame, because the
 * content grows while the glide runs. Returns a function that stops it where it is.
 */
export function startGlide(box: HTMLElement, duration: number): () => void {
  running.get(box)?.();
  let frame = 0;
  // The first frame sets the start, after the render that adds the bubble has changed the height.
  let started: number | null = null;
  let from = box.scrollTop;
  const end = (): void => {
    cancelAnimationFrame(frame);
    for (const name of personEvents) window.removeEventListener(name, byPerson, true);
    if (running.get(box) === end) running.delete(box);
  };
  // A tap in the message box moves no chat: the person may click back into it to type the next message.
  const byPerson = (event: Event): void => {
    if (event.target instanceof Element && event.target.closest(".composer") !== null) return;
    end();
  };
  const step = (now: number): void => {
    if (!box.isConnected) {
      end();
      return;
    }
    if (started === null) {
      started = now;
      from = box.scrollTop;
    }
    const time = Math.min(1, (now - started) / duration);
    const last = Math.max(0, box.scrollHeight - box.clientHeight);
    // The content grows in steps, and it shrinks when the message box folds. The glide only goes down: a shorter end
    // must never pull the chat back up, or the bubble would jump.
    box.scrollTop = Math.max(box.scrollTop, from + (last - from) * glideAt(time));
    if (time < 1) {
      frame = requestAnimationFrame(step);
      return;
    }
    // The bubble may have grown in the last frame, so the end is read once more.
    box.scrollTop = box.scrollHeight;
    end();
  };
  running.set(box, end);
  for (const name of personEvents) window.addEventListener(name, byPerson, { capture: true, passive: true });
  frame = requestAnimationFrame(step);
  return end;
}
