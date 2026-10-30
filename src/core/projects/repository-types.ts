/**
 * The types of a project repository (#681). A type is the one source for both the setup that Eva
 * applies to a new repository and the items of its setup report: the setup runs each fix of the
 * report. Add a type here and in `repository-catalog.ts`, such as a template, to add it to the
 * form and the report.
 */
import { evaRepository } from "../../shared/version.ts";
import { repositoryCatalog, type RepositoryTypeInfo, type RepositoryTypeName } from "./repository-catalog.ts";
import type { GithubWrite } from "./repository-fixes.ts";
import {
  basicSections,
  setupReport,
  unreadableReport,
  vibeCodedSections,
  type RepositoryFacts,
  type SetupReport,
} from "./repository-setup.ts";

export type { RepositoryTypeName } from "./repository-catalog.ts";

export interface RepositoryType extends RepositoryTypeInfo {
  /** The repository that the report compares with, such as Eva's own, or null. */
  readonly reference: string | null;
  /** The report of a repository of this type. `reference` holds the facts of `reference`, or null. */
  readonly report: (target: RepositoryFacts, reference: RepositoryFacts | null) => SetupReport;
  /**
   * A first step after GitHub creates the repository, before the fixes of the report, such as a
   * push of a template. None for a type that starts from GitHub's first commit.
   */
  readonly afterCreate?: (slug: string, write: GithubWrite) => Promise<void>;
}

type TypeSteps = Omit<RepositoryType, keyof RepositoryTypeInfo>;

const steps: Readonly<Record<RepositoryTypeName, TypeSteps>> = {
  standard: {
    reference: null,
    report: (target) => setupReport("standard", target, basicSections(target)),
  },
  "vibe-coded": {
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
};

export const repositoryTypes: readonly RepositoryType[] = repositoryCatalog.map((info) => ({
  ...info,
  ...steps[info.name],
}));

/** The type of this name, or null for a missing or unknown name. */
export function repositoryTypeOf(name: string | undefined): RepositoryType | null {
  return repositoryTypes.find((type) => type.name === name) ?? null;
}
