/**
 * The setup report of a project repository: how ready it is for autonomous agent work,
 * compared with Eva's own repository, the reference. This part is pure: it judges facts
 * that `repository-facts.ts` reads from GitHub.
 */
import { checksOf, type CheckKind } from "./repository-checks.ts";

/** Green: done. Yellow: partly done. Red: missing. Grey: Eva cannot read it, or it does not apply. */
export type SetupLight = "green" | "yellow" | "red" | "grey";

export interface SetupItem {
  readonly label: string;
  readonly light: SetupLight;
  readonly detail: string;
  /** A request for a coding agent that runs on the repository, or steps for the person. Null when green. */
  readonly fixRequest: string | null;
}

export interface SetupSection {
  readonly title: string;
  readonly items: readonly SetupItem[];
  /** The share of green items, in percent, without the grey ones. Null: no score, or nothing to count. */
  readonly score: number | null;
}

export interface SetupReport {
  readonly repositoryUrl: string;
  readonly slug: string | null;
  readonly sections: readonly SetupSection[];
  /** Every fix request that a coding agent can do, as one request. Null: nothing to fix. */
  readonly allFixes: string | null;
  /** Why there is no report, such as a URL that is not on GitHub. */
  readonly problem: string | null;
}

export interface WorkflowFacts {
  readonly path: string;
  readonly runsOnPullRequest: boolean;
  readonly usesCodeql: boolean;
  /** The `run` text or the `uses` action of each step, in each job. */
  readonly commands: readonly string[];
}

/** The commands that the git hooks run before a commit and before a push. */
export interface HookFacts {
  readonly commit: readonly string[];
  readonly push: readonly string[];
}

/** What Eva read from GitHub about one repository. Null: Eva could not read that fact. */
export interface RepositoryFacts {
  readonly slug: string;
  readonly defaultBranch: string;
  readonly isPrivate: boolean;
  readonly isArchived: boolean;
  readonly isAdmin: boolean;
  readonly allowAutoMerge: boolean | null;
  readonly allowUpdateBranch: boolean | null;
  readonly deleteBranchOnMerge: boolean | null;
  /** Each file path of the default branch, and its blob SHA. */
  readonly files: Readonly<Record<string, string>> | null;
  readonly workflows: readonly WorkflowFacts[] | null;
  /** The `scripts` of the root `package.json`, which CI and hooks often call. Empty when it has none. */
  readonly scripts: Readonly<Record<string, string>> | null;
  readonly hooks: HookFacts | null;
  readonly labels: readonly string[] | null;
  /** The `permissions.allow` rules of `.claude/settings.json`, or "none" when it has none. */
  readonly allowRules: readonly string[] | "none" | null;
  readonly requiredChecks: boolean | null;
  readonly privateVulnerabilityReporting: boolean | null;
  readonly dependabotAlerts: boolean | null;
  /** Whether GitHub finds a security policy, such as a `SECURITY.md`. */
  readonly securityPolicy: boolean | null;
  readonly dependabotSecurityUpdates: boolean | null;
  readonly secretScanning: boolean | null;
  readonly pushProtection: boolean | null;
  readonly codeScanningDefaultSetup: boolean | null;
  readonly readOnlyWorkflowToken: boolean | null;
}

const harnessOnlyRuleFiles = [
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
  "GEMINI.md",
  ".github/copilot-instructions.md",
];
const harnessOnlyRuleFolders = [".cursor/rules/"];
const claudeOnlyFolders = [".claude/skills/", ".claude/commands/", ".claude/agents/"];
const hookFilePattern = /^(?:\.?lefthook\.(?:ya?ml|json|jsonc|toml)|\.pre-commit-config\.yaml)$/;

/**
 * Shell programs whose rules fit any project. The reference's other shell rules, such as
 * `bun run *`, belong to its own stack, so other repositories do not need them.
 */
const stackNeutralPrograms = new Set(["ls", "cat", "head", "tail", "wc", "grep", "git", "gh"]);

const needsAdmin = "Eva needs admin rights on this repository to read this.";
const notRead = "Eva could not read this from GitHub.";
const filesUnknown = "Eva could not read the files from GitHub.";
const packageUnknown = "Eva could not read package.json from GitHub.";
/** The last step of each fix request. "Copy all fixes" asks for one pull request instead. */
const pullRequestStep = " Then open a pull request.";

