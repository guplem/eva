/**
 * What changed in a widget between two commits (#693), for the notice of an update that waits.
 * The releases of the widget's repository come first: they are the author's own words. With no
 * release since the approved commit, the notice shows the commit subjects. Both come from the
 * GitHub API, because Eva's copy holds one commit only.
 */
import type { GithubRequest } from "../projects/repository-facts.ts";
import { oneLine } from "./widget-prompt.ts";

/** A notice stays short enough for a phone. */
const maxLines = 10;
const maxLineLength = 300;

interface Compare {
  readonly base_commit?: { readonly commit?: { readonly committer?: { readonly date?: string } } };
  readonly commits?: readonly { readonly commit?: { readonly message?: string } }[];
}

interface Release {
  readonly name?: string | null;
  readonly tag_name?: string;
  readonly body?: string | null;
  readonly draft?: boolean;
  readonly published_at?: string | null;
}

/** One line for each release since `from`, or else for each commit subject, newest first. */
export async function releaseNotes(github: GithubRequest, slug: string, from: string, to: string): Promise<string[]> {
  const compared = await github(`repos/${slug}/compare/${from}...${to}`);
  if (compared.status !== 200) return [];
  const compare = JSON.parse(compared.body) as Compare;
  const since = Date.parse(compare.base_commit?.commit?.committer?.date ?? "");
  const listed = await github(`repos/${slug}/releases?per_page=20`);
  const releases = listed.status === 200 ? (JSON.parse(listed.body) as Release[]) : [];
  const newer = releases.filter(
    (release) => release.draft !== true && Number.isFinite(since) && Date.parse(release.published_at ?? "") > since,
  );
  const lines =
    newer.length > 0
      ? newer.map((release) => {
          const title = release.name ?? release.tag_name ?? "";
          const body = oneLine(release.body ?? "").replace(/#+\s*/g, "");
          return body === "" ? title : `${title}: ${body}`;
        })
      : (compare.commits ?? [])
          .map((each) => (each.commit?.message ?? "").split("\n")[0] ?? "")
          .filter((subject) => subject !== "")
          .reverse();
  return lines.slice(0, maxLines).map((line) => short(oneLine(line)));
}

function short(line: string): string {
  return line.length <= maxLineLength ? line : `${line.slice(0, maxLineLength - 1)}…`;
}
