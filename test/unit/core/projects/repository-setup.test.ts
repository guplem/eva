import { describe, expect, test } from "bun:test";
import {
  evaluateSetup,
  type RepositoryFacts,
  type SetupItem,
  type SetupReport,
} from "../../../../src/core/projects/repository-setup.ts";

/** The reference: every item is green. */
const reference: RepositoryFacts = {
  slug: "guplem/eva",
  defaultBranch: "main",
  isPrivate: false,
  isArchived: false,
  isAdmin: true,
  allowAutoMerge: true,
  allowUpdateBranch: true,
  deleteBranchOnMerge: true,
  files: {
    "AGENTS.md": "agents",
    "src/AGENTS.md": "nested",
    ".agents/skills/write-commit/SKILL.md": "commit-v2",
    ".agents/skills/rename-symbol/SKILL.md": "rename-v1",
    ".agents/skills/rename-symbol/notes.md": "notes-v1",
    "lefthook.yml": "hooks",
    ".github/workflows/checks.yml": "ci",
  },
  workflows: [{ path: ".github/workflows/checks.yml", runsOnPullRequest: true, usesCodeql: false }],
  labels: ["bug", "owner", "waiting-for-human-check"],
  allowRules: ["Read", "Grep", "Bash(git status*)", "Bash(gh pr view*)", "Bash(bun run *)"],
  requiredChecks: true,
  privateVulnerabilityReporting: true,
  dependabotAlerts: true,
  securityPolicy: true,
  dependabotSecurityUpdates: true,
  secretScanning: true,
  pushProtection: true,
  codeScanningDefaultSetup: true,
  readOnlyWorkflowToken: true,
};

function target(changes: Partial<RepositoryFacts> = {}): RepositoryFacts {
  return { ...reference, slug: "owner/example-app", ...changes };
}

function item(report: SetupReport, label: string): SetupItem {
  const found = report.sections.flatMap((section) => section.items).find((candidate) => candidate.label === label);
  if (found === undefined) throw new Error(`no item ${label}`);
  return found;
}

function lights(report: SetupReport): string[] {
  return report.sections.flatMap((section) => section.items.map((entry) => entry.light));
}