export function evaluateSetup(reference: RepositoryFacts, target: RepositoryFacts): SetupReport {
  const context = new Context(reference, target);
  const harness = harnessItems(context);
  const sections: SetupSection[] = [
    { title: "Development", items: developmentItems(context), score: null },
    { title: "Pull requests", items: pullRequestItems(context), score: null },
    { title: "Harness agnostic", items: harness, score: scoreOf(harness) },
    { title: "Agent permissions", items: [permissionItem(context)], score: null },
    { title: "Security", items: securityItems(context), score: null },
  ];
  return {
    repositoryUrl: `https://github.com/${target.slug}`,
    slug: target.slug,
    sections,
    allFixes: joinFixes(target.slug, sections),
    problem: null,
  };
}

/** A report with no sections, for a repository that Eva cannot check. */
export function unreadableReport(repositoryUrl: string, slug: string | null, problem: string): SetupReport {
  return { repositoryUrl, slug, sections: [], allFixes: null, problem };
}

/** One request for every fix of the red and yellow items. A grey item's steps are for the person. */
function joinFixes(slug: string, sections: readonly SetupSection[]): string | null {
  const fixes = sections.flatMap((section) =>
    section.items.flatMap((item) =>
      item.light === "grey" || item.fixRequest === null ? [] : [item.fixRequest.replace(pullRequestStep, "")],
    ),
  );
  if (fixes.length === 0) return null;
  return `In ${slug}, make each change below. Open one pull request for all the file changes. A command that changes a GitHub setting needs no pull request.\n\n${fixes.map((fix) => `- ${fix}`).join("\n")}`;
}

class Context {
  readonly reference: RepositoryFacts;
  readonly target: RepositoryFacts;

  constructor(reference: RepositoryFacts, target: RepositoryFacts) {
    this.reference = reference;
    this.target = target;
  }

  /** A link to a path of the reference's default branch. */
  referenceLink(kind: "tree" | "blob", path: string): string {
    return `https://github.com/${this.reference.slug}/${kind}/${this.reference.defaultBranch}/${path}`;
  }

  /** Why a fact that needs admin rights or a public repository is unknown. */
  unknownReason(publicOnly: boolean): string {
    if (publicOnly && this.target.isPrivate) return "GitHub does not offer this free on a private repository.";
    return this.target.isAdmin ? notRead : needsAdmin;
  }

  /** A command that needs admin rights, as a fix request. */
  adminCommand(command: string, what: string): string {
    return `In ${this.target.slug}, ${what}. Run \`${command}\`. It needs admin rights on the repository.`;
  }
}

function developmentItems(context: Context): SetupItem[] {
  return [...skillItems(context), labelItem(context), hookItem(context)];
}

function skillItems(context: Context): SetupItem[] {
  const referenceFiles = context.reference.files ?? {};
  const names = [...new Set(Object.keys(referenceFiles).flatMap((path) => skillName(path) ?? []))].sort();
  return names.map((name): SetupItem => {
    const label = `Skill ${name}`;
    const files = context.target.files;
    if (files === null) return grey(label, filesUnknown);
    const link = context.referenceLink("tree", `.agents/skills/${name}`);
    const wanted = filesUnder(referenceFiles, `.agents/skills/${name}/`);
    const present = filesUnder(files, `.agents/skills/${name}/`);
    if (present.size > 0) {
      if (sameFiles(wanted, present)) return green(label, "Up to date.");
      return {
        label,
        light: "yellow",
        detail: "Outdated.",
        fixRequest: `In ${context.target.slug}, make \`.agents/skills/${name}/\` an exact copy of ${link}. Put rules that fit only this project in \`AGENTS.md\` instead.${pullRequestStep}`,
      };
    }
    const where = `.claude/skills/${name}/`;
    if (filesUnder(files, where).size > 0) {
      return {
        label,
        light: "yellow",
        detail: `Only in ${where}, which only Claude Code reads.`,
        fixRequest: `In ${context.target.slug}, move \`${where}\` to \`.agents/skills/${name}/\`, and make it an exact copy of ${link}.${pullRequestStep}`,
      };
    }
    return {
      label,
      light: "red",
      detail: "Missing.",
      fixRequest: `In ${context.target.slug}, add the skill \`${name}\`: copy ${link} to \`.agents/skills/${name}/\`. Add a line to \`AGENTS.md\` that tells agents when to use it.${pullRequestStep}`,
    };
  });
}

