/**
 * Reads the facts of a setup report from GitHub, through `gh api`. `gh` uses the person's own
 * GitHub login: Eva's GitHub token reaches the vault only. An answer that GitHub refuses, such
 * as an admin-only address, becomes a null fact, which the report shows grey.
 */
import { parse as parseYaml } from "yaml";
import { EvaError, isEvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import type { RepositoryFacts, WorkflowFacts } from "./repository-setup.ts";

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
const labelsPerPage = 100;
/** A limit for the label pages, so a broken answer never loops for ever. */
const labelPageLimit = 10;
/** The two security facts that GraphQL gives to any reader; REST gives the alerts to admins only. */
const securityQuery =
  "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { hasVulnerabilityAlertsEnabled isSecurityPolicyEnabled } }";

/** A GithubRequest over `gh api --include`, which prints the status line before the body. */
export function ghApiRequest(runner: ProcessRunner, environment: Readonly<Record<string, string>>): GithubRequest {
  return async (path, raw = false, fields = {}) => {
    const accept = raw ? ["-H", "Accept: application/vnd.github.raw"] : [];
    const fieldArguments = Object.entries(fields).flatMap(([key, value]) => ["-f", `${key}=${value}`]);
    let output: { stdout: string; stderr: string };
    try {
      output = await runner.run(["gh", "api", "--include", ...accept, path, ...fieldArguments], {
        cwd: process.cwd(),
        environment: { ...environment, GH_PROMPT_DISABLED: "1" },
        timeoutMs: ghTimeoutMs,
      });
    } catch (error) {
      const message = isEvaError(error, "process_timeout")
        ? "GitHub did not answer in time. Try again later."
        : "Eva could not run gh, the GitHub CLI. Install it, then run gh auth login.";
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
  };
}

export async function readRepositoryFacts(slug: string, get: GithubRequest): Promise<RepositoryFacts> {
  const repository = await get(`repos/${slug}`);
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
  const [files, labels, rules, branchInfo, reporting, security, fixes, codeScanning, workflowToken] = await Promise.all(
    [
      readFiles(get, `${address}/git/trees/${encodedBranch}?recursive=1`),
      readLabels(get, `${address}/labels`),
      readJson(get, `${address}/rules/branches/${encodedBranch}`),
      readJson(get, `${address}/branches/${encodedBranch}`),
      readJson(get, `${address}/private-vulnerability-reporting`),
      readGraphql(get, securityQuery, { owner, name }),
      readJson(get, `${address}/automated-security-fixes`),
      readJson(get, `${address}/code-scanning/default-setup`),
      readJson(get, `${address}/actions/permissions/workflow`),
    ],
  );
  const readFile = (path: string): Promise<FileRead> =>
    get(`${address}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodedBranch}`, true).then(
      (answer) => (answer.status === 200 ? { text: answer.body } : answer.status === 404 ? "absent" : null),
    );
  const [workflows, allowRules] = await Promise.all([
    files === null ? null : readWorkflows(Object.keys(files), readFile),
    files !== null && !(settingsPath in files) ? ("none" as const) : readFile(settingsPath).then(readAllowRules),
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
  };
}

/** A file's text, "absent" when GitHub has no such file, or null when GitHub did not answer. */
type FileRead = { readonly text: string } | "absent" | null;

async function readFiles(get: GithubRequest, path: string): Promise<Record<string, string> | null> {
  const tree = asRecord(await readJson(get, path));
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
async function readLabels(get: GithubRequest, path: string): Promise<string[] | null> {
  const names: string[] = [];
  for (let page = 1; page <= labelPageLimit; page += 1) {
    const labels = await readJson(get, `${path}?per_page=${String(labelsPerPage)}&page=${String(page)}`);
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
    workflows.push({
      path: workflowPaths[index] ?? "",
      runsOnPullRequest: runsOnPullRequest(content),
      usesCodeql: content.includes("github/codeql-action/"),
    });
  }
  return workflows;
}

function runsOnPullRequest(text: string): boolean {
  let workflow: unknown;
  try {
    workflow = parseYaml(text);
  } catch {
    return false;
  }
  const fields = asRecord(workflow);
  // YAML 1.1 readers turn the key `on` into `true`; take either.
  const trigger = fields?.["on"] ?? fields?.["true"];
  if (trigger === "pull_request") return true;
  if (Array.isArray(trigger)) return trigger.includes("pull_request");
  return asRecord(trigger)?.["pull_request"] !== undefined;
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
  get: GithubRequest,
  query: string,
  variables: Readonly<Record<string, string>>,
): Promise<Record<string, unknown> | null> {
  const answer = asRecord(await readJson(get, "graphql", { query, ...variables }));
  if (answer === null || answer["errors"] !== undefined) return null;
  return asRecord(asRecord(answer["data"])?.["repository"]);
}

async function readJson(get: GithubRequest, path: string, fields?: Readonly<Record<string, string>>): Promise<unknown> {
  const answer = await get(path, false, fields);
  return answer.status === 200 ? parseJson(answer.body) : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textField(value: unknown, key: string): string | null {
  const field = asRecord(value)?.[key];
  return typeof field === "string" ? field : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
