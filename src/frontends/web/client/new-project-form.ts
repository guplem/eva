/** The logic of the "New project" form, apart from its markup. */
import type { NewProjectResult } from "../../../core/projects/new-project.ts";
import { repositoryTypes, type RepositoryTypeName } from "../../../core/projects/repository-types.ts";
import type { PublicSettings } from "../../../core/settings/live-settings.ts";
import type { RepositoryVisibility } from "../../../core/vault/github-repositories.ts";

const githubLogin = "Log in to GitHub in Settings > Connections > GitHub first.";

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
    github: settings.secretsSet.githubToken ? null : githubLogin,
    drive,
  };
}

/** Why each repository type cannot be picked now, or null when it can. */
export function unavailableTypes(settings: PublicSettings): Record<RepositoryTypeName, string | null> {
  const reasons = repositoryTypes.map((type) => [
    type.name,
    type.needsGithubLogin && !settings.secretsSet.githubToken ? githubLogin : null,
  ]);
  return Object.fromEntries(reasons) as Record<RepositoryTypeName, string | null>;
}

/**
 * What the form says about a choice, only when it applies. `warning`: a cost or a limit the person
 * should know before they create it. `note`: a plain fact.
 */
export function repositoryNotes(
  type: RepositoryTypeName,
  visibility: RepositoryVisibility,
): { warning: string | null; note: string | null } {
  return {
    warning:
      type === "vibe-coded" && visibility === "private"
        ? "A private repository uses the CI minutes of your GitHub account on each pull request. GitHub enforces the merge rules and some security scans of the standard only on a paid plan."
        : null,
    note: visibility === "public" ? "Anyone can read the code of a public repository." : null,
  };
}

/** One sentence for each step that failed. The project exists all the same. */
export function stepProblems(result: NewProjectResult): string[] {
  const problems: string[] = [];
  if (result.github !== null && "problem" in result.github)
    problems.push(`Eva could not create the GitHub repository: ${result.github.problem}`);
  if (result.drive !== null && "problem" in result.drive)
    problems.push(`Eva could not create the Drive folder: ${result.drive.problem}`);
  for (const problem of result.setup?.problems ?? [])
    problems.push(`Eva could not finish the repository setup: ${problem}`);
  return problems;
}