function labelItem(context: Context): SetupItem {
  const label = "Labels";
  const wanted = context.reference.labels ?? [];
  const present = context.target.labels;
  if (present === null) return grey(label, notRead);
  const have = new Set(present.map((name) => name.toLowerCase()));
  const missing = wanted.filter((name) => !have.has(name.toLowerCase()));
  // Only names that equal a known default go into the command, so a label name never injects shell text.
  const defaults = present.filter((name) => githubDefaultLabels.has(name.toLowerCase()));
  if (missing.length === 0 && defaults.length === 0) return green(label, "Has every standard label.");
  const slug = context.target.slug;
  const add =
    missing.length === 0
      ? ""
      : `Add the missing labels: ${missing.join(", ")}. Run \`gh label clone ${context.reference.slug} --repo ${slug}\`. It adds them and keeps the labels that exist. `;
  const remove =
    defaults.length === 0
      ? ""
      : `Delete the GitHub default labels, which agents do not use: ${defaults.map((name) => `\`gh label delete "${name}" --repo ${slug} --yes\``).join(", ")}.`;
  return {
    label,
    light: missing.length > 0 && missing.length === wanted.length ? "red" : "yellow",
    detail: [
      missing.length === 0 ? "" : `Missing: ${missing.join(", ")}.`,
      defaults.length === 0 ? "" : `GitHub default labels: ${defaults.join(", ")}.`,
    ]
      .filter((part) => part !== "")
      .join(" "),
    fixRequest: `In ${slug}: ${add}${remove}`.trim(),
  };
}

/** The labels that GitHub adds to each new repository. */
const githubDefaultLabels = new Set([
  "bug",
  "documentation",
  "duplicate",
  "enhancement",
  "good first issue",
  "help wanted",
  "invalid",
  "question",
  "wontfix",
]);

function hookItem(context: Context): SetupItem {
  const label = "Git hooks";
  const files = context.target.files;
  if (files === null) return grey(label, filesUnknown);
  const paths = Object.keys(files);
  const example = context.referenceLink("blob", "lefthook.yml");
  if (!paths.some((path) => hookFilePattern.test(path) || path.startsWith(".husky/"))) {
    return {
      label,
      light: "red",
      detail: "No Lefthook, Husky or pre-commit setup.",
      fixRequest: `In ${context.target.slug}, add git hooks that run the format, lint and test checks before each push. Use Lefthook, as ${example} does.${pullRequestStep}`,
    };
  }
  const hooks = context.target.hooks;
  if (hooks === null) {
    return grey(label, "Eva could not read the hook config. She reads Lefthook YAML or JSON, Husky and pre-commit.");
  }
  const scripts = context.target.scripts ?? {};
  const stages = [
    { name: "commit", checks: checksOf(hooks.commit, scripts) },
    { name: "push", checks: checksOf(hooks.push, scripts) },
  ].filter((stage) => stage.checks.size > 0);
  if (stages.length === 0) {
    // An unread package.json could hide the checks of a script that a hook calls.
    if (context.target.scripts === null) return grey(label, packageUnknown);
    return {
      label,
      light: "yellow",
      detail: "The hooks run no format check, lint or tests.",
      fixRequest: `In ${context.target.slug}, make the git hooks run the format and lint checks before each commit or push, as ${example} does.${pullRequestStep}`,
    };
  }
  return green(label, stages.map((stage) => `Before each ${stage.name}: ${checkList(stage.checks)}.`).join(" "));
}

const checkNames: Readonly<Record<CheckKind, string>> = { format: "format check", lint: "lint", test: "tests" };

function checkList(checks: ReadonlySet<CheckKind>): string {
  const names = (Object.keys(checkNames) as CheckKind[]).filter((kind) => checks.has(kind));
  return names.length === 0 ? "no format check, lint or tests" : names.map((kind) => checkNames[kind]).join(", ");
}

function pullRequestItems(context: Context): SetupItem[] {
  const { target } = context;
  return [
    ciItem(context),
    requiredChecksItem(context),
    settingItem(
      context,
      "Auto-merge",
      target.allowAutoMerge,
      "allow_auto_merge",
      "a pull request merges itself once its checks pass",
    ),
    settingItem(
      context,
      "Update branch button",
      target.allowUpdateBranch,
      "allow_update_branch",
      "a pull request can take in the latest default branch",
    ),
    settingItem(
      context,
      "Delete branch after merge",
      target.deleteBranchOnMerge,
      "delete_branch_on_merge",
      "a merged branch deletes itself",
    ),
  ];
}

function ciItem(context: Context): SetupItem {
  const label = "CI on pull requests";
  const workflows = context.target.workflows;
  if (workflows === null) return grey(label, filesUnknown);
  // A CodeQL workflow scans for vulnerabilities; it runs no project checks.
  const running = workflows.filter((workflow) => workflow.runsOnPullRequest && !workflow.usesCodeql);
  const example = context.reference.workflows?.find((workflow) => workflow.runsOnPullRequest && !workflow.usesCodeql);
  const exampleText = example === undefined ? "" : ` Use ${context.referenceLink("blob", example.path)} as an example.`;
  if (running.length > 0) {
    const checks = checksOf(
      running.flatMap((workflow) => workflow.commands),
      context.target.scripts ?? {},
    );
    const runs = `Runs ${running.map((workflow) => workflow.path).join(", ")}: ${checkList(checks)}.`;
    const missing = requiredCiChecks.filter((kind) => !checks.has(kind));
    if (missing.length === 0) return green(label, runs);
    // An unread package.json could hide the checks of a script that CI calls.
    if (context.target.scripts === null) return grey(label, packageUnknown);
    return {
      label,
      light: "yellow",
      detail: checks.size === 0 ? runs : `${runs} No ${missing.map((kind) => checkNames[kind]).join(" or ")}.`,
      fixRequest: `In ${context.target.slug}, make the pull-request CI run the lint and the tests. Each step calls the tool, such as \`eslint\` or \`pytest\`, or a package script that calls it.${exampleText}${pullRequestStep}`,
    };
  }
  return {
    label,
    light: "red",
    detail: "No workflow runs on pull requests.",
    fixRequest: `In ${context.target.slug}, add a GitHub Actions workflow that runs on each pull request. It runs the format check, the lint and the tests through one script.${exampleText}${pullRequestStep}`,
  };
}

