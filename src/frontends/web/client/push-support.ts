/** Whether this browser can get Eva's alerts as notifications, and what the person must do first. */

export type PushSupport =
  /** The browser can subscribe now. */
  | "ready"
  /** An iPhone or iPad gets notifications only in the app on the home screen. */
  | "needs-install"
  /** The person said no once: only the browser's site settings can undo it. */
  | "blocked"
  /** No push in this browser, or a page that is not on HTTPS. */
  | "unsupported";

export interface PushEnvironment {
  readonly userAgent: string;
  /** An iPad sends the user agent of a Mac, so a Mac with a touch screen is an iPad. */
  readonly touchScreen: boolean;
  /** True when the page runs as the installed app, not in a browser tab. */
  readonly standalone: boolean;
  readonly secure: boolean;
  readonly hasPush: boolean;
  readonly permission: "default" | "granted" | "denied" | null;
}

export function pushSupport(environment: PushEnvironment): PushSupport {
  const apple =
    /iPhone|iPad|iPod/.test(environment.userAgent) ||
    (environment.userAgent.includes("Macintosh") && environment.touchScreen);
  // Safari on an iPhone has no PushManager in a tab, so this check comes before the next one.
  if (apple && !environment.standalone) return "needs-install";
  if (!environment.secure || !environment.hasPush || environment.permission === null) return "unsupported";
  return environment.permission === "denied" ? "blocked" : "ready";
}

/** The browser's form of the key: the bytes of a base64url text. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  const text = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}
