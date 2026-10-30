/**
 * The widget repository type (#688): the vibe-coded standard, plus the items that only a widget
 * needs, and its setup steps. The first commit holds the template; Eva then turns on GitHub Pages,
 * the ruleset and auto-merge through the direct fixes of the report, and starts the first deploy.
 */
import { evaRepository } from "../../shared/version.ts";
import { EvaError } from "../../shared/errors.ts";
import { asRecord, textField } from "../projects/repository-facts.ts";
import { githubCall, type GithubWrite } from "../projects/repository-fixes.ts";
import type { DirectFix, RepositoryFacts, SetupItem, SetupSection } from "../projects/repository-setup.ts";
import { checkWidget, manifestPath } from "./widget-contract.ts";
import { widgetTemplate } from "./widget-template.ts";

/** The CI jobs of the template, which the ruleset requires by their names. */
export const widgetChecks = ["lint", "test"] as const;
/** The integration of GitHub Actions, so only its runs pass a required check. */
const actionsIntegration = 15368;
const deployWorkflow = "pages.yml";
const fillsScreenTest = "tests/fills-screen.spec.js";
const templateLink = `https://github.com/${evaRepository}/tree/main/templates/widget`;
const contractLink = `https://github.com/${evaRepository}/blob/main/docs/widgets.md`;
const templateCommit = "feat: start the widget from Eva's template";
/** GitHub makes the first commit of a new repository a moment after it answers. */
const firstCommitTries = 5;

/** The items that only a widget repository has, in their own section of the report. */
export function widgetSection(target: RepositoryFacts): SetupSection {
  return {
    title: "Widget",
    items: [...contractItems(target), ciItem(target), fillsScreenItem(target), pagesItem(target)],
    score: null,
  };
}

/** The ruleset of a widget: the CI checks before each merge, no force push and no delete of main. */
export function rulesetFix(slug: string): DirectFix {
  return {
    kind: "api",
    method: "POST",
    path: `repos/${slug}/rulesets`,
    body: {
      name: "Requirements for merge",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      // An admin merges a pull request that waits on a broken check; nobody pushes to main.
      bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" }],
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: false,
            required_status_checks: widgetChecks.map((context) => ({ context, integration_id: actionsIntegration })),
          },
        },
      ],
    },
    // A required check would refuse the commit of the skills, which goes straight to main.
    last: true,
  };
}

function contractItems(target: RepositoryFacts): SetupItem[] {
  const manifestLabel = "Widget manifest";
  const schemaLabel = "Data schemas";
  const files = target.widgetFiles;
  if (files === null) {
    return [
      grey(manifestLabel, "Eva could not read the files from GitHub."),
      grey(schemaLabel, "Eva could not read the files from GitHub."),
    ];
  }
  const check = checkWidget((path) => files[path] ?? null);
  const manifest: SetupItem =
    check.manifest.length === 0
      ? green(manifestLabel, `${manifestPath} follows the widget contract.`)
      : {
          label: manifestLabel,
          light: "red",
          detail: check.manifest.join(" "),
          fixRequest: `In ${target.slug}, make \`${manifestPath}\` follow the widget contract, ${contractLink}: ${check.manifest.join(" ")} Then open a pull request.`,
        };
  if (check.manifest.length > 0) return [manifest, grey(schemaLabel, `Eva checks them once ${manifestPath} is valid.`)];
  const schemas: SetupItem =
    check.schemas.length === 0
      ? green(schemaLabel, "Each schema follows the naming rules.")
      : {
          label: schemaLabel,
          light: "red",
          detail: check.schemas.join(" "),
          fixRequest: `In ${target.slug}, make each data schema follow the naming rules of ${contractLink}: ${check.schemas.join(" ")} Then open a pull request.`,
        };
  return [manifest, schemas];
}