/** The format check shows in the detail, but only a lint and tests decide the light (#91). */
const requiredCiChecks: readonly CheckKind[] = ["lint", "test"];

function requiredChecksItem(context: Context): SetupItem {
  const label = "Required checks before merge";
  const required = context.target.requiredChecks;
  if (required === true) return green(label, "GitHub blocks a merge until the checks pass.");
  if (required === null) return grey(label, notRead);
  if (context.target.isPrivate) {
    return grey(label, "GitHub enforces rulesets on private repositories only on a paid plan.");
  }
  return {
    label,
    light: "red",
    detail: "Nothing stops a merge while the checks fail.",
    fixRequest: `In ${context.target.slug}, add a branch ruleset for the default branch. It requires each CI job to pass on an up-to-date branch, and blocks force pushes and deletion. Use \`gh api repos/${context.target.slug}/rulesets --method POST\`, which needs admin rights. Or use Settings > Rules > Rulesets.`,
  };
}

function settingItem(context: Context, label: string, isOn: boolean | null, field: string, effect: string): SetupItem {
  if (isOn === true) return green(label, "On.");
  if (isOn === null) return grey(label, context.unknownReason(false));
  return {
    label,
    light: "red",
    detail: "Off.",
    fixRequest: context.adminCommand(
      `gh api -X PATCH repos/${context.target.slug} -F ${field}=true`,
      `turn on the setting so that ${effect}`,
    ),
  };
}

