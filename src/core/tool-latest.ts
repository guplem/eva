/**
 * The latest published version of each tool that Eva installs, so the Updates page shows an
 * Update button only for a tool that has a newer version. Each source is the one that the tool's
 * own update uses: `claude update` follows the npm tag of the person's update channel, and Eva's installs of pi, gh
 * and uv take the latest GitHub release.
 */
import { join } from "node:path";
import { readJsonTolerant } from "../shared/files.ts";

export interface LatestVersionSources {
  /** The npm registry; a test points it at a fake server. */
  readonly npmBaseUrl: string;
  /** The GitHub API; a test points it at a fake server. */
  readonly githubApiBaseUrl: string;
}

export const defaultLatestVersionSources: LatestVersionSources = {
  npmBaseUrl: "https://registry.npmjs.org",
  githubApiBaseUrl: "https://api.github.com",
};

/** The update channel of Claude Code, which is also its npm tag. */
export type ClaudeUpdateChannel = "latest" | "stable";

interface LatestSource {
  readonly url: (sources: LatestVersionSources, channel: ClaudeUpdateChannel) => string;
  readonly version: (answer: Record<string, unknown>) => unknown;
}

const githubRelease = (repository: string): LatestSource => ({
  url: (sources) => `${sources.githubApiBaseUrl}/repos/${repository}/releases/latest`,
  version: (answer) => answer["tag_name"],
});

const latestSources = {
  claude: {
    url: (sources, channel) => `${sources.npmBaseUrl}/@anthropic-ai/claude-code/${channel}`,
    version: (answer) => answer["version"],
  },
  pi: githubRelease("earendil-works/pi"),
  gh: githubRelease("cli/cli"),
  uv: githubRelease("astral-sh/uv"),
} as const satisfies Record<string, LatestSource>;

export type LatestVersionProgram = keyof typeof latestSources;

/** A slow source must not hold the Versions card for long. */
const lookupTimeoutMs = 8_000;
const versionNumber = /^\d+(?:\.\d+)+$/;

/** The latest version, such as 2.1.0, or null when the source does not answer with one. */
export async function readLatestVersion(
  program: LatestVersionProgram,
  sources: LatestVersionSources,
  channel: ClaudeUpdateChannel = "latest",
): Promise<string | null> {
  const source: LatestSource = latestSources[program];
  try {
    const response = await fetch(source.url(sources, channel), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(lookupTimeoutMs),
    });
    if (!response.ok) return null;
    const found = source.version((await response.json()) as Record<string, unknown>);
    const version = typeof found === "string" ? found.replace(/^v/, "") : "";
    return versionNumber.test(version) ? version : null;
  } catch {
    return null;
  }
}

/** The channel in Claude Code's `settings.json`, in the instance's own Claude folder. A bad file means the default. */
export function claudeUpdateChannel(claudeFolder: string): ClaudeUpdateChannel {
  const settings = readJsonTolerant(join(claudeFolder, "settings.json"));
  if (!settings.ok || typeof settings.value !== "object" || settings.value === null) return "latest";
  return (settings.value as Record<string, unknown>)["autoUpdatesChannel"] === "stable" ? "stable" : "latest";
}
