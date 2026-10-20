/**
 * The voice notes of this page. Eva keeps no audio (lesson 123): the recording lives only in
 * this tab's memory, so the person can play what they said next to what Eva heard. A reload
 * forgets it, and the message then shows only the text.
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

/** Older recordings give their memory back, so a long day of voice notes does not fill the tab. */
const keptRecordings = 20;

/** The recordings of this tab, by chat and by the text that Eva heard. */
export class RecordingShelf {
  private readonly urls = new Map<string, string>();
  private readonly release: (url: string) => void;

  constructor(release: (url: string) => void) {
    this.release = release;
  }

  keep(sessionId: string, text: string, url: string): void {
    const key = shelfKey(sessionId, text);
    const old = this.urls.get(key);
    if (old !== undefined && old !== url) this.release(old);
    this.urls.delete(key);
    this.urls.set(key, url);
    for (const [oldest, oldUrl] of this.urls) {
      if (this.urls.size <= keptRecordings) break;
      this.urls.delete(oldest);
      this.release(oldUrl);
    }
  }

  /** The recording of a message, or null when the person typed it or the tab forgot it. */
  find(sessionId: string, text: string): string | null {
    return this.urls.get(shelfKey(sessionId, text)) ?? null;
  }
}

function shelfKey(sessionId: string, text: string): string {
  return `${sessionId}\n${text}`;
}