function harnessItems(context: Context): SetupItem[] {
  const files = context.target.files;
  const labels = ["AGENTS.md at the root", "No CLAUDE.md", "No harness-only rule files", "Skills in the open folder"];
  if (files === null) return labels.map((label) => grey(label, filesUnknown));
  const slug = context.target.slug;
  const paths = Object.keys(files);
  const agentsExample = context.referenceLink("blob", "AGENTS.md");

  const agents: SetupItem = paths.includes("AGENTS.md")
    ? green(labels[0] ?? "", "Present.")
    : {
        label: labels[0] ?? "",
        light: "red",
        detail: "Missing. Most coding harnesses read AGENTS.md.",
        fixRequest: `In ${slug}, write the agent rules in a short root \`AGENTS.md\`, as ${agentsExample} does. Move any rules from harness files into it.${pullRequestStep}`,
      };

  // Claude Code reads AGENTS.md only when no CLAUDE.md exists in the folder or above it.
  const claudeFiles = paths.filter((path) => path === "CLAUDE.md" || path.endsWith("/CLAUDE.md"));
  const claudeMd: SetupItem =
    claudeFiles.length === 0
      ? green(labels[1] ?? "", "None, so Claude Code reads AGENTS.md.")
      : {
          label: labels[1] ?? "",
          light: "red",
          detail: `Found ${claudeFiles.join(", ")}.`,
          fixRequest: `In ${slug}, move any rules of ${claudeFiles.join(", ")} into an \`AGENTS.md\` in the same folder, then delete each \`CLAUDE.md\`. Claude Code reads \`AGENTS.md\` only when no \`CLAUDE.md\` exists. Add a pre-commit hook that refuses a \`CLAUDE.md\`, as ${context.referenceLink("blob", "lefthook.yml")} does.${pullRequestStep}`,
        };

  const ruleFiles = paths.filter(
    (path) => harnessOnlyRuleFiles.includes(path) || harnessOnlyRuleFolders.some((folder) => path.startsWith(folder)),
  );
  const ruleItem: SetupItem =
    ruleFiles.length === 0
      ? green(labels[2] ?? "", "None.")
      : {
          label: labels[2] ?? "",
          light: "red",
          detail: `Found ${ruleFiles.join(", ")}.`,
          fixRequest: `In ${slug}, move the rules of ${ruleFiles.join(", ")} into \`AGENTS.md\`, then delete those files.${pullRequestStep}`,
        };

  const claudeFolders = claudeOnlyFolders.filter((folder) => paths.some((path) => path.startsWith(folder)));
  const skills: SetupItem =
    claudeFolders.length === 0
      ? green(labels[3] ?? "", "No Claude-only skills, commands or agents.")
      : {
          label: labels[3] ?? "",
          light: "yellow",
          detail: `Found ${claudeFolders.join(", ")}, which only Claude Code reads.`,
          fixRequest: `In ${slug}, turn each file in ${claudeFolders.join(", ")} into a skill in \`.agents/skills/<name>/SKILL.md\`, the open skill format. Add a line to \`AGENTS.md\` for each skill that tells agents when to use it.${pullRequestStep}`,
        };

  return [agents, claudeMd, ruleItem, skills];
}

function permissionItem(context: Context): SetupItem {
  const label = "Allowed commands";
  const referenceRules = context.reference.allowRules;
  const neutral = referenceRules === null || referenceRules === "none" ? [] : referenceRules.filter(isStackNeutral);
  const rules = context.target.allowRules;
  const settingsPath = "`.claude/settings.json`";
  if (rules === null) return grey(label, filesUnknown);
  if (rules === "none") {
    return {
      label,
      light: "red",
      detail: "No allow list, so each command asks for approval.",
      fixRequest: `In ${context.target.slug}, add ${settingsPath} with a \`permissions.allow\` list: ${neutral.join(", ")}. Add the project's own format, lint and test commands.${pullRequestStep}`,
    };
  }
  const missing = neutral.filter((rule) => !rules.some((candidate) => covers(candidate, rule)));
  if (missing.length === 0) return green(label, `Agents may run: ${rules.join(", ")}.`);
  return {
    label,
    light: "yellow",
    detail: `Missing: ${missing.join(", ")}.`,
    fixRequest: `In ${context.target.slug}, add these rules to \`permissions.allow\` in ${settingsPath}: ${missing.join(", ")}.${pullRequestStep}`,
  };
}

