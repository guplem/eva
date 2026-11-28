/**
 * The Content Security Policy of a page in a chat answer (#1129). A page is code that a model
 * wrote, and it holds the person's data, so it never connects to the internet. It runs its own
 * inline code and reads only Eva's theme file. A widget keeps its own policy (`widget-policy.ts`).
 */
import { pageSandbox } from "../../shared/widget-sandbox.ts";

/**
 * The policy of one page answer. `base` is the token path, such as
 * `http://127.0.0.1:7420/widgets/<token>/`; `frameAncestor` is Eva's own origin. A source with a
 * whole file path matches only that file, so the page loads no other style sheet.
 */
export function pagePolicy(base: string, frameAncestor: string): string {
  return [
    `sandbox ${pageSandbox}`,
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    `style-src 'unsafe-inline' ${base}eva/theme.css`,
    // A chart can draw on a canvas and keep the result as an image of its own.
    "img-src data: blob:",
    "media-src data: blob:",
    "font-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestor}`,
  ].join("; ");
}
