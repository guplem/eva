/**
 * The person's update policy: which releases Eva installs by herself. Each release is labelled by
 * its version numbers only, as the release workflow raises the major number for every break.
 */
import type { EvaConfig } from "../settings/home.ts";
import { isNewerVersion } from "./release-verification.ts";
import { noChangeNotes, releaseNoteSections } from "./release-version.ts";

/** The largest step that Eva installs by herself. */
export type UpdatePolicy = EvaConfig["updates"]["install"];

export type ReleaseLevel = "major" | "minor" | "patch";

export interface ReleaseInfo {
  /** Without a `v`, such as `1.4.2`. */
  readonly version: string;
  /** The release notes, as the release workflow writes them. */
  readonly notes: string;
}

export interface NewerRelease extends ReleaseInfo {
  /** The step from the current version to this one. */
  readonly level: ReleaseLevel;
  /** What the jump from the current version to this one brings, breaking changes first. */
  readonly summary: string;
}

export interface UpdatePick {
  /** The releases newer than the current version, newest first. */
  readonly newer: readonly NewerRelease[];
  /** The newest release that the policy installs, or null. */
  readonly install: string | null;
  /** The newest release, when the policy does not install it. */
  readonly heldBack: string | null;
}

const levelRank: Readonly<Record<ReleaseLevel, number>> = { patch: 0, minor: 1, major: 2 };

function numbers(version: string): number[] {
  return (version.replace(/^v/, "").split("-")[0] ?? "").split(".").map((part) => Number(part) || 0);
}

/** The step from one version to a newer one: the first number that changes. */
export function releaseLevel(from: string, to: string): ReleaseLevel {
  const [fromMajor = 0, fromMinor = 0] = numbers(from);
  const [toMajor = 0, toMinor = 0] = numbers(to);
  if (toMajor !== fromMajor) return "major";
  return toMinor === fromMinor ? "patch" : "minor";
}

/**
 * The release to install. `required` is the version that a vault from a newer Eva needs, or
 * "newest" when its record does not say: Eva installs at least that, whatever the policy says,
 * because she writes no vault file until she knows the vault's format (#119).
 */
export function pickUpdate(
  current: string,
  releases: readonly ReleaseInfo[],
  policy: UpdatePolicy,
  required?: string,
): UpdatePick {
  const sorted = releases
    .filter((release) => isNewerVersion(release.version, current))
    .map((release) => ({ ...release, level: releaseLevel(current, release.version) }))
    .sort((left, right) => (isNewerVersion(left.version, right.version) ? -1 : 1));
  // Sorted newest first, so the releases up to one are that one and all after it.
  const newer = sorted.map((release, index) => ({ ...release, summary: releaseSummary(sorted.slice(index)) }));
  const allowed = newer.find((release) => levelRank[release.level] <= levelRank[policy])?.version ?? null;
  const newest = newer[0]?.version ?? null;
  const install = required === undefined ? allowed : atLeast(newer, allowed, required);
  return { newer, install, heldBack: newest === install ? null : newest };
}

/** The oldest release at the required version or later, unless the policy already picks a newer one. */
function atLeast(newer: readonly NewerRelease[], allowed: string | null, required: string): string | null {
  const oldestFirst = [...newer].reverse();
  const fits =
    required === "newest"
      ? newer[0]
      : (oldestFirst.find((release) => !isNewerVersion(required, release.version)) ?? newer[0]);
  if (fits === undefined) return allowed;
  return allowed !== null && !isNewerVersion(fits.version, allowed) ? allowed : fits.version;
}

const otherTitle = releaseNoteSections.at(-1)?.title ?? "";

/**
 * One summary for a jump of several releases: every breaking change first, so that none hides
 * among the fixes. Each line names its release.
 */
export function releaseSummary(releases: readonly ReleaseInfo[]): string {
  const lines = new Map<string, string[]>(releaseNoteSections.map(({ title }) => [title, []]));
  const oldestFirst = [...releases].sort((left, right) => (isNewerVersion(left.version, right.version) ? 1 : -1));
  for (const { version, notes } of oldestFirst) {
    let title = otherTitle;
    for (const raw of notes.split(/\r?\n/)) {
      const line = raw.trim();
      const heading = /^#+\s*(.+)$/.exec(line)?.[1];
      if (heading !== undefined) {
        title = lines.has(heading) ? heading : otherTitle;
        continue;
      }
      // Release notes edited by hand on GitHub still show, under the other changes.
      const text = line.replace(/^[-*]\s+/, "");
      if (text === "" || text === noChangeNotes) continue;
      lines.get(title)?.push(`• ${text} (${version})`);
    }
  }
  const parts = [...lines]
    .filter(([, entries]) => entries.length > 0)
    .map(([title, entries]) => [`${title}:`, ...entries].join("\n"));
  return parts.length === 0 ? "No listed changes." : parts.join("\n\n");
}
