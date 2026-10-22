/** The words of the Location card, and the per-device choice to share the location while Eva is open. */
import type { CurrentPlaceView } from "./api.ts";

/** Where this device keeps the person's choice. Only this browser reads it. */
export const shareLocationKey = "eva-share-location";

/** The web app sends a point at most this often, as Eva keeps one every 15 minutes. */
export const shareEveryMs = 15 * 60_000;

function ago(at: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${String(hours)} hour${hours === 1 ? "" : "s"} ago`;
}

/** What Eva knows about where the person is, in one line. */
export function placeWords(place: CurrentPlaceView | null, now: Date): string {
  if (place === null) return "Eva does not know where you are yet.";
  if (place.source === "home" || place.at === null) {
    return "Eva uses your home place from Life/About me.md: your phone sent no location in the last day.";
  }
  const from = place.source === "telegram" ? "Telegram" : "this web app";
  return `Eva knows your location from ${from}, ${ago(place.at, now)}.`;
}

/** Reads the choice of this browser. A blocked storage reads as no. */
export function readShareChoice(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(shareLocationKey) === "on";
  } catch {
    return false;
  }
}