function securityItems(context: Context): SetupItem[] {
  const { target } = context;
  const slug = target.slug;
  const settingsPage = `https://github.com/${slug}/settings/security_analysis`;
  // The bracket form of -f works in every shell, unlike a piped JSON body.
  const securityPatch = (field: string): string =>
    `gh api -X PATCH repos/${slug} -f "security_and_analysis[${field}][status]=enabled"`;
  const codeScanning =
    target.codeScanningDefaultSetup === true || (target.workflows ?? []).some((workflow) => workflow.usesCodeql)
      ? true
      : target.codeScanningDefaultSetup;
  return [
    featureItem(
      context,
      "Private vulnerability reporting",
      target.isPrivate ? null : target.privateVulnerabilityReporting,
      true,
      context.adminCommand(
        `gh api -X PUT repos/${slug}/private-vulnerability-reporting`,
        "let people report a vulnerability in private",
      ),
    ),
    {
      ...featureItem(
        context,
        "Security policy",
        target.securityPolicy,
        false,
        `In ${slug}, add a \`SECURITY.md\` that tells people to report a vulnerability in private, not in a public issue: ${
          target.isPrivate
            ? "they contact the maintainers in private"
            : `at https://github.com/${slug}/security/advisories/new`
        }.${pullRequestStep}`,
      ),
      ...(target.securityPolicy === null
        ? {}
        : { detail: target.securityPolicy ? "Has a SECURITY.md." : "No SECURITY.md." }),
    },
    featureItem(
      context,
      "Dependabot alerts",
      target.dependabotAlerts,
      false,
      context.adminCommand(`gh api -X PUT repos/${slug}/vulnerability-alerts`, "turn on Dependabot alerts"),
    ),
    featureItem(
      context,
      "Dependabot security updates",
      target.dependabotSecurityUpdates,
      false,
      context.adminCommand(
        `gh api -X PUT repos/${slug}/automated-security-fixes`,
        "let Dependabot open pull requests that fix vulnerable dependencies",
      ),
    ),
    {
      label: "Malware alerts",
      light: "grey",
      detail: "GitHub has no API for this. Check it on the settings page.",
      fixRequest: `Open ${settingsPage} and turn on Dependabot malware alerts.`,
    },
    featureItem(
      context,
      "Secret scanning",
      target.secretScanning,
      true,
      context.adminCommand(securityPatch("secret_scanning"), "turn on secret scanning"),
    ),
    featureItem(
      context,
      "Push protection",
      target.pushProtection,
      true,
      context.adminCommand(securityPatch("secret_scanning_push_protection"), "block pushes that contain a secret"),
    ),
    featureItem(
      context,
      "Code scanning",
      codeScanning,
      true,
      context.adminCommand(
        `gh api -X PATCH repos/${slug}/code-scanning/default-setup -f state=configured`,
        "turn on CodeQL code scanning",
      ),
    ),
    featureItem(
      context,
      "Read-only workflow token",
      target.readOnlyWorkflowToken,
      false,
      context.adminCommand(
        `gh api -X PUT repos/${slug}/actions/permissions/workflow -f default_workflow_permissions=read`,
        "give workflows a read-only token by default",
      ),
    ),
  ];
}

function featureItem(
  context: Context,
  label: string,
  isOn: boolean | null,
  publicOnly: boolean,
  fixRequest: string,
): SetupItem {
  if (isOn === true) return green(label, "On.");
  if (isOn === null || (publicOnly && context.target.isPrivate)) return grey(label, context.unknownReason(publicOnly));
  return { label, light: "red", detail: "Off.", fixRequest };
}

/** `Read` or `Bash(git log*)` fits any project; `Bash(bun run *)` fits the reference's stack only. */
function isStackNeutral(rule: string): boolean {
  const command = shellCommand(rule);
  if (command === null) return true;
  return stackNeutralPrograms.has(command.split(/[\s:*]/)[0] ?? "");
}

/** True when the rule `candidate` allows at least what `rule` allows. */
function covers(candidate: string, rule: string): boolean {
  if (candidate === rule) return true;
  const tool = (text: string): string => text.split("(")[0] ?? text;
  // A bare tool name, such as `Bash` or `Read`, allows every use of that tool.
  if (!candidate.includes("(")) return candidate === tool(rule);
  const wanted = shellCommand(rule);
  const given = shellCommand(candidate);
  if (wanted === null || given === null || !wildcardEnd.test(given)) return false;
  return withoutWildcard(wanted).startsWith(withoutWildcard(given));
}

/** The end of a shell rule that allows any arguments: `git log*`, `git log *` and `git log:*`. */
const wildcardEnd = /(?::\*|\s*\*)$/;

function withoutWildcard(command: string): string {
  return command.replace(wildcardEnd, "").trimEnd();
}

function shellCommand(rule: string): string | null {
  const match = /^Bash\((.*)\)$/.exec(rule);
  return match?.[1] ?? null;
}

function skillName(path: string): string | null {
  const match = /^\.agents\/skills\/([^/]+)\//.exec(path);
  return match?.[1] ?? null;
}

function filesUnder(files: Readonly<Record<string, string>>, folder: string): Map<string, string> {
  return new Map(
    Object.entries(files)
      .filter(([path]) => path.startsWith(folder))
      .map(([path, sha]) => [path.slice(folder.length), sha]),
  );
}

function sameFiles(first: Map<string, string>, second: Map<string, string>): boolean {
  return first.size === second.size && [...first].every(([path, sha]) => second.get(path) === sha);
}

function scoreOf(items: readonly SetupItem[]): number | null {
  const counted = items.filter((entry) => entry.light !== "grey");
  if (counted.length === 0) return null;
  return Math.round((counted.filter((entry) => entry.light === "green").length / counted.length) * 100);
}

function green(label: string, detail: string): SetupItem {
  return { label, light: "green", detail, fixRequest: null };
}

function grey(label: string, detail: string): SetupItem {
  return { label, light: "grey", detail, fixRequest: null };
}
