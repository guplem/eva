/**
 * The voice notes of this page. Eva keeps no audio (lesson 123): the recording lives only in
 * this tab's memory until Eva turns it into text. The text goes to the message box, so the
 * person can fix a word that Eva heard wrong before they send it.
 */

/** The recording formats to try, best first: Chrome and Firefox record Opus, Safari records MP4. */
const recordingTypes = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"] as const;

/** The first format this browser records, or null to let the browser pick. */
export function recordingType(isSupported: (type: string) => boolean): string | null {
  return recordingTypes.find((type) => isSupported(type)) ?? null;
}

/** The time of a recording as `m:ss`. */
export function recordingTime(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The box after a voice note. Another device can write to the box during the recording,
 * so the heard text goes after that text and never replaces it.
 */
export function withHeardText(typed: string, heard: string): string {
  if (typed.trim() === "") return heard;
  return /\s$/.test(typed) ? `${typed}${heard}` : `${typed} ${heard}`;
}