/** The pull-request CI runs the contract check, so a pull request with a broken manifest cannot merge. */
function ciItem(target: RepositoryFacts): SetupItem {
  const label = "Widget check in CI";
  const workflows = target.workflows;
  if (workflows === null || target.scripts === null) return grey(label, "Eva could not read the files from GitHub.");
  const scripts = target.scripts;
  const runs = workflows
    .filter((workflow) => workflow.runsOnPullRequest)
    .some((workflow) => workflow.commands.some((command) => runsWidgetCheck(command, scripts, 0)));
  if (runs) return green(label, "Each pull request checks eva-widget.json and the schemas.");
  return {
    label,
    light: "red",
    detail: "No pull-request workflow runs the contract check.",
    fixRequest: `In ${target.slug}, make the pull-request CI run \`npm run check:widget\`, as ${templateLink}/.github/workflows/ci.yml does. Then open a pull request.`,
  };
}

/** A command that runs the check, by itself or through a package script, a few levels deep. */
function runsWidgetCheck(command: string, scripts: Readonly<Record<string, string>>, depth: number): boolean {
  if (/check-widget\.js|check:widget/.test(command)) return true;
  if (depth >= 3) return false;
  return Object.entries(scripts).some(
    ([name, body]) =>
      new RegExp(`(?:^|\\s)(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?${escapeRegExp(name)}(?:\\s|$)`).test(command) &&
      runsWidgetCheck(body, scripts, depth + 1),
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fillsScreenItem(target: RepositoryFacts): SetupItem {
  const label = "Test that the widget fills the screen";
  if (target.files === null) return grey(label, "Eva could not read the files from GitHub.");
  if (fillsScreenTest in target.files) return green(label, `Present: ${fillsScreenTest}.`);
  return {
    label,
    light: "red",
    detail: `No ${fillsScreenTest}.`,
    fixRequest: `In ${target.slug}, add the test ${fillsScreenTest}, as ${templateLink}/${fillsScreenTest} does: the widget fills the screen at each size, with no empty border. Then open a pull request.`,
  };
}

function pagesItem(target: RepositoryFacts): SetupItem {
  const label = "GitHub Pages";
  const deploys = (target.workflows ?? []).find((workflow) =>
    workflow.commands.some((command) => command.startsWith("actions/deploy-pages")),
  );
  const call = (method: "POST" | "PUT"): DirectFix => ({
    kind: "api",
    method,
    path: `repos/${target.slug}/pages`,
    body: { build_type: "workflow" },
  });
  if (target.pages === null) return grey(label, "Eva could not read this from GitHub.");
  if (target.pages === "off" && target.isPrivate) {
    return grey(label, "GitHub offers Pages on a private repository only on a paid plan.");
  }
  if (target.pages === "off") {
    return {
      label,
      light: "red",
      detail: "Off, so the widget has no demo.",
      fixRequest: `In ${target.slug}, turn on GitHub Pages from a workflow. Run \`gh api -X POST repos/${target.slug}/pages -f build_type=workflow\`. It needs admin rights on the repository.`,
      directFix: call("POST"),
    };
  }
  if (target.pages === "branch") {
    return {
      label,
      light: "yellow",
      detail: "Pages builds from a branch, not from the deploy workflow.",
      fixRequest: `In ${target.slug}, make GitHub Pages build from a workflow. Run \`gh api -X PUT repos/${target.slug}/pages -f build_type=workflow\`. It needs admin rights on the repository.`,
      directFix: call("PUT"),
    };
  }
  if (target.workflows === null) return grey(label, "Eva could not read the files from GitHub.");
  if (deploys === undefined) {
    return {
      label,
      light: "yellow",
      detail: "On, but no workflow deploys the demo.",
      fixRequest: `In ${target.slug}, add a workflow that deploys the demo to GitHub Pages after each push to main, as ${templateLink}/.github/workflows/${deployWorkflow} does. Then open a pull request.`,
    };
  }
  return green(label, `On. ${deploys.path} deploys the demo.`);
}

/**
 * The first commit of a new widget repository: every file of the template, on top of GitHub's
 * first commit. The Git Data API refuses an empty repository, so the repository has that commit.
 */
export async function pushWidgetTemplate(
  slug: string,
  write: GithubWrite,
  title: string,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => Bun.sleep(milliseconds),
): Promise<void> {
  const [owner = "", repository = ""] = slug.split("/");
  const files = widgetTemplate({ owner, repository, title });
  const branch = textField(await githubCall(write, "GET", `repos/${slug}`), "default_branch") ?? "main";
  const address = `repos/${slug}/git`;
  const head = await firstCommit(write, `${address}/ref/heads/${encodeURIComponent(branch)}`, wait);
  const base = textField(asRecord(await githubCall(write, "GET", `${address}/commits/${head}`))?.["tree"], "sha");
  if (base === null) throw unreadable();
  // Each entry carries its text, so the whole template is one tree call.
  const tree = Object.entries(files).map(([path, content]) => ({ path, mode: "100644", type: "blob", content }));
  const treeSha = textField(await githubCall(write, "POST", `${address}/trees`, { base_tree: base, tree }), "sha");
  if (treeSha === null) throw unreadable();
  const commit = textField(
    await githubCall(write, "POST", `${address}/commits`, { message: templateCommit, tree: treeSha, parents: [head] }),
    "sha",
  );
  if (commit === null) throw unreadable();
  await githubCall(write, "PATCH", `${address}/refs/heads/${encodeURIComponent(branch)}`, { sha: commit });
}

async function firstCommit(
  write: GithubWrite,
  path: string,
  wait: (milliseconds: number) => Promise<void>,
): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const sha = textField(asRecord(await githubCall(write, "GET", path))?.["object"], "sha");
      if (sha !== null) return sha;
    } catch (error) {
      if (attempt >= firstCommitTries) throw error;
    }
    if (attempt >= firstCommitTries) throw unreadable();
    await wait(1_000);
  }
}

