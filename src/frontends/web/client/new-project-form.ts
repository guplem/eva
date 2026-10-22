/** The logic of the "New project" form, apart from its markup. */
import type { NewProjectResult } from "../../../core/projects/new-project.ts";
import type { PublicSettings } from "../../../core/settings/live-settings.ts";

/**
 * Why each optional step cannot run now, or null when it can. The form turns a step off with
 * this reason, so the person sees what to set up first, before a send that would fail.
 */
export function unavailableSteps(settings: PublicSettings): { github: string | null; drive: string | null } {
  const google = settings.config.google;
  let drive: string | null = null;
  if (google.email === null) drive = "Log in to Google in Settings > Connections > Google first.";
  else if (!google.services.includes("drive"))
    drive = "Google Drive is off. Turn on Drive in Settings > Connections > Google.";
  else if (google.access.drive !== "full")
    drive =
      "In Settings > Connections > Google, set Google access for Drive to Read and change. Then log in to Google again.";
  return {
    github: settings.secretsSet.githubToken ? null : "Log in to GitHub in Settings > Connections > GitHub first.",
    drive,
  };
}

/** One sentence for each step that failed. The project exists all the same. */
export function stepProblems(result: NewProjectResult): string[] {
  const problems: string[] = [];
  if (result.github !== null && "problem" in result.github)
    problems.push(`Eva could not create the GitHub repository: ${result.github.problem}`);
  if (result.drive !== null && "problem" in result.drive)
    problems.push(`Eva could not create the Drive folder: ${result.drive.problem}`);
  return problems;
}
