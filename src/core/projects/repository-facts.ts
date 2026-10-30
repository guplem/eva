/**
 * Reads the facts of a setup report from GitHub, through `gh api`. `gh` uses the instance's own
 * login, which Eva's GitHub login sets up (#244). An answer that GitHub refuses, such
 * as an admin-only address, becomes a null fact, which the report shows grey.
 */
import { parse as parseYaml } from "yaml";
import { EvaError, isEvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import type { HookFacts, RepositoryFacts, WorkflowFacts } from "./repository-setup.ts";

export interface GithubAnswer {
  readonly status: number;
  readonly body: string;
}

/**
 * One request to the GitHub API. `raw`: the file content of a `contents` address, not JSON.
 * `fields` make it a POST, as `gh api -f` does; GraphQL needs them.
 */
export type GithubRequest = (
  path: string,
  raw?: boolean,
  fields?: Readonly<Record<string, string>>,
) => Promise<GithubAnswer>;

const ghTimeoutMs = 30_000;
const workflowPattern = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const settingsPath = ".claude/settings.json";
const packagePath = "package.json";
const lefthookPattern = /^\.?lefthook\.(?:ya?ml|json|jsonc|toml)$/;
const huskyStages: Readonly<Record<string, keyof HookFacts>> = {
  ".husky/pre-commit": "commit",
  ".husky/pre-push": "push",
};
const preCommitPath = ".pre-commit-config.yaml";
const widgetManifestPath = "eva-widget.json";
const widgetSchemaPattern = /^schemas\/[A-Za-z0-9._-]+\.json$/;
const labelsPerPage = 100;
/** A limit for the label pages, so a broken answer never loops for ever. */
const labelPageLimit = 10;
/** The two security facts that GraphQL gives to any reader; REST gives the alerts to admins only. */
const securityQuery =
  "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { hasVulnerabilityAlertsEnabled isSecurityPolicyEnabled } }";

/** A GithubRequest over `gh api --include`, which prints the status line before the body. */
export function ghApiRequest(runner: ProcessRunner, environment: Readonly<Record<string, string>>): GithubRequest {
  return (path, raw = false, fields = {}) => {
    const accept = raw ? ["-H", "Accept: application/vnd.github.raw"] : [];
    const fieldArguments = Object.entries(fields).flatMap(([key, value]) => ["-f", `${key}=${value}`]);
    return ghApi(runner, environment, [...accept, path, ...fieldArguments]);
  };
}

/** Runs `gh api --include` with these arguments, and reads the HTTP status and the body. */
export async function ghApi(
  runner: ProcessRunner,
  environment: Readonly<Record<string, string>>,
  args: readonly string[],
  stdin?: string,
): Promise<GithubAnswer> {
  let output: { stdout: string; stderr: string };
  try {
    output = await runner.run(["gh", "api", "--include", ...args], {
      cwd: process.cwd(),
      environment: { ...environment, GH_PROMPT_DISABLED: "1" },
      timeoutMs: ghTimeoutMs,
      ...(stdin === undefined ? {} : { stdin }),
    });
  } catch (error) {
    const message = isEvaError(error, "process_timeout")
      ? "GitHub did not answer in time. Try again later."
      : "Eva could not run gh, the GitHub CLI. Install it, then press Log in with GitHub on the GitHub card.";
    throw new EvaError("github_failed", message, { cause: error });
  }
  const status = /^HTTP\/[\d.]+ (\d{3})/.exec(output.stdout);
  if (status === null) {
    const reason = output.stderr.trim().split(/\r?\n/)[0] ?? "";
    throw new EvaError("github_failed", `gh could not reach GitHub: ${reason}`);
  }
  const bodyStart = /\r?\n\r?\n/.exec(output.stdout);
  const body = bodyStart === null ? "" : output.stdout.slice(bodyStart.index + bodyStart[0].length);
  return { status: Number(status[1]), body };
}

export async function readRepositoryFacts(slug: string, request: GithubRequest): Promise<RepositoryFacts> {
  const repository = await request(`repos/${slug}`);
  const info = repository.status === 200 ? asRecord(parseJson(repository.body)) : null;
  if (info === null) {
    const message =
      repository.status === 404
        ? `GitHub does not show ${slug}: it does not exist, or the gh login cannot see it.`
        : `GitHub refused to show ${slug} (HTTP ${String(repository.status)}). Run gh auth status, or try again later.`;
    throw new EvaError("github_failed", message);
  }
  const branch = typeof info["default_branch"] === "string" ? info["default_branch"] : "main";
  const isAdmin = asRecord(info["permissions"])?.["admin"] === true;
  const securityAndAnalysis = asRecord(info["security_and_analysis"]);
  const address = `repos/${slug}`;
  const encodedBranch = encodeURIComponent(branch);

  const [owner = "", name = ""] = slug.split("/");
  const [files, labels, rules, branchInfo, reporting, security, fixes, codeScanning, workflowToken, languages] =
    await Promise.all([
      readFiles(request, `${address}/git/trees/${encodedBranch}?recursive=1`),
      readLabels(request, `${address}/labels`),
      readJson(request, `${address}/rules/branches/${encodedBranch}`),
      readJson(request, `${address}/branches/${encodedBranch}`),
      readJson(request, `${address}/private-vulnerability-reporting`),
      readGraphql(request, securityQuery, { owner, name }),
      readJson(request, `${address}/automated-security-fixes`),
      readJson(request, `${address}/code-scanning/default-setup`),
      readJson(request, `${address}/actions/permissions/workflow`),
      readJson(request, `${address}/languages`),
    ]);
  const readFile = (path: string): Promise<FileRead> =>
    request(`${address}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodedBranch}`, true).then(
      (answer) => (answer.status === 200 ? { text: answer.body } : answer.status === 404 ? "absent" : null),
    );
  const [workflows, allowRules, scripts, hooks, widgetFiles, pages] = await Promise.all([
    files === null ? null : readWorkflows(Object.keys(files), readFile),
    files !== null && !(settingsPath in files) ? ("none" as const) : readFile(settingsPath).then(readAllowRules),
    files === null ? null : packagePath in files ? readFile(packagePath).then(readScripts) : {},
    files === null ? null : readHooks(Object.keys(files), readFile),
    files === null ? null : readWidgetFiles(files, readFile),
    readPages(request, `${address}/pages`),
  ]);

  return {
    slug,
    defaultBranch: branch,
    isPrivate: info["private"] === true,
    isArchived: info["archived"] === true,
    isAdmin,
    allowAutoMerge: booleanOrNull(info["allow_auto_merge"]),
    allowUpdateBranch: booleanOrNull(info["allow_update_branch"]),
    deleteBranchOnMerge: booleanOrNull(info["delete_branch_on_merge"]),
    files,
    workflows,
    scripts,
    hooks,
    labels,
    allowRules,
    requiredChecks: readRequiredChecks(rules, branchInfo),
    privateVulnerabilityReporting: booleanOrNull(asRecord(reporting)?.["enabled"]),
    dependabotAlerts: booleanOrNull(security?.["hasVulnerabilityAlertsEnabled"]),
    securityPolicy: booleanOrNull(security?.["isSecurityPolicyEnabled"]),
    dependabotSecurityUpdates: booleanOrNull(asRecord(fixes)?.["enabled"]),
    secretScanning: featureStatus(securityAndAnalysis, "secret_scanning"),
    pushProtection: featureStatus(securityAndAnalysis, "secret_scanning_push_protection"),
    codeScanningDefaultSetup: codeScanning === null ? null : textField(codeScanning, "state") === "configured",
    readOnlyWorkflowToken:
      workflowToken === null ? null : textField(workflowToken, "default_workflow_permissions") === "read",
    hasCode: asRecord(languages) === null ? null : Object.keys(asRecord(languages) ?? {}).length > 0,
    pages,
    widgetFiles,
  };
}

/**
 * The manifest of a widget and each schema that its inputs name (#688). Only a path under
 * `schemas/` that the tree lists is read, so a manifest cannot point the reader elsewhere.
 */
async function readWidgetFiles(
  files: Readonly<Record<string, string>>,
  readFile: (path: string) => Promise<FileRead>,
): Promise<Record<string, string> | null> {
  if (!(widgetManifestPath in files)) return {};
  const manifest = await readFile(widgetManifestPath);
  if (manifest === null || manifest === "absent") return null;
  const inputs = listOf(asRecord(parseJson(manifest.text))?.["inputs"]);
  const schemas = [...new Set(inputs.flatMap((input) => textField(input, "schema") ?? []))].filter(
    (path) => widgetSchemaPattern.test(path) && path in files,
  );
  const texts = await Promise.all(schemas.map(readFile));
  const read: Record<string, string> = { [widgetManifestPath]: manifest.text };
  for (const [index, text] of texts.entries()) {
    if (text === null || text === "absent") return null;
    read[schemas[index] ?? ""] = text.text;
  }
  return read;
}

/** GitHub answers 404 when Pages is off. */
async function readPages(request: GithubRequest, path: string): Promise<RepositoryFacts["pages"]> {
  const answer = await request(path);
  if (answer.status === 404) return "off";
  if (answer.status !== 200) return null;
  const buildType = textField(parseJson(answer.body), "build_type");
  return buildType === "workflow" ? "workflow" : buildType === null ? null : "branch";
}

/** A file's text, "absent" when GitHub has no such file, or null when GitHub did not answer. */
type FileRead = { readonly text: string } | "absent" | null;

async function readFiles(request: GithubRequest, path: string): Promise<Record<string, string> | null> {
  const tree = asRecord(await readJson(request, path));
  // A truncated tree would make present files look missing.
  if (tree?.["truncated"] !== false || !Array.isArray(tree["tree"])) return null;
  const files: Record<string, string> = {};
  for (const entry of tree["tree"]) {
    const filePath = textField(entry, "path");
    const sha = textField(entry, "sha");
    if (textField(entry, "type") === "blob" && filePath !== null && sha !== null) files[filePath] = sha;
  }
  return files;
}

/** Every label name, page by page. Null when a page does not answer. */
async function readLabels(request: GithubRequest, path: string): Promise<string[] | null> {
  const names: string[] = [];
  for (let page = 1; page <= labelPageLimit; page += 1) {
    const labels = await readJson(request, `${path}?per_page=${String(labelsPerPage)}&page=${String(page)}`);
    if (!Array.isArray(labels)) return null;
    names.push(...labels.flatMap((label) => textField(label, "name") ?? []));
    if (labels.length < labelsPerPage) return names;
  }
  return null;
}

/** The workflows, or null when one of them cannot be read: a missing one could hide the CI. */
async function readWorkflows(
  paths: readonly string[],
  readFile: (path: string) => Promise<FileRead>,
): Promise<WorkflowFacts[] | null> {
  const workflowPaths = paths.filter((path) => workflowPattern.test(path)).sort();
  const texts = await Promise.all(workflowPaths.map(readFile));
  const workflows: WorkflowFacts[] = [];
  for (const [index, text] of texts.entries()) {
    // The tree lists the file, so a 404 means that GitHub did not serve it.
    if (text === null || text === "absent") return null;
    const content = text.text;
    const fields = asRecord(parseYamlText(content));
    workflows.push({
      path: workflowPaths[index] ?? "",
      runsOnPullRequest: runsOnPullRequest(fields),
      usesCodeql: content.includes("github/codeql-action/"),
      commands: stepCommands(fields),
    });
  }
  return withLocalWorkflows(workflows);
}

function runsOnPullRequest(fields: Record<string, unknown> | null): boolean {
  // YAML 1.1 readers turn the key `on` into `true`; take either.
  const trigger = fields?.["on"] ?? fields?.["true"];
  if (trigger === "pull_request") return true;
  if (Array.isArray(trigger)) return trigger.includes("pull_request");
  return asRecord(trigger)?.["pull_request"] !== undefined;
}

/** The `run` text or the `uses` action of each step, job by job. A job can also `uses` a whole workflow. */
function stepCommands(workflow: Record<string, unknown> | null): string[] {
  const jobs = Object.values(asRecord(workflow?.["jobs"]) ?? {});
  return jobs.flatMap((job) => {
    const steps = listOf(asRecord(job)?.["steps"]);
    return [
      textField(job, "uses") ?? [],
      steps.map((step) => textField(step, "run") ?? textField(step, "uses") ?? []),
    ].flat(2);
  });
}

/** Each call of a workflow in the same repository becomes the commands of that workflow, one level deep. */
function withLocalWorkflows(workflows: readonly WorkflowFacts[]): WorkflowFacts[] {
  const byPath = new Map(workflows.map((workflow) => [workflow.path, workflow.commands]));
  return workflows.map((workflow) => ({
    ...workflow,
    commands: workflow.commands.flatMap((command) => byPath.get(command.replace(/^\.\//, "")) ?? [command]),
  }));
}

/** The string scripts of a `package.json`; none when it is not JSON, as the package manager would fail. */
function readScripts(text: FileRead): Record<string, string> | null {
  // The tree lists the file, so a 404 means that GitHub did not serve it.
  if (text === null || text === "absent") return null;
  const scripts = asRecord(asRecord(parseJson(text.text))?.["scripts"]) ?? {};
  return Object.fromEntries(
    Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

/** The commands of the pre-commit and pre-push hooks. Null when one hook file cannot be read. */
async function readHooks(
  paths: readonly string[],
  readFile: (path: string) => Promise<FileRead>,
): Promise<HookFacts | null> {
  const hookPaths = paths
    .filter((path) => lefthookPattern.test(path) || Object.hasOwn(huskyStages, path) || path === preCommitPath)
    .sort();
  const texts = await Promise.all(hookPaths.map(readFile));
  const hooks = { commit: [] as string[], push: [] as string[] };
  for (const [index, text] of texts.entries()) {
    if (text === null || text === "absent") return null;
    const path = hookPaths[index] ?? "";
    const husky = huskyStages[path];
    if (husky !== undefined) {
      hooks[husky].push(text.text);
      continue;
    }
    // Eva reads no TOML, and a config with comments in JSON is not YAML. Unknown is grey, not "no checks".
    const config = asRecord(parseYamlText(text.text));
    if (config === null) return null;
    if (path === preCommitPath) {
      addPreCommitHooks(config, hooks);
    } else {
      hooks.commit.push(...lefthookCommands(asRecord(config["pre-commit"])));
      hooks.push.push(...lefthookCommands(asRecord(config["pre-push"])));
    }
  }
  return hooks;
}

/** The commands of one Lefthook hook: its `commands`, its `jobs`, and the names of its `scripts`. */
function lefthookCommands(hook: Record<string, unknown> | null): string[] {
  const runs = [...Object.values(asRecord(hook?.["commands"]) ?? {}), ...listOf(hook?.["jobs"])];
  const commands = runs.flatMap((entry) => textField(entry, "run") ?? textField(entry, "script") ?? []);
  return [...commands, ...Object.keys(asRecord(hook?.["scripts"]) ?? {})];
}

/** The pre-commit framework runs a hook at its `stages`, or at the default stages: before a commit. */
function addPreCommitHooks(config: Record<string, unknown> | null, hooks: { commit: string[]; push: string[] }): void {
  const defaults = stringList(config?.["default_stages"]) ?? ["pre-commit"];
  for (const repository of listOf(config?.["repos"])) {
    for (const hook of listOf(asRecord(repository)?.["hooks"])) {
      const command = textField(hook, "entry") ?? textField(hook, "id");
      if (command === null) continue;
      const stages = stringList(asRecord(hook)?.["stages"]) ?? defaults;
      // Old configs name the stages `commit` and `push`.
      if (stages.some((stage) => stage === "pre-commit" || stage === "commit")) hooks.commit.push(command);
      if (stages.some((stage) => stage === "pre-push" || stage === "push")) hooks.push.push(command);
    }
  }
}

/** The items of a YAML or JSON list, or none when the value is not a list. */
export function listOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : null;
}

function parseYamlText(text: string): unknown {
  try {
    return parseYaml(text) as unknown;
  } catch {
    return null;
  }
}

/** The allow rules; "none" for no file or no list, as Claude Code ignores a broken file. */
function readAllowRules(text: FileRead): readonly string[] | "none" | null {
  if (text === null) return null;
  if (text === "absent") return "none";
  const allow = asRecord(asRecord(parseJson(text.text))?.["permissions"])?.["allow"];
  const rules = Array.isArray(allow) ? allow.filter((rule): rule is string => typeof rule === "string") : [];
  return rules.length === 0 ? "none" : rules;
}

function readRequiredChecks(rules: unknown, branchInfo: unknown): boolean | null {
  if (Array.isArray(rules) && rules.some((rule) => textField(rule, "type") === "required_status_checks")) return true;
  const checks = asRecord(asRecord(asRecord(branchInfo)?.["protection"])?.["required_status_checks"]);
  const named =
    checks !== null &&
    checks["enforcement_level"] !== "off" &&
    [checks["contexts"], checks["checks"]].some((list) => Array.isArray(list) && list.length > 0);
  if (named) return true;
  // Only two readable answers prove that nothing requires checks.
  return rules === null || branchInfo === null ? null : false;
}

function featureStatus(security: Record<string, unknown> | null, name: string): boolean | null {
  const status = textField(security?.[name], "status");
  return status === null ? null : status === "enabled";
}

/** The `repository` object of a GraphQL answer, or null when GitHub answered with errors. */
async function readGraphql(
  request: GithubRequest,
  query: string,
  variables: Readonly<Record<string, string>>,
): Promise<Record<string, unknown> | null> {
  const answer = asRecord(await readJson(request, "graphql", { query, ...variables }));
  if (answer === null || answer["errors"] !== undefined) return null;
  return asRecord(asRecord(answer["data"])?.["repository"]);
}

async function readJson(
  request: GithubRequest,
  path: string,
  fields?: Readonly<Record<string, string>>,
): Promise<unknown> {
  const answer = await request(path, false, fields);
  return answer.status === 200 ? parseJson(answer.body) : null;
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function textField(value: unknown, key: string): string | null {
  const field = asRecord(value)?.[key];
  return typeof field === "string" ? field : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
