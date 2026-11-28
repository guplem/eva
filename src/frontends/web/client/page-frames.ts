/**
 * The chat's side of the pages of an answer (#1129): which pages an answer shows, their names, and
 * the note of a page that Eva cannot show. `PageFrame.tsx` draws them.
 */
import type { PageFrame } from "../../../core/pages/chat-pages.ts";
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

/** The short note that takes the place of a page that Eva cannot show. */
export function pageNote(frame: Exclude<PageFrame, { readonly state: "ready" }>): string {
  if (frame.state === "gone") return "This page is gone. Eva deletes a page after 7 days.";
  if (frame.state === "too-large") return "This page is larger than 2 MB, so Eva does not show it.";
  return frame.reason;
}