/** Starts the first deploy of the demo. Pages must be on first, so this runs after the fixes. */
export async function startFirstDeploy(slug: string, write: GithubWrite): Promise<void> {
  const branch = textField(await githubCall(write, "GET", `repos/${slug}`), "default_branch") ?? "main";
  await githubCall(write, "POST", `repos/${slug}/actions/workflows/${deployWorkflow}/dispatches`, { ref: branch });
}

/** The request of the chat that opens after the setup: the person describes the widget. */
export function describeWidgetRequest(slug: string): string {
  const [, repository = slug] = slug.split("/");
  return [
    `This project is a new widget for Eva's home page, in https://github.com/${slug}. Eva made the repository from her widget template, so it already holds a small habits widget, its tests, its CI and its GitHub Pages demo.`,
    `First read \`${repository}/AGENTS.md\` and the widget contract, ${contractLink}.`,
    "Then ask the person what the widget must do: what it shows, which data of the vault it reads or writes, and which size fits it. Wait for the answer.",
    `Then turn the template into that widget, with \`${repository}/.agents/skills/widget-change/SKILL.md\`.`,
  ].join("\n\n");
}

/** The line of the project's `AGENTS.md`: the agent starts above the repository, so it does not read its rules. */
export function widgetProjectNote(repositoryUrl: string): string {
  const name =
    repositoryUrl
      .replace(/\.git$/, "")
      .split("/")
      .pop() ?? "the repository";
  return `- This project is a widget for Eva's home page. Before any work, read \`${name}/AGENTS.md\` in the clone.`;
}

function green(label: string, detail: string): SetupItem {
  return { label, light: "green", detail, fixRequest: null };
}

function grey(label: string, detail: string): SetupItem {
  return { label, light: "grey", detail, fixRequest: null };
}

function unreadable(): EvaError {
  return new EvaError("github_failed", "GitHub sent an answer that Eva cannot read.");
}
