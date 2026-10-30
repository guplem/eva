/**
 * What the form and the setup card show of each repository type (#681): data only. The web client
 * imports this file, so it imports no report logic, which would ship to the browser.
 * `repository-types.ts` gives each type its report and its setup steps.
 */
import type { RepositoryVisibility } from "../vault/github-repositories.ts";

/** A stored name: the values of `repo_types` in a project's front matter. */
export type RepositoryTypeName = "standard" | "vibe-coded";

export interface RepositoryTypeInfo {
  readonly name: RepositoryTypeName;
  readonly label: string;
  /** One sentence for the form. */
  readonly description: string;
  /** The visibility that the form picks when the person picks this type. */
  readonly defaultVisibility: RepositoryVisibility;
  /** The form shows the type as unavailable, with the reason, when Eva has no GitHub login. */
  readonly needsGithubLogin: boolean;
  /** What the form says when the person picks a private repository of this type, or null. */
  readonly privateWarning: string | null;
}

export const repositoryCatalog: readonly RepositoryTypeInfo[] = [
  {
    name: "standard",
    label: "Standard",
    description: "A first commit, and the security items that GitHub offers.",
    defaultVisibility: "private",
    needsGithubLogin: true,
    privateWarning: null,
  },
  {
    name: "vibe-coded",
    label: "Vibe-coded",
    description: "The full vibe-coded standard, so coding agents can develop it on their own.",
    defaultVisibility: "private",
    needsGithubLogin: true,
    privateWarning:
      "A private repository uses the CI minutes of your GitHub account on each pull request. GitHub enforces the merge rules and some security scans of the standard only on a paid plan.",
  },
];

/** The type of this name, or null for a missing or unknown name. */
export function repositoryTypeInfo(name: string | undefined): RepositoryTypeInfo | null {
  return repositoryCatalog.find((type) => type.name === name) ?? null;
}