describe("evaluateSetup", () => {
  test("a repository with the reference's setup is all green, apart from malware alerts", () => {
    const report = evaluateSetup(reference, target());
    expect(report.sections.map((section) => section.title)).toEqual([
      "Development",
      "Pull requests",
      "Harness agnostic",
      "Agent permissions",
      "Security",
    ]);
    expect(item(report, "Malware alerts").light).toBe("grey");
    expect(lights(report).filter((light) => light !== "green")).toEqual(["grey"]);
    expect(report.sections.find((section) => section.title === "Harness agnostic")?.score).toBe(100);
    expect(
      report.sections
        .flatMap((section) => section.items)
        .every((entry) => entry.light !== "green" || entry.fixRequest === null),
    ).toBe(true);
  });

  test("a skill is missing, outdated, in the Claude-only folder, or up to date", () => {
    const files = {
      ...reference.files,
      ".agents/skills/write-commit/SKILL.md": "commit-v1",
      ".agents/skills/rename-symbol/SKILL.md": undefined,
      ".agents/skills/rename-symbol/notes.md": undefined,
    };
    const missing = evaluateSetup(reference, target({ files: withoutUndefined(files) }));
    expect(item(missing, "Skill write-commit")).toMatchObject({ light: "yellow", detail: "Outdated." });
    expect(item(missing, "Skill write-commit").fixRequest).toContain(
      "https://github.com/guplem/eva/tree/main/.agents/skills/write-commit",
    );
    expect(item(missing, "Skill rename-symbol")).toMatchObject({ light: "red", detail: "Missing." });
    expect(item(missing, "Skill rename-symbol").fixRequest).toContain("owner/example-app");

    const claudeOnly = evaluateSetup(
      reference,
      target({
        files: withoutUndefined({ ...files, ".claude/skills/rename-symbol/SKILL.md": "rename-v1" }),
      }),
    );
    expect(item(claudeOnly, "Skill rename-symbol").light).toBe("yellow");
    expect(item(claudeOnly, "Skill rename-symbol").detail).toContain(".claude/skills/");
  });

  test("labels: all present is green, some is yellow, none is red; case does not count", () => {
    expect(
      item(evaluateSetup(reference, target({ labels: ["BUG", "Owner", "waiting-for-human-check"] })), "Labels").light,
    ).toBe("green");
    const some = item(evaluateSetup(reference, target({ labels: ["bug"] })), "Labels");
    expect(some.light).toBe("yellow");
    expect(some.detail).toContain("owner, waiting-for-human-check");
    expect(some.fixRequest).toContain("gh label clone guplem/eva --repo owner/example-app");
    expect(item(evaluateSetup(reference, target({ labels: [] })), "Labels").light).toBe("red");
  });

  test("unreadable facts are grey, never red", () => {
    const report = evaluateSetup(
      reference,
      target({
        isAdmin: false,
        files: null,
        workflows: null,
        labels: null,
        requiredChecks: null,
        dependabotAlerts: null,
        securityPolicy: null,
        dependabotSecurityUpdates: null,
        secretScanning: null,
        pushProtection: null,
        codeScanningDefaultSetup: null,
        readOnlyWorkflowToken: null,
      }),
    );
    expect(lights(report)).not.toContain("red");
    expect(item(report, "Secret scanning").detail).toBe("Eva needs admin rights on this repository to read this.");
    expect(report.sections.find((section) => section.title === "Harness agnostic")?.score).toBeNull();
  });

  test("a private repository is grey for the features that GitHub gives free to public ones only", () => {
    const report = evaluateSetup(
      reference,
      target({ isPrivate: true, privateVulnerabilityReporting: null, secretScanning: null, requiredChecks: false }),
    );
    expect(item(report, "Private vulnerability reporting").light).toBe("grey");
    expect(item(report, "Secret scanning").detail).toContain("free on a private repository");
    expect(item(report, "Required checks before merge").light).toBe("grey");
  });

  test("pull request settings that are off are red, with the command that turns them on", () => {
    const report = evaluateSetup(
      reference,
      target({ allowAutoMerge: false, deleteBranchOnMerge: false, requiredChecks: false, workflows: [] }),
    );
    expect(item(report, "Auto-merge").light).toBe("red");
    expect(item(report, "Auto-merge").fixRequest).toContain(
      "gh api -X PATCH repos/owner/example-app -F allow_auto_merge=true",
    );
    expect(item(report, "Delete branch after merge").light).toBe("red");
    expect(item(report, "Required checks before merge").light).toBe("red");
    expect(item(report, "CI on pull requests").light).toBe("red");
    expect(item(report, "CI on pull requests").fixRequest).toContain(
      "https://github.com/guplem/eva/blob/main/.github/workflows/checks.yml",
    );
  });

  test("harness-only files and a CLAUDE.md with rules lower the harness agnostic score", () => {
    const report = evaluateSetup(
      reference,
      target({
        files: {
          "AGENTS.md": "agents",
          "CLAUDE.md": "rules",
          ".cursorrules": "x",
          ".claude/commands/deploy.md": "x",
          ".agents/skills/write-commit/SKILL.md": "commit-v2",
        },
      }),
    );
    expect(item(report, "No CLAUDE.md")).toMatchObject({ light: "red", detail: "Found CLAUDE.md." });
    expect(item(report, "No harness-only rule files")).toMatchObject({ light: "red", detail: "Found .cursorrules." });
    expect(item(report, "Skills in the open folder").light).toBe("yellow");
    expect(item(report, "AGENTS.md at the root").light).toBe("green");
    expect(report.sections.find((section) => section.title === "Harness agnostic")?.score).toBe(25);
  });

  test("any CLAUDE.md is red, a shim too: Claude Code reads AGENTS.md only when no CLAUDE.md exists", () => {
    const report = evaluateSetup(
      reference,
      target({ files: { "AGENTS.md": "agents", "src/AGENTS.md": "nested", "src/CLAUDE.md": "@AGENTS.md" } }),
    );
    const claudeMd = item(report, "No CLAUDE.md");
    expect(claudeMd).toMatchObject({ light: "red", detail: "Found src/CLAUDE.md." });
    expect(claudeMd.fixRequest).toContain("delete each `CLAUDE.md`");
    expect(claudeMd.fixRequest).toContain("https://github.com/guplem/eva/blob/main/lefthook.yml");
    expect(item(evaluateSetup(reference, target({ files: {} })), "AGENTS.md at the root").light).toBe("red");
  });

  test("permissions compare only the reference's stack-neutral rules, and a broader rule covers a narrow one", () => {
    const covered = item(
      evaluateSetup(reference, target({ allowRules: ["Read", "Grep", "Bash(git *)", "Bash(gh:*)"] })),
      "Allowed commands",
    );
    expect(covered.light).toBe("green");
    expect(covered.detail).toContain("Bash(git *)");

    const partial = item(
      evaluateSetup(reference, target({ allowRules: ["Read", "Bash(npm test)"] })),
      "Allowed commands",
    );
    expect(partial.light).toBe("yellow");
    expect(partial.detail).toContain("Grep, Bash(git status*), Bash(gh pr view*)");
    expect(partial.detail).not.toContain("bun run");

    expect(item(evaluateSetup(reference, target({ allowRules: "none" })), "Allowed commands").light).toBe("red");
    expect(item(evaluateSetup(reference, target({ allowRules: null })), "Allowed commands").light).toBe("grey");
    const spaced = ["Read", "Grep", "Bash(git status *)", "Bash(gh pr view:*)"];
    expect(item(evaluateSetup(reference, target({ allowRules: spaced })), "Allowed commands").light).toBe("green");
    const narrower = item(
      evaluateSetup(reference, target({ allowRules: ["Read", "Grep", "Bash(git status)"] })),
      "Allowed commands",
    );
    expect(narrower.detail).toContain("Bash(git status*)");
    expect(
      item(evaluateSetup(reference, target({ allowRules: ["Bash", "Read", "Grep"] })), "Allowed commands").light,
    ).toBe("green");
  });

  test("security features that are off are red; a CodeQL workflow counts as code scanning", () => {
    const report = evaluateSetup(
      reference,
      target({
        dependabotAlerts: false,
        readOnlyWorkflowToken: false,
        codeScanningDefaultSetup: false,
        workflows: [{ path: ".github/workflows/codeql.yml", runsOnPullRequest: true, usesCodeql: true }],
      }),
    );
    expect(item(report, "Dependabot alerts").light).toBe("red");
    expect(item(report, "Read-only workflow token").light).toBe("red");
    expect(item(report, "Code scanning").light).toBe("green");
    expect(item(report, "Malware alerts").fixRequest).toContain(
      "https://github.com/owner/example-app/settings/security_analysis",
    );
  });
});

