/**
 * The result of project work. Eva sends the result of a Project chat back to the Assistant chat
 * that gave the work. Each front end shows it as the Project side's own message, with these words.
 */
import { shownAnswerText } from "./file-markers.ts";

/** The facts of one result. The session store keeps them, so their names are a schema. */
export interface ProjectReport {
  readonly projectId: string;
  readonly projectTitle: string;
  /** The Project chat that did the work. */
  readonly projectSessionId: string;
  readonly request: string;
  /** Null for a specialist, which works in its project folder (#703). An older Eva reads only text. */
  readonly clone: string | null;
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

/** Where the work ran: the clone, then each repository with its branch and pull request, or the specialist. */
export function reportPlace(report: ProjectReport): string {
  const repositories = report.repositories.map(
    ({ name, branch, pullRequest }) =>
      `${name}${branch === null ? "" : ` on ${branch}`}${pullRequest === null ? "" : `, PR #${String(pullRequest)}`}`,
  );
  const parts = report.clone === null ? repositories : [report.clone, ...repositories];
  return parts.length === 0 ? "specialist" : parts.join(" · ");
}

/** The paragraphs of the result, without the ones that are only a heading, such as "## Summary". */
function paragraphsOf(result: string): string[] {
  return (
    result
      .split(/\n\s*\n/)
      // A heading line goes before the lines join, so the text under a heading stays.
      .map((paragraph) =>
        paragraph
          .replace(/^\s*#{1,6} .*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((paragraph) => paragraph !== "")
  );
}

/** The result as a chat shows it, with no file marker lines. */
export function reportResultText(report: ProjectReport): string {
  return shownAnswerText(report.result);
}

/** The first paragraph of the result, short enough for a card. The person can open the whole result. */
export function reportPreview(report: ProjectReport): string {
  const line = paragraphsOf(reportResultText(report))[0] ?? "";
  const cut = line.length > previewLength ? `${line.slice(0, previewLength).trimEnd()}…` : line;
  // A cut result keeps only its end, so its first paragraph starts in the middle of the answer.
  return report.resultCut ? `…${cut}` : cut;
}

/** The whole result holds more than its preview, so a card offers to show it. */
export function reportHasMore(report: ProjectReport): boolean {
  return report.resultCut || reportPreview(report) !== reportResultText(report);
}

/** The parts of a turn that say who wrote its message. */
export interface TurnWords {
  readonly userText: string;
  readonly fromEva?: boolean;
  readonly projectReports?: readonly ProjectReport[];
  readonly personText?: string | null;
}

/**
 * The person's own words in a turn, or null when Eva sent a result alone: its summary then stands
 * for the whole message. A turn that gathered a result and a message of the person keeps their words apart.
 */
export function personWords(turn: TurnWords): string | null {
  if (turn.fromEva === true && (turn.projectReports?.length ?? 0) > 0) return null;
  return turn.personText ?? turn.userText;
}

/** One line for a turn in a list, such as the branch map. */
export function turnLine(turn: TurnWords): string {
  const report = turn.projectReports?.[0];
  return personWords(turn) ?? (report === undefined ? turn.userText : reportHeadline(report));
}

/** The summary of a result in plain text, as Telegram shows it. */
export function reportText(report: ProjectReport): string {
  return `${reportHeadline(report)}\n${reportPlace(report)}\n\n${reportPreview(report)}`;
}
