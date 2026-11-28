/**
 * The chat's side of the pages of an answer (#1129): which pages an answer shows, their names, and
 * the note of a page that Eva cannot show. `PageFrame.tsx` draws them.
 */
import type { PageFrame, PageKept } from "../../../core/pages/chat-pages.ts";
import { extractFileMarkers } from "../../../shared/file-markers.ts";

/** The pages that the markers of a whole answer name, each once. */
export function answerPages(answer: string): readonly string[] {
  return extractFileMarkers(answer).show;
}

/** The name of a page for a screen reader: its file name, without the extension. */
export function pageName(path: string): string {
  const file =
    path
      .split(/[/\\]/)
      .filter((part) => part !== "")
      .at(-1) ?? path;
  return file.replace(/\.html?$/i, "");
}

/** The accessible name of a page frame, which says that it is a page. */
export function pageLabel(path: string): string {
  return `Page: ${pageName(path)}`;
}

/** A frame asks for a token at most this many times before it gives up. */
export const maxPageTries = 3;

export const pageFailedNote = "Eva could not load this page. Reload the chat to try again.";

/**
 * What a frame does after its load. `served` comes from Eva: a frame loads after a 404 too, and
 * stays blank then. `tries` counts the tokens that the frame asked for.
 */
export function afterLoad(served: boolean, tries: number): "ready" | "retry" | "failed" {
  if (served) return "ready";
  return tries < maxPageTries ? "retry" : "failed";
}

/** How a page stays, in words beside its shape, or null for a page that goes after 7 days. */
export function keptWords(kept: PageKept): string | null {
  if (kept === "saved") return "Saved";
  return kept === "note" ? "In your notes" : null;
}

/** The pinned column keeps the 300 px of a page that the prompt promises, with the frame's border and padding. */
export const pinnedMinWidth = 320;
/** The width of a new column: a chart reads well, and a 1280 px window keeps a chat of more than 480 px. */
export const pinnedDefaultWidth = 400;
/** Below this width the chat is hard to read, so the pinned page becomes the bar of the phone. */
export const chatMinWidth = 480;
/**
 * The chat width that three columns must leave: the pinned page and the details sit side by side
 * only on a very wide window. Below it, the details cover the page while the person reads them.
 */
export const chatComfortWidth = 640;
/** The width of the chat details inspector. Keep it in step with `chat-details.css`. */
export const inspectorWidth = 300;

export interface PinnedLayout {
  /** `column` at the right of the chat, or `bar` above the message box, as on a phone. */
  readonly place: "column" | "bar";
  /** The width of the column, inside its limits. */
  readonly width: number;
  /** The inspector sits `beside` the column, or `over` it when both would leave the chat too narrow. */
  readonly inspector: "beside" | "over";
}

/**
 * Where a pinned page shows (#1130). `layout` is the width of the page area right of the nav rail,
 * `list` the width of the chat list, `column` the width that the person chose, and `inspector`
 * whether the chat details show.
 */
export function pinnedLayout(sizes: {
  readonly layout: number;
  readonly list: number;
  readonly column: number;
  readonly inspector: boolean;
}): PinnedLayout {
  const room = sizes.layout - sizes.list - chatMinWidth;
  const wanted = Math.max(pinnedMinWidth, sizes.column);
  if (room < pinnedMinWidth) return { place: "bar", width: wanted, inspector: "beside" };
  const width = Math.min(wanted, room);
  return {
    place: "column",
    width,
    inspector:
      sizes.inspector && sizes.layout - sizes.list - width - inspectorWidth < chatComfortWidth ? "over" : "beside",
  };
}

/** The short note that takes the place of a page that Eva cannot show. */
export function pageNote(frame: Exclude<PageFrame, { readonly state: "ready" }>): string {
  if (frame.state === "gone") return "This page is gone. Eva deletes a page that nobody saved after 7 days.";
  if (frame.state === "too-large") return "This page is larger than 2 MB, so Eva does not show it.";
  return frame.reason;
}
