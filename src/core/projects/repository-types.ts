/**
 * The types of a project repository (#681). A type is the one source for both the setup that Eva
 * applies to a new repository and the items of its setup report: the setup runs each fix of the
 * report. Add a type here and in `repository-catalog.ts`, such as a template, to add it to the
 * form and the report.
 */
import { evaRepository } from "../../shared/version.ts";
import {
  describeWidgetRequest,
  pushWidgetTemplate,
  rulesetFix,
  startFirstDeploy,
  widgetProjectNote,
  widgetSection,
} from "../widgets/widget-setup.ts";
import { repositoryCatalog, type RepositoryTypeInfo, type RepositoryTypeName } from "./repository-catalog.ts";
import type { GithubWrite } from "./repository-fixes.ts";
import {
  basicSections,
  setupReport,
  unreadableReport,
  vibeCodedSections,
  type RepositoryFacts,
  type SetupReport,
  type SetupSection,
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
  readonly afterCreate?: (slug: string, write: GithubWrite, project: { readonly title: string }) => Promise<void>;
  /** A last step after the fixes of the report, such as the first deploy of a demo. */
  readonly afterFixes?: (slug: string, write: GithubWrite) => Promise<void>;
  /**
   * The request of the chat that opens after the setup, instead of the setup chat, such as a chat
   * where the person describes a widget. None: only the items that need a chat open one.
   */
  readonly firstChat?: (slug: string) => string;
  /** A line for the body of the project's `AGENTS.md`, about the repository at this address. */
  readonly projectNote?: (repositoryUrl: string) => string;
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
  widget: {
    reference: evaRepository,
    report: (target, reference) =>
      reference === null
        ? unreadableReport(
            `https://github.com/${target.slug}`,
            target.slug,
            `Eva could not read her reference repository, ${evaRepository}. Try again later.`,
            "widget",
          )
        : setupReport("widget", target, [...widgetStandardSections(reference, target), widgetSection(target)]),
    afterCreate: (slug, write, project) => pushWidgetTemplate(slug, write, project.title),
    afterFixes: startFirstDeploy,
    firstChat: describeWidgetRequest,
    projectNote: widgetProjectNote,
  },
};

/** The vibe-coded sections. A widget knows the names of its CI checks, so Eva adds its ruleset herself. */
function widgetStandardSections(reference: RepositoryFacts, target: RepositoryFacts): SetupSection[] {
  return vibeCodedSections(reference, target).map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.label === "Required checks before merge" && item.light === "red"
        ? { ...item, directFix: rulesetFix(target.slug) }
        : item,
    ),
  }));
}

export const repositoryTypes: readonly RepositoryType[] = repositoryCatalog.map((info) => ({
  ...info,
  ...steps[info.name],
}));

/** The type of this name, or null for a missing or unknown name. */
export function repositoryTypeOf(name: string | undefined): RepositoryType | null {
  return repositoryTypes.find((type) => type.name === name) ?? null;
}
