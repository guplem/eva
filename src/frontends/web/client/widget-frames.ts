/**
 * The home grid's side of the widget tokens (#691): the theme that the page sends, the tokens that
 * it keeps across a reconnect, and when it asks again.
 */
import { themeVariables } from "../../../core/widgets/widget-policy.ts";

export type WidgetSize = "small" | "medium" | "large";

/**
 * The page asks for its tokens again this often while it is in view. A token lives 6 hours. The
 * ask is local and keeps each working token, so only a widget with a new installed commit (#693)
 * gets a new token, and its frame loads the new version.
 */
export const frameRefreshMs = 60_000;

/** The light or dark mode that the page shows: the person's choice, or else the system's. */
export function pageScheme(dataTheme: string | null, systemDark: boolean): "light" | "dark" {
  if (dataTheme === "light" || dataTheme === "dark") return dataTheme;
  return systemDark ? "dark" : "light";
}

/** The colour variables of the contract, as the browser computes them on the page. */
export function contractColours(read: (name: string) => string): Record<string, string> {
  const colours: Record<string, string> = {};
  for (const name of themeVariables) {
    const value = read(name).trim();
    if (value !== "") colours[name] = value;
  }
  return colours;
}

/** The address of a frame at a size: the widget reads it from `?size=`. */
export function frameAddress(src: string, size: WidgetSize | "full"): string {
  return `${src}?size=${size}`;
}

/** True when the tokens are old enough to ask again. */
export function refreshDue(askedAt: number | null, now: number): boolean {
  return askedAt === null || now - askedAt >= frameRefreshMs;
}

const reconnectListeners = new Set<() => void>();

/** The page's event socket opened again, such as after an Eva restart: each grid asks for its tokens again. */
export function noticeReconnect(): void {
  for (const listener of reconnectListeners) listener();
}

export function onReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
}

/**
 * The policy that narrows the page's frames to the widget paths, so a widget cannot move its
 * frame to another page, of Eva or of another site. `index.html` already allows only Eva herself.
 */
export function framePolicy(origin: string): string {
  return `frame-src ${origin}/widgets/`;
}