function withoutUndefined(files: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

describe("evaluateSetup, edge cases", () => {
  test("unread files leave the CLAUDE.md item grey, not a false green", () => {
    const report = evaluateSetup(reference, target({ files: null }));
    expect(item(report, "No CLAUDE.md").light).toBe("grey");
  });

  test("a CodeQL workflow alone is not CI, and any Lefthook config counts as hooks", () => {
    const report = evaluateSetup(
      reference,
      target({
        files: withoutUndefined({ ...reference.files, "lefthook.yml": undefined, "lefthook.json": "hooks" }),
        workflows: [{ path: ".github/workflows/codeql.yml", runsOnPullRequest: true, usesCodeql: true }],
      }),
    );
    expect(item(report, "CI on pull requests").light).toBe("red");
    expect(item(report, "Git hooks").light).toBe("green");
  });

  test("a secret scanning fix uses a command that works in every shell", () => {
    const report = evaluateSetup(reference, target({ secretScanning: false }));
    expect(item(report, "Secret scanning").fixRequest).toContain(
      'gh api -X PATCH repos/owner/example-app -f "security_and_analysis[secret_scanning][status]=enabled"',
    );
  });

  test("an outdated skill asks for an exact copy, so the fix can turn it green", () => {
    const files = { ...reference.files, ".agents/skills/write-commit/SKILL.md": "commit-v1" };
    const fix = item(evaluateSetup(reference, target({ files })), "Skill write-commit").fixRequest;
    expect(fix).toContain("an exact copy of");
  });

  test("all fixes join into one request with one pull request; grey items stay out", () => {
    const report = evaluateSetup(reference, target({ allowAutoMerge: false, labels: ["bug"] }));
    expect(report.allFixes).toStartWith("In owner/example-app, make each change below. Open one pull request for all");
    expect(report.allFixes).toContain(
      "- In owner/example-app, turn on the setting so that a pull request merges itself",
    );
    expect(report.allFixes).not.toContain("Then open a pull request.");
    expect(report.allFixes).not.toContain("malware");
    expect(evaluateSetup(reference, target()).allFixes).toBeNull();
  });
});

describe("evaluateSetup, security policy", () => {
  test("no security policy is red, with a request that points to private reporting", () => {
    const policy = item(evaluateSetup(reference, target({ securityPolicy: false })), "Security policy");
    expect(policy).toMatchObject({ light: "red", detail: "No SECURITY.md." });
    expect(policy.fixRequest).toContain("SECURITY.md");
    expect(policy.fixRequest).toContain("https://github.com/owner/example-app/security/advisories/new");
    expect(item(evaluateSetup(reference, target()), "Security policy").light).toBe("green");
    // A private repository has no private vulnerability reporting, so the link would lead nowhere.
    const privateFix = item(
      evaluateSetup(reference, target({ isPrivate: true, securityPolicy: false })),
      "Security policy",
    );
    expect(privateFix.fixRequest).not.toContain("advisories/new");
    expect(privateFix.fixRequest).toContain("contact the maintainers in private");
  });
});
