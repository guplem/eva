/**
 * The widget repository type (#688): the vibe-coded standard, plus the items that only a widget
 * needs, and its setup steps. The first commit holds the template; Eva then turns on GitHub Pages,
 * the ruleset and auto-merge through the direct fixes of the report, and starts the first deploy.
 */
import { evaRepository } from "../../shared/version.ts";
import { isEvaError } from "../../shared/errors.ts";
import { textField } from "../projects/repository-facts.ts";
import { branchHead, commitTree, githubCall, type GithubWrite, type TreeEntry } from "../projects/repository-fixes.ts";
import { expandedCommands } from "../projects/repository-checks.ts";
import {
  filesUnknown,
  green,
  grey,
  notRead,
  type DirectFix,
  type RepositoryFacts,
  type SetupItem,
  type SetupSection,
} from "../projects/repository-setup.ts";
import { checkWidget, manifestPath } from "./widget-contract.ts";
import { widgetTemplate } from "./widget-template.ts";

/** The CI jobs of the template, which the ruleset requires by their names. */
export const widgetChecks = ["lint", "test"] as const;
const deployWorkflow = "pages.yml";
const fillsScreenTest = "tests/fills-screen.spec.js";
const templateLink = `https://github.com/${evaRepository}/tree/main/templates/widget`;
const contractLink = `https://github.com/${evaRepository}/blob/main/docs/widgets.md`;
const templateCommit = "feat: start the widget from Eva's template";
const firstCommitTries = 5;

/** The items that only a widget repository has, in their own section of the report. */
export function widgetSection(target: RepositoryFacts): SetupSection {
  return {
    title: "Widget",
    items: [...contractItems(target), ciItem(target), fillsScreenItem(target), pagesItem(target)],
    score: null,
  };
}

function contractItems(target: RepositoryFacts): SetupItem[] {
  const manifestLabel = "Widget manifest";
  const schemaLabel = "Data schemas";
  const files = target.widgetFiles;
  if (files === null) {
    return [grey(manifestLabel, filesUnknown), grey(schemaLabel, filesUnknown)];
  }
  const check = checkWidget((path) => files[path] ?? null);
  // The widget is newer than this Eva: no agent can fix that in the repository.
  if (check.newerContract === true) {
    return [
      grey(manifestLabel, check.manifest.join(" ")),
      grey(schemaLabel, `Eva checks them once she knows the contract of ${manifestPath}.`),
    ];
  }
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
  if (workflows === null || target.scripts === null) return grey(label, filesUnknown);
  const scripts = target.scripts;
  const runs = workflows
    .filter((workflow) => workflow.runsOnPullRequest)
    .some((workflow) => runsWidgetCheck(workflow.commands, scripts));
  if (runs) return green(label, "Each pull request checks eva-widget.json and the schemas.");
  return {
    label,
    light: "red",
    detail: "No pull-request workflow runs the contract check.",
    fixRequest: `In ${target.slug}, make the pull-request CI run \`npm run check:widget\`, as ${templateLink}/.github/workflows/ci.yml does. Then open a pull request.`,
  };
}

/** A command that runs the contract check, by itself or through a package script. */
function runsWidgetCheck(commands: readonly string[], scripts: Readonly<Record<string, string>>): boolean {
  return expandedCommands(commands, scripts).some((command) => /check-widget\.js|check:widget/.test(command));
}

function fillsScreenItem(target: RepositoryFacts): SetupItem {
  const label = "Test that the widget fills the screen";
  if (target.files === null) return grey(label, filesUnknown);
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
  if (target.pages === null) return grey(label, notRead);
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
  if (target.workflows === null) return grey(label, filesUnknown);
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
  const branch = await defaultBranch(write, slug);
  const head = await firstCommit(() => branchHead(write, slug, branch), wait);
  // Each entry carries its text, so the whole template is one tree call.
  const tree = Object.entries(files).map(([path, content]): TreeEntry => ({
    path,
    mode: "100644",
    type: "blob",
    content,
  }));
  await commitTree(write, slug, branch, head, tree, templateCommit);
}

/** GitHub makes the first commit of a new repository a moment after it answers, so Eva tries again. */
async function firstCommit(
  read: () => Promise<string>,
  wait: (milliseconds: number) => Promise<void>,
): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (!isEvaError(error, "github_failed") || attempt >= firstCommitTries) throw error;
    }
    await wait(1_000);
  }
}

async function defaultBranch(write: GithubWrite, slug: string): Promise<string> {
  return textField(await githubCall(write, "GET", `repos/${slug}`), "default_branch") ?? "main";
}

/**
 * Starts the first deploy of the demo. Pages must be on first, so this runs after the fixes. With
 * Pages off, such as on a private repository, a deploy would only fail, so Eva starts none.
 */
export async function startFirstDeploy(slug: string, write: GithubWrite): Promise<void> {
  const pages = await write("GET", `repos/${slug}/pages`);
  if (pages.status === 404) return;
  const branch = await defaultBranch(write, slug);
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
