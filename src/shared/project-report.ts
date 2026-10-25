/**
 * The result of project work. Eva sends the result of a Project chat back to the Assistant chat
 * that gave the work. Each front end shows it as the Project side's own message, with these words.
 */

/** The facts of one result. The session store keeps them, so their names are a schema. */
export interface ProjectReport {
  readonly projectId: string;
  readonly projectTitle: string;
  /** The Project chat that did the work. */
  readonly projectSessionId: string;
  readonly request: string;
  readonly clone: string;
  readonly repositories: {
    readonly name: string;
    readonly branch: string | null;
    readonly pullRequest: number | null;
  }[];
  readonly failed: boolean;
  /** The end of the last answer of the Project chat, or the failure reason. */
  readonly result: string;
  /** The answer was longer, so `result` holds only its end. */
  readonly resultCut: boolean;
}

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

/** The first paragraph of the result, short enough for a card. The person can open the whole result. */
export function reportPreview(report: ProjectReport): string {
  const first = report.result.split(/\n\s*\n/).find((paragraph) => paragraph.trim() !== "") ?? "";
  const line = first.replace(/\s+/g, " ").trim();
  const cut = line.length > previewLength ? `${line.slice(0, previewLength).trimEnd()}…` : line;
  // A cut result keeps only its end, so its first paragraph starts in the middle of the answer.
  return report.resultCut ? `…${cut}` : cut;
}
