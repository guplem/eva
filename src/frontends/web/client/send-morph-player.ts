/**
 * Plays the send morph (#943) in the page: a copy of the message box flies to the person's new bubble and becomes it.
 * The math lives in `send-morph.ts`. Each frame measures the newest bubble again, so the morph lands on it even when the
 * chat scrolls, or when React puts the stored message in the place of the sent one.
 */
import { boxAt, cornersAt, crossFade, durationMs, springAt, type Box, type Corners } from "./send-morph.ts";

/** A morph that waits for the new bubble. `cancel` stops it, such as after a send that failed. */
export interface SendMorph {
  readonly play: () => void;
  readonly cancel: () => void;
}

/** The morph that plays now. A second send ends it at once, so two copies never fly together. */
let playing: { readonly finish: () => void } | null = null;

const bubbleSelector = ".message.user";

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

function cornersOf(style: CSSStyleDeclaration): Corners {
  return [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ];
}

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

function milliseconds(name: string, fallback: number): number {
  return durationMs(token(name, "")) ?? fallback;
}

/** The page's styles, for the closed shadow root of the copy. Built once for each set of style sheets. */
let pageStyles: { readonly count: number; readonly sheet: CSSStyleSheet } | null = null;

function pageSheet(): CSSStyleSheet | null {
  const sheets = [...document.styleSheets];
  if (pageStyles?.count === sheets.length) return pageStyles.sheet;
  const rules = sheets.flatMap((sheet) => {
    try {
      return [...sheet.cssRules].map((rule) => rule.cssText);
    } catch {
      // A sheet from another site hides its rules. The copy only loses that sheet's look.
      return [];
    }
  });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(rules.join("\n"));
    pageStyles = { count: sheets.length, sheet };
    return sheet;
  } catch {
    // An older browser builds no style sheet by script, so it plays no morph.
    return null;
  }
}

/** Copies the page's styles while the page rests, so the first send does not spend a frame on it. */
export function prepareSendMorph(): () => void {
  // Safari has no idle callback, so it waits a second instead.
  if (!("requestIdleCallback" in window)) {
    const timer = setTimeout(pageSheet, 1000);
    return () => clearTimeout(timer);
  }
  const handle = window.requestIdleCallback(() => pageSheet());
  return () => window.cancelIdleCallback(handle);
}

function layer(className: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = className;
  return element;
}

/**
 * Takes a picture of the message box before it clears. Returns null when the person asks for less motion, or when the
 * box has no chat around it.
 */
