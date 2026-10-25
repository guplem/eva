/**
 * The words of a project work result card. Eva sends the result of a Project chat back to the
 * Assistant chat that gave the work, and the card shows it as the Project side's own message.
 */
import type { SessionRecord } from "./api.ts";

type ProjectReport = SessionRecord["turns"][number]["projectReports"][number];

const previewLength = 240;

export function reportHeadline(report: ProjectReport): string {
  return report.failed
    ? `The work in ${report.projectTitle} failed`
    : `Eva finished the work in ${report.projectTitle}`;
}

/** Where the work ran: the clone, then each repository with its branch and pull request. */
export function reportPlace(report: ProjectReport): string {
  const repositories = report.repositories.map(
    ({ name, branch, pullRequest }) =>
      `${name}${branch === null ? "" : ` on ${branch}`}${pullRequest === null ? "" : `, PR #${String(pullRequest)}`}`,
  );
  return [report.clone, ...repositories].join(" · ");
}

/** The first paragraph of the result, short enough for the card. The person can open the whole result. */
export function reportPreview(report: ProjectReport): string {
  const first = report.result.split(/\n\s*\n/).find((paragraph) => paragraph.trim() !== "") ?? "";
  const line = first.replace(/\s+/g, " ").trim();
  const cut = line.length > previewLength ? `${line.slice(0, previewLength).trimEnd()}…` : line;
  // A cut result keeps only its end, so its first paragraph starts in the middle of the answer.
  return report.resultCut ? `…${cut}` : cut;
}

/** Each Project chat that sent its result back, and whether its work failed. */
export function endedProjectWork(
  turns: readonly Pick<SessionRecord["turns"][number], "projectReports">[],
): Map<string, boolean> {
  return new Map(
    turns.flatMap((turn) => turn.projectReports.map((report) => [report.projectSessionId, report.failed] as const)),
  );
}
