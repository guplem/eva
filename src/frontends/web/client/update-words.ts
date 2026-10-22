/** The words and the face of the Updates page, apart from the components so that unit tests reach them. */
import { downloadShare } from "../../cli/client.ts";
import type { UpdateStatus } from "./api.ts";
import { chatGroup, chatTime } from "./chat-list.ts";
import { stateFaces, type Face } from "./visor-faces.ts";

/** One row of the version list. */
export interface VersionRow {
  readonly version: string;
  /** When GitHub published it, or "" when unknown. */
  readonly day: string;
  readonly headline: string;
  readonly installed: boolean;
}

/**
 * What a restart does to the chats. Eva installs only when no chat runs a turn, and the
 * supervisor starts the new copy at once. Each chat continues its engine session after it.
 */
export const restartNote =
  "Eva installs it when no chat runs, then restarts in a few seconds. Your chats stay as they are.";

/** "Today", the weekday this week, or the date, as in the chat list. */
export function releaseDay(publishedAt: string | null, now: Date): string {
  if (publishedAt === null) return "";
  const at = new Date(publishedAt);
  if (Number.isNaN(at.getTime())) return "";
  return chatGroup(at, now) === "Today" ? "Today" : chatTime(at, now);
}

/** The newer releases, newest first, then the installed version. */
export function versionRows(update: UpdateStatus, now: Date): VersionRow[] {
  const newer = update.releases.map((release) => ({
    version: release.version,
    day: releaseDay(release.publishedAt, now),
    headline: release.headline ?? "No listed changes.",
    installed: false,
  }));
  if (update.current === null) return newer;
  return [...newer, { version: update.current, day: "", headline: "This version runs now.", installed: true }];
}

/**
 * The newest release that is newer than this Eva, for the Versions card, or null. A source
 * checkout follows the main branch, so it has no release to name.
 */
export function evaNewest(update: UpdateStatus | null): string | null {
  return update?.releases[0]?.version ?? null;
}

export function installLabel(version: string): string {
  return `Update to v${version} and restart`;
}

/** Happy once the new Eva answers, surprised while a version waits. */
export function updatesFace(update: UpdateStatus | null, restarted: boolean): Face {
  if (restarted) return stateFaces.greeting;
  if (update !== null && update.available && update.lastError === null) return stateFaces.news;
  return stateFaces.idle;
}

/** The wait of the Eva updates card: its sentence and the share done, or null when nothing runs. */
export function updateWait(
  update: UpdateStatus | null,
  work: string | null,
): { readonly label: string; readonly share: number | null } | null {
  // The phase comes first: it also shows an install that Eva started by herself.
  if (update?.phase === "updating")
    return {
      label: `Installing ${update.target ?? update.latest ?? "the new version"}…`,
      share: downloadShare(update.download),
    };
  if (update?.phase === "checking") return { label: work ?? "Looking for a new version…", share: null };
  return work === null ? null : { label: work, share: null };
}
