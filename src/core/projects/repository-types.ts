/**
 * The types of a project repository (#681). A type is the one source for both the setup that Eva
 * applies to a new repository and the items of its setup report: the setup runs each fix of the
 * report. Add a type here, such as a template, to add it to the form and the report.
 */
import { evaRepository } from "../../shared/version.ts";
import type { RepositoryVisibility } from "../vault/github-repositories.ts";
import {
  basicSections,
  setupReport,
  unreadableReport,
  vibeCodedSections,
  type RepositoryFacts,
  type SetupReport,
} from "./repository-setup.ts";

/** A stored name: the values of `repo_types` in a project's front matter. */
export type RepositoryTypeName = "standard" | "vibe-coded";

export interface RepositoryType {
  readonly name: RepositoryTypeName;
  readonly label: string;
  /** One sentence for the form. */
  readonly description: string;
  /** The visibility that the form picks when the person picks this type. */
  readonly defaultVisibility: RepositoryVisibility;
  /** The form shows the type as unavailable, with the reason, when Eva has no GitHub login. */
  readonly needsGithubLogin: boolean;
  /** The repository that the report compares with, such as Eva's own, or null. */
  readonly reference: string | null;
  /** The report of a repository of this type. `reference` holds the facts of `reference`, or null. */
  readonly report: (target: RepositoryFacts, reference: RepositoryFacts | null) => SetupReport;
}

export const repositoryTypes: readonly RepositoryType[] = [
  {
    name: "standard",
    label: "Standard",
    description: "A first commit, and the security items that GitHub offers.",
    defaultVisibility: "private",
    needsGithubLogin: true,
    reference: null,
    report: (target) => setupReport("standard", target, basicSections(target)),
  },
  {
    name: "vibe-coded",
    label: "Vibe-coded",
    description: "The full vibe-coded standard, so coding agents can develop it on their own.",
    defaultVisibility: "private",
    needsGithubLogin: true,
    reference: evaRepository,
    report: (target, reference) =>
      reference === null
        ? unreadableReport(
            `https://github.com/${target.slug}`,
            target.slug,
            `Eva could not read her reference repository, ${evaRepository}. Try again later.`,
            "vibe-coded",
          )
        : setupReport("vibe-coded", target, vibeCodedSections(reference, target)),
  },
];

/** The type of this name, or null for a missing or unknown name. */
export function repositoryTypeOf(name: string | undefined): RepositoryType | null {
  return repositoryTypes.find((type) => type.name === name) ?? null;
}
