/**
 * Finds the projects of a vault and reads their front matter.
 * A broken field is a warning on the project, never an exception (lesson 54).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseProjectId, type ParsedProjectId } from "./project-id.ts";

export type ProjectStatus = "idea" | "active" | "paused" | "closed";

export interface ProjectFrontMatter {
  readonly created: string | null;
  readonly status: ProjectStatus | null;
  readonly repos: readonly string[];
  readonly tags: readonly string[];
  readonly legacyId: string | null;
  /** Every key Eva does not know, kept as it is. */
  readonly extra: Readonly<Record<string, unknown>>;
}

export interface FrontMatterResult {
  readonly frontMatter: ProjectFrontMatter | null;
  readonly warnings: readonly string[];
}

export interface Project {
  readonly id: string;
  readonly path: string;
  readonly parsedId: ParsedProjectId;
  readonly frontMatter: ProjectFrontMatter;
  readonly title: string;
  readonly warnings: readonly string[];
}

const statuses: readonly ProjectStatus[] = ["idea", "active", "paused", "closed"];
const knownKeys = new Set(["created", "status", "repos", "tags", "legacy_id"]);
const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function parseFrontMatter(text: string): FrontMatterResult {
  const match = frontMatterPattern.exec(text);
  if (!match) return { frontMatter: null, warnings: ["no front matter"] };

  let raw: unknown;
  try {
    // A YAML date stays text, so `created` keeps the exact form that the person wrote.
    raw = parseYaml(match[1] ?? "", { schema: "failsafe" });
  } catch (error) {
    return { frontMatter: null, warnings: [`invalid YAML: ${(error as Error).message.split("\n")[0] ?? ""}`] };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { frontMatter: null, warnings: ["the front matter is not a set of keys"] };
  }

  const fields = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const created = typeof fields["created"] === "string" ? fields["created"] : null;
  if (created === null) warnings.push("created is missing");

  let status: ProjectStatus | null = null;
  if (statuses.includes(fields["status"] as ProjectStatus)) status = fields["status"] as ProjectStatus;
  else warnings.push("status must be idea, active, paused or closed");

  const repos = readTextList(fields["repos"]);
  if (repos === null) warnings.push("repos must be a list of URLs");
  const tags = readTextList(fields["tags"]);
  if (tags === null) warnings.push("tags must be a list");
  const legacyId = typeof fields["legacy_id"] === "string" ? fields["legacy_id"] : null;

  const extra = Object.fromEntries(Object.entries(fields).filter(([key]) => !knownKeys.has(key)));
  return { frontMatter: { created, status, repos: repos ?? [], tags: tags ?? [], legacyId, extra }, warnings };
}

export interface DiscoveryOptions {
  readonly vaultPath: string;
  readonly extraRoots: readonly string[];
}

/** Every project of the vault's `Projects/` folder and of the extra roots. */
export function discoverProjects(options: DiscoveryOptions): Project[] {
  const roots = [join(options.vaultPath, "Projects"), ...options.extraRoots];
  const projects: Project[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const project = readProject(join(root, name), name);
      if (project !== null) projects.push(project);
    }
  }
  return projects;
}

export interface ProjectQuery {
  readonly text?: string;
  readonly status?: ProjectStatus;
  readonly tag?: string;
}

/** Projects that match every given filter, the most recently created first. */
export function searchProjects(projects: readonly Project[], query: ProjectQuery): Project[] {
  const words = (query.text ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  return projects
    .filter((project) => {
      const haystack = `${project.id} ${project.title}`.toLowerCase();
      if (!words.every((word) => haystack.includes(word))) return false;
      if (query.status !== undefined && project.frontMatter.status !== query.status) return false;
      if (query.tag !== undefined && !project.frontMatter.tags.includes(query.tag)) return false;
      return true;
    })
    .sort((first, second) => second.id.localeCompare(first.id));
}

function readProject(path: string, name: string): Project | null {
  const parsedId = parseProjectId(name);
  if (parsedId === null) return null;
  const agentsFile = join(path, "AGENTS.md");
  if (!isDirectory(path) || !existsSync(agentsFile)) return null;

  const text = readFileSync(agentsFile, "utf-8");
  const { frontMatter, warnings } = parseFrontMatter(text);
  if (frontMatter === null) return null;

  const allWarnings = [...warnings];
  if (frontMatter.created !== null && !createdMatchesId(frontMatter.created, name)) {
    allWarnings.push(`created ${frontMatter.created} does not match the folder name`);
  }
  return { id: name, path, parsedId, frontMatter, title: readTitle(text) ?? parsedId.slug, warnings: allWarnings };
}

/** `2025-03-02T10:15` matches `2025-03-02-1015-...`; `2019-03` matches `2019-03-...`. */
function createdMatchesId(created: string, folderName: string): boolean {
  const asIdPrefix = created.replace("T", "-").replace(":", "");
  return folderName.startsWith(`${asIdPrefix}-`);
}

function readTitle(text: string): string | null {
  const heading = /^# (.+)$/m.exec(text.replace(frontMatterPattern, ""));
  return heading?.[1]?.trim() ?? null;
}

function readTextList(value: unknown): string[] | null {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string") ? value : null;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
