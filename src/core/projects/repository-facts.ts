/**
 * Reads the facts of a setup report from GitHub, through `gh api`. `gh` uses the person's own
 * GitHub login: Eva's GitHub token reaches the vault only. An answer that GitHub refuses, such
 * as an admin-only address, becomes a null fact, which the report shows grey.
 */
import { parse as parseYaml } from "yaml";
import { EvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import type { RepositoryFacts, WorkflowFacts } from "./repository-setup.ts";

export interface GithubAnswer {
  readonly status: number;
  readonly body: string;
}

/** One GET of the GitHub REST API. `raw`: the file content of a `contents` address, not JSON. */
export type GithubGet = (path: string, raw?: boolean) => Promise<GithubAnswer>;

const ghTimeoutMs = 30_000;
const workflowPattern = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const settingsPath = ".claude/settings.json";

/** A GithubGet over `gh api --include`, which prints the status line before the body. */
export function ghApiGet(runner: ProcessRunner, environment: Readonly<Record<string, string>>): GithubGet {
  return async (path, raw = false) => {
    const accept = raw ? ["-H", "Accept: application/vnd.github.raw"] : [];
    let output: { stdout: string; stderr: string };
    try {
      output = await runner.run(["gh", "api", "--include", ...accept, path], {
        cwd: process.cwd(),
        environment: { ...environment, GH_PROMPT_DISABLED: "1" },
        timeoutMs: ghTimeoutMs,
      });
    } catch (error) {
      throw new EvaError("github_failed", "Eva could not run gh, the GitHub CLI. Install it, then run gh auth login.", {
        cause: error,
      });
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

export async function readRepositoryFacts(slug: string, get: GithubGet): Promise<RepositoryFacts> {
  const repository = await get(`repos/${slug}`);
  const info = repository.status === 200 ? asRecord(parseJson(repository.body)) : null;
  if (info === null) {
    throw new EvaError(
      "github_failed",
      `GitHub does not show ${slug}: it does not exist, or the gh login cannot see it.`,
    );
  }
  const branch = typeof info["default_branch"] === "string" ? info["default_branch"] : "main";
  const isAdmin = asRecord(info["permissions"])?.["admin"] === true;
  const security = asRecord(info["security_and_analysis"]);
  const address = `repos/${slug}`;
  const encodedBranch = encodeURIComponent(branch);

  const [files, labels, rules, branchInfo, reporting, alerts, fixes, codeScanning, workflowToken] = await Promise.all([
    readFiles(get, `${address}/git/trees/${encodedBranch}?recursive=1`),
    readJson(get, `${address}/labels?per_page=100`),
    readJson(get, `${address}/rules/branches/${encodedBranch}`),
    readJson(get, `${address}/branches/${encodedBranch}`),
    readJson(get, `${address}/private-vulnerability-reporting`),
    get(`${address}/vulnerability-alerts`),
    readJson(get, `${address}/automated-security-fixes`),
    readJson(get, `${address}/code-scanning/default-setup`),
    readJson(get, `${address}/actions/permissions/workflow`),
  ]);
  const readFile = (path: string): Promise<string | null> =>
    get(`${address}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodedBranch}`, true).then(
      (answer) => (answer.status === 200 ? answer.body : null),
    );
  const [workflows, allowRules] = await Promise.all([
    files === null ? null : readWorkflows(Object.keys(files), readFile),
    files === null || settingsPath in files ? readFile(settingsPath).then(readAllowRules) : null,
  ]);

  return {
    slug,
    defaultBranch: branch,
    isPrivate: info["private"] === true,
    isAdmin,
    allowAutoMerge: booleanOrNull(info["allow_auto_merge"]),
    allowUpdateBranch: booleanOrNull(info["allow_update_branch"]),
    deleteBranchOnMerge: booleanOrNull(info["delete_branch_on_merge"]),
    files,
    workflows,
    labels: Array.isArray(labels) ? labels.flatMap((label) => textField(label, "name") ?? []) : null,
    allowRules,
    requiredChecks: readRequiredChecks(rules, branchInfo),
    privateVulnerabilityReporting: booleanOrNull(asRecord(reporting)?.["enabled"]),
    // 404 means "off" to an admin, and "you may not look" to anyone else.
    dependabotAlerts: alerts.status === 204 ? true : alerts.status === 404 && isAdmin ? false : null,
    dependabotSecurityUpdates: booleanOrNull(asRecord(fixes)?.["enabled"]),
    secretScanning: featureStatus(security, "secret_scanning"),
    pushProtection: featureStatus(security, "secret_scanning_push_protection"),
    codeScanningDefaultSetup: codeScanning === null ? null : textField(codeScanning, "state") === "configured",
    readOnlyWorkflowToken:
      workflowToken === null ? null : textField(workflowToken, "default_workflow_permissions") === "read",
  };
}

async function readFiles(get: GithubGet, path: string): Promise<Record<string, string> | null> {
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

async function readWorkflows(
  paths: readonly string[],
  readFile: (path: string) => Promise<string | null>,
): Promise<WorkflowFacts[]> {
  const workflowPaths = paths.filter((path) => workflowPattern.test(path)).sort();
  return Promise.all(
    workflowPaths.map(async (path) => {
      const text = (await readFile(path)) ?? "";
      return { path, runsOnPullRequest: runsOnPullRequest(text), usesCodeql: text.includes("github/codeql-action/") };
    }),
  );
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

function readAllowRules(text: string | null): string[] | null {
  const allow = asRecord(asRecord(text === null ? null : parseJson(text))?.["permissions"])?.["allow"];
  return Array.isArray(allow) ? allow.filter((rule): rule is string => typeof rule === "string") : null;
}

function readRequiredChecks(rules: unknown, branchInfo: unknown): boolean | null {
  if (rules === null && branchInfo === null) return null;
  if (Array.isArray(rules) && rules.some((rule) => textField(rule, "type") === "required_status_checks")) return true;
  const checks = asRecord(asRecord(asRecord(branchInfo)?.["protection"])?.["required_status_checks"]);
  if (checks === null || checks["enforcement_level"] === "off") return false;
  const named = [checks["contexts"], checks["checks"]].some((list) => Array.isArray(list) && list.length > 0);
  return named;
}

function featureStatus(security: Record<string, unknown> | null, name: string): boolean | null {
  const status = textField(security?.[name], "status");
  return status === null ? null : status === "enabled";
}

async function readJson(get: GithubGet, path: string): Promise<unknown> {
  const answer = await get(path);
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
