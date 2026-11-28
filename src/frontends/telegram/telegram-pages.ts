/**
 * The line that Telegram shows for a page of an answer (#1129). Telegram has no safe frame, so the
 * bot never sends the HTML file: the line points to the chat in the web app.
 */

/** The line for an answer with a page. `webUrl` is Eva's remote address, or null when she has none. */
export function pageLine(webUrl: string | null, sessionId: string): string {
  return webUrl === null
    ? "This answer has a page. Open it in Eva's web app."
    : `This answer has a page. Open it in the web app: ${webUrl}/#/chat/${encodeURIComponent(sessionId)}`;
}
