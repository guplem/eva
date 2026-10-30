import { describe, expect, test } from "bun:test";
import type { RepositoryFacts, SetupReport } from "../../../../src/core/projects/repository-setup.ts";
import { repositoryCatalog } from "../../../../src/core/projects/repository-catalog.ts";
import { repositoryTypeOf, repositoryTypes } from "../../../../src/core/projects/repository-types.ts";
import { evaRepository } from "../../../../src/shared/version.ts";

/** A new repository: GitHub's defaults, no files of the standard. */
const fresh: RepositoryFacts = {
  slug: "owner/example-app",
  defaultBranch: "main",
  isPrivate: false,
  isArchived: false,
  isAdmin: true,
  allowAutoMerge: false,
  allowUpdateBranch: false,
  deleteBranchOnMerge: false,
  files: { "README.md": "readme" },
  workflows: [],
  scripts: {},
  hooks: { commit: [], push: [] },
  labels: ["bug"],
  allowRules: "none",
  requiredChecks: false,
  privateVulnerabilityReporting: true,
  dependabotAlerts: true,
  securityPolicy: false,
  dependabotSecurityUpdates: true,
  secretScanning: true,
  pushProtection: true,
  codeScanningDefaultSetup: true,
  readOnlyWorkflowToken: true,
  hasCode: true,
  pages: "off",
  widgetFiles: {},
};

function report(name: string, target: RepositoryFacts, reference: RepositoryFacts | null = null): SetupReport {
  const type = repositoryTypeOf(name);
  if (type === null) throw new Error(`no type ${name}`);
  return type.report(target, reference);
}

function labels(setup: SetupReport): string[] {
  return setup.sections.flatMap((section) => section.items.map((entry) => entry.label));
}

describe("repository types", () => {
  test("standard and vibe-coded are private by default, a widget public; only standard has no reference", () => {
    expect(repositoryTypes.map((type) => [type.name, type.defaultVisibility, type.reference])).toEqual([
      ["standard", "private", null],
      ["vibe-coded", "private", evaRepository],
      ["widget", "public", evaRepository],
    ]);
    expect(repositoryTypes.every((type) => type.needsGithubLogin)).toBe(true);
    expect(repositoryTypeOf("unknown")).toBeNull();
    expect(repositoryTypeOf(undefined)).toBeNull();
  });

  test("each type of the catalog, which the web client reads, has its report, in the same order", () => {
    expect(repositoryTypes.map((type) => type.name)).toEqual(repositoryCatalog.map((type) => type.name));
    expect(repositoryTypes.every((type, index) => type.label === repositoryCatalog[index]?.label)).toBe(true);
  });

  test("standard checks only the basic security items, all green or grey on a new public repository", () => {
    const setup = report("standard", fresh);
    expect(setup.type).toBe("standard");
    expect(labels(setup)).toEqual([
      "Private vulnerability reporting",
      "Dependabot alerts",
      "Dependabot security updates",
      "Malware alerts",
      "Secret scanning",
      "Push protection",
      "Code scanning",
      "Read-only workflow token",
    ]);
    const lights = setup.sections.flatMap((section) => section.items.map((entry) => entry.light));
    expect(lights.every((light) => light === "green" || light === "grey")).toBe(true);
    expect(setup.allFixes).toBeNull();
  });

  test("code scanning does not apply to a repository with no code yet", () => {
    const setup = report("standard", { ...fresh, codeScanningDefaultSetup: false, hasCode: false });
    const item = setup.sections.flatMap((section) => section.items).find((entry) => entry.label === "Code scanning");
    expect(item).toMatchObject({
      light: "grey",
      detail: "No code to scan yet. Turn it on once the repository has code.",
    });
    expect(item?.directFix).toBeUndefined();
  });

  test("standard on a private repository shows the paid items grey, with the reason", () => {
    const setup = report("standard", {
      ...fresh,
      isPrivate: true,
      privateVulnerabilityReporting: null,
      secretScanning: null,
      pushProtection: null,
      codeScanningDefaultSetup: null,
    });
    const greys = setup.sections.flatMap((section) => section.items).filter((entry) => entry.light === "grey");
    expect(greys.map((entry) => entry.label)).toEqual([
      "Private vulnerability reporting",
      "Malware alerts",
      "Secret scanning",
      "Push protection",
      "Code scanning",
    ]);
    expect(greys[0]?.detail).toBe("GitHub does not offer this free on a private repository.");
  });

  test("vibe-coded checks the full standard against the reference, and needs the reference", () => {
    const setup = report("vibe-coded", fresh, { ...fresh, slug: evaRepository });
    expect(setup.sections.map((section) => section.title)).toEqual([
      "Development",
      "Pull requests",
      "Harness agnostic",
      "Agent permissions",
      "Security",
    ]);
    expect(labels(setup)).toContain("Security policy");
    expect(report("vibe-coded", fresh).sections).toEqual([]);
  });
});