export function startSendMorph(shell: HTMLElement): SendMorph | null {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const chat = shell.closest(".branch");
  if (chat === null) return null;
  playing?.finish();
  const before = [...chat.querySelectorAll(bubbleSelector)].at(-1) ?? null;
  const from = boxOf(shell);
  const style = getComputedStyle(shell);
  const fromCorners = cornersOf(style);
  const surface = layer("send-morph-box");
  surface.style.background = style.backgroundColor;
  surface.style.boxShadow = style.boxShadow;
  const copy = shell.cloneNode(true) as HTMLElement;
  // The copy is a picture: it takes no focus, no id and no click, and a screen reader skips it.
  copy.inert = true;
  for (const named of copy.querySelectorAll("[id]")) named.removeAttribute("id");
  copy.classList.add("send-morph-copy");
  Object.assign(copy.style, { width: `${String(from.width)}px`, height: `${String(from.height)}px` });
  const field = shell.querySelector("textarea");
  const copiedField = copy.querySelector("textarea");
  if (field !== null && copiedField !== null) copiedField.value = field.value;
  // The box's chips take their look from the .composer around it, so the copy gets one too.
  const holder = layer("composer");
  holder.append(copy);
  surface.append(holder);
  let cancelled = false;
  let frame = 0;
  // The finish of this morph only: a cancel must not end the morph of a later send.
  let own: (() => void) | null = null;

  const play = (): void => {
    requestAnimationFrame(() => {
      if (cancelled) return;
      const newest = (): HTMLElement | null => {
        // The first message of a new chat moves to the chat's own page. The bubble is then in a new branch.
        const root = chat.isConnected ? chat : document;
        const found = [...root.querySelectorAll<HTMLElement>(bubbleSelector)].at(-1) ?? null;
        return found === before || found?.isConnected !== true ? null : found;
      };
      const first = newest();
      if (first === null) return;
      // A bubble out of sight, such as below a chat that the person scrolled up, has no place to land on.
      const landing = boxOf(first);
      if (landing.y + landing.height <= 0 || landing.y >= window.innerHeight) return;
      const styles = pageSheet();
      if (styles === null) return;
      let locked: HTMLElement | null = first;
      const ghost = layer("send-morph");
      ghost.setAttribute("aria-hidden", "true");
      // A closed shadow root hides the copy from the page's queries and from the browser tests: the page holds one
      // chip and one bubble, not two, while the copy flies.
      const inside = ghost.attachShadow({ mode: "closed" });
      inside.adoptedStyleSheets = [styles];
      const face = layer("send-morph-bubble");
      const bubbleStyle = getComputedStyle(first);
      face.style.background = bubbleStyle.backgroundColor;
      const toCorners = cornersOf(bubbleStyle);
      const words = first.cloneNode(true) as HTMLElement;
      words.inert = true;
      words.removeAttribute("tabindex");
      words.classList.add("send-morph-words");
      face.append(words);
      inside.append(surface, face);
      document.body.append(ghost);
      if (field !== null) copy.querySelector("textarea")?.scrollTo({ top: field.scrollTop });

      let hidden: HTMLElement | null = null;
      const hide = (bubble: HTMLElement | null): void => {
        if (bubble === hidden) return;
        if (hidden !== null) hidden.style.opacity = "";
        hidden = bubble;
        if (bubble !== null) bubble.style.opacity = "0";
      };
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        cancelAnimationFrame(frame);
        clearTimeout(guard);
        hide(null);
        ghost.remove();
        if (playing === current) playing = null;
      };
      const current = { finish };
      playing = current;
      own = finish;
      const duration = milliseconds("--dur-morph", 560);
      // A hidden tab stops the frames, so the bubble must not stay hidden after the morph.
      const guard = setTimeout(finish, duration + 500);
      const started = performance.now();
      const step = (now: number): void => {
        // The morph keeps its bubble. It looks again only when React swaps it for the stored one, so a message
        // from another device that comes meanwhile does not take its place.
        if (locked?.isConnected !== true) locked = newest();
        const bubble = locked;
        if (cancelled || bubble === null) {
          finish();
          return;
        }
        hide(bubble);
        const time = Math.min(1, (now - started) / duration);
        const to = boxOf(bubble);
        const share = springAt(time);
        const place = boxAt(from, to, share);
        // Motion exception: the copy changes its size, not its scale, so its text and corners never stretch. It is one
        // fixed element on its own layer, so the page around it does not lay out again.
        Object.assign(ghost.style, {
          transform: `translate(${String(place.x)}px, ${String(place.y)}px)`,
          width: `${String(place.width)}px`,
          height: `${String(place.height)}px`,
        });
        const corners = cornersAt(fromCorners, toCorners, share);
        surface.style.borderRadius = corners;
        face.style.borderRadius = corners;
        words.style.width = `${String(to.width)}px`;
        const fade = crossFade(time);
        surface.style.opacity = String(fade.box);
        copy.style.opacity = String(fade.boxText);
        face.style.opacity = String(fade.bubble);
        if (time < 1) frame = requestAnimationFrame(step);
        else finish();
      };
      step(started);
      // The empty box comes in under the copy, so the person sees a new box where the old one left.
      shell.animate(
        [
          { opacity: 0, transform: "translateY(12px) scale(0.97)" },
          { opacity: 1, transform: "none" },
        ],
        {
          duration: milliseconds("--dur-slow", 400),
          delay: milliseconds("--dur-fast", 150),
          easing: token("--ease-out", "ease-out"),
          fill: "backwards",
        },
      );
    });
  };

  return {
    play,
    cancel: () => {
      cancelled = true;
      own?.();
    },
  };
}
