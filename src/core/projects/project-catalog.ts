/**
 * Finds the projects of a vault and reads their front matter.
 * A broken field is a warning on the project, never an exception (lesson 54).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { listClones } from "./clones.ts";
import { parseProjectId, type ParsedProjectId } from "./project-id.ts";

/** `active`: the person develops the project. `in-use`: the person uses it now, such as for the week's menus. */
export const projectStatuses = ["idea", "active", "in-use", "paused", "closed"] as const;
export type ProjectStatus = (typeof projectStatuses)[number];
/** The statuses of the projects that the person works with now: the "Current" filter and the assistant prompt. */
export const currentStatuses: readonly ProjectStatus[] = ["active", "in-use"];
/** A status filter: one status, or `current` for every status of `currentStatuses`. */
export const projectStatusFilters = [...projectStatuses, "current"] as const;
export type ProjectStatusFilter = (typeof projectStatusFilters)[number];

export interface ProjectFrontMatter {
  readonly created: string | null;
  readonly status: ProjectStatus | null;
  readonly repos: readonly string[];
  readonly tags: readonly string[];
  readonly legacyId: string | null;
  /** The type name of each repository address of `repos`, from the `repo_types` key (#681). */
  readonly repoTypes: Readonly<Record<string, string>>;
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
  /** The first paragraph after the title, in one line. */
  readonly description: string | null;
  /**
   * The folder in the vault, such as `Projects/<id>`. Null for a project in an extra root: the Files
   * page shows only the vault.
   */
  readonly vaultFolder: string | null;
  /** The names of the clone folders in `repos/`, so a page can match chats to clones. */
  readonly clones: readonly string[];
  readonly warnings: readonly string[];
}

const statuses: readonly string[] = projectStatuses;
/** "idea, active, in-use, paused or closed", for a warning and for the comment after `status:`. */
export const statusListText = `${projectStatuses.slice(0, -1).join(", ")} or ${projectStatuses.at(-1) ?? ""}`;
const statusFilters: readonly string[] = projectStatusFilters;
/** The front matter keys that Eva reads. Every other key stays in `extra`. */
export const projectFrontMatterKeys = ["created", "status", "repos", "tags", "legacy_id", "repo_types"] as const;
const knownKeys: ReadonlySet<string> = new Set(projectFrontMatterKeys);
/** The warning of a `repo_types` value that is not a map of text values. */
export const repoTypesWarning = "repo_types must map each repository to its type";
export const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

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
  if (statuses.includes(fields["status"] as string)) status = fields["status"] as ProjectStatus;
  else warnings.push(`status must be ${statusListText}`);

  const repos = readTextList(fields["repos"]);
  if (repos === null) warnings.push("repos must be a list of URLs");
  const tags = readTextList(fields["tags"]);
  if (tags === null) warnings.push("tags must be a list");
  const legacyId = typeof fields["legacy_id"] === "string" ? fields["legacy_id"] : null;
  const repoTypes = readTextMap(fields["repo_types"]);
  if (repoTypes === null) warnings.push(repoTypesWarning);

  const extra = Object.fromEntries(Object.entries(fields).filter(([key]) => !knownKeys.has(key)));
  return {
    frontMatter: { created, status, repos: repos ?? [], tags: tags ?? [], legacyId, repoTypes: repoTypes ?? {}, extra },
    warnings,
  };
}

export interface DiscoveryOptions {
  readonly vaultPath: string;
  readonly extraRoots: readonly string[];
}

/** Every project of the vault's `Projects/` folder and of the extra roots. */
export function discoverProjects(options: DiscoveryOptions): Project[] {
  const vaultRoot = join(options.vaultPath, "Projects");
  const roots = [vaultRoot, ...options.extraRoots];
  const projects: Project[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readNames(root)) {
      const project = readProject(join(root, name), name, root === vaultRoot ? `Projects/${name}` : null);
      if (project !== null) projects.push(project);
    }
  }
  return projects;
}

/** A root that Eva cannot read, such as a file or a folder without rights, holds no project (lesson 54). */
function readNames(root: string): string[] {
  try {
    return readdirSync(root);
  } catch {
    return [];
  }
}

export interface ProjectQuery {
  readonly text?: string;
  readonly status?: ProjectStatusFilter;
  readonly tag?: string;
}

/**
 * Reads the filter words of a free text search: `status:active`, `status:current`, `tag:work` and `#work`.
 * Telegram and the CLI send free text only, so the filters live in the text.
 */
export function parseProjectQuery(input: string): ProjectQuery {
  const words: string[] = [];
  let status: ProjectStatusFilter | undefined;
  let tag: string | undefined;
  for (const word of input.split(/\s+/).filter((candidate) => candidate.length > 0)) {
    const lower = word.toLowerCase();
    const tagWord = tagOf(word);
    if (lower === "status:any") status = undefined;
    else if (lower.startsWith("status:") && statusFilters.includes(lower.slice(7))) {
      status = lower.slice(7) as ProjectStatusFilter;
    } else if (tagWord !== null && tag === undefined) tag = tagWord;
    // A second tag word still searches: the words also match the tags.
    else words.push(tagWord ?? word);
  }
  return { text: words.join(" "), ...(status === undefined ? {} : { status }), ...(tag === undefined ? {} : { tag }) };
}

/** The tag of a `tag:work` or `#work` word, or null for any other word. */
function tagOf(word: string): string | null {
  if (word.toLowerCase().startsWith("tag:") && word.length > 4) return word.slice(4);
  if (word.startsWith("#") && word.length > 1) return word.slice(1);
  return null;
}

/** Projects that match every given filter, the most recently created first. */
export function searchProjects(projects: readonly Project[], query: ProjectQuery): Project[] {
  const words = (query.text ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const tag = query.tag?.toLowerCase();
  return projects
    .filter((project) => {
      const tags = project.frontMatter.tags.map((candidate) => candidate.toLowerCase());
      const haystack = `${project.id} ${project.title} ${tags.join(" ")}`.toLowerCase();
      if (!words.every((word) => haystack.includes(word))) return false;
      if (query.status !== undefined && !matchesStatus(project.frontMatter.status, query.status)) return false;
      if (tag !== undefined && !tags.includes(tag)) return false;
      return true;
    })
    .sort((first, second) => second.id.localeCompare(first.id));
}

function matchesStatus(status: ProjectStatus | null, filter: ProjectStatusFilter): boolean {
  if (filter === "current") return status !== null && currentStatuses.includes(status);
  return status === filter;
}

function readProject(path: string, name: string, vaultFolder: string | null): Project | null {
  const parsedId = parseProjectId(name);
  if (parsedId === null) return null;
  const agentsFile = join(path, "AGENTS.md");
  if (!isDirectory(path) || !existsSync(agentsFile)) return null;

  let text: string;
  try {
    text = readFileSync(agentsFile, "utf-8");
  } catch {
    // One project file without rights must not hide every other project (lesson 54).
    return null;
  }
  const { frontMatter, warnings } = parseFrontMatter(text);
  if (frontMatter === null) return null;

  const allWarnings = [...warnings];
  if (frontMatter.created !== null && !createdMatchesId(frontMatter.created, name)) {
    allWarnings.push(`created ${frontMatter.created} does not match the folder name`);
  }
  return {
    id: name,
    path,
    vaultFolder,
    parsedId,
    frontMatter,
    title: readTitle(text) ?? parsedId.slug,
    description: readDescription(text),
    clones: listClones(path).map((clone) => clone.name),
    warnings: allWarnings,
  };
}

/**
 * The title in `text`, the `AGENTS.md` of the folder `name`, by the same rules as `discoverProjects`.
 * Null for a folder that is not a project or has no title heading. The Files page shows it (issue 429).
 */
export function projectTitleOf(text: string, name: string): string | null {
  if (parseProjectId(name) === null) return null;
  return parseFrontMatter(text).frontMatter === null ? null : readTitle(text);
}

/** `2025-03-02T10:15` matches `2025-03-02-1015-...`; `2019-03` matches `2019-03-...`. */
function createdMatchesId(created: string, folderName: string): boolean {
  const asIdPrefix = created.replace("T", "-").replace(":", "");
  return folderName.startsWith(`${asIdPrefix}-`);
}

function readTitle(text: string): string | null {
  return titleHeading(text.replace(frontMatterPattern, ""))?.title ?? null;
}

/** A line that starts a block that is not a paragraph: a heading, quote, table, HTML, list, rule, fence or image. */
const blockStartPattern = /^(#|>|\||<|!\[|\[!\[|[*+-]\s|[-*_]{3,}|```|~~~|\d+[.)]\s)/;
const descriptionLimit = 300;

/**
 * The first paragraph after the title, in one plain line of at most 300 characters, or null.
 * Many project files start with a list, a quote, a table, a fence or badges for the agents,
 * and none of them reads as a description. Every project in each list sends it, so it stays short.
 */
function readDescription(text: string): string | null {
  const body = text.replace(frontMatterPattern, "");
  const heading = titleHeading(body);
  const rest = heading === null ? body : body.slice(heading.index + heading.length);
  const lines = rest.split("\n").map((line) => line.trim());
  const start = lines.findIndex((line) => line.length > 0);
  if (start === -1 || blockStartPattern.test(lines[start] ?? "")) return null;
  const end = lines.findIndex((line, index) => index > start && (line.length === 0 || blockStartPattern.test(line)));
  const plain = lines
    .slice(start, end === -1 ? undefined : end)
    .join(" ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length === 0) return null;
  return plain.length <= descriptionLimit ? plain : `${plain.slice(0, descriptionLimit - 1).trimEnd()}…`;
}

export interface TitleHeading {
  /** Where the `# ` line starts in the body, and its length without the line break. */
  readonly index: number;
  readonly length: number;
  readonly title: string;
}

/** The first `# ` line of a body outside a code fence, where a `#` line is a comment, not a title. */
export function titleHeading(body: string): TitleHeading | null {
  // The marker that opened the current fence, such as "```". Markdown closes a fence only with
  // the same character, at least as many times; four spaces of indent make code, not a fence.
  let fence: string | null = null;
  let index = 0;
  for (const line of body.split("\n")) {
    const content = line.replace(/\r$/, "");
    // A backtick in the info string, such as "```js``` text", makes inline code, not a fence.
    const marker = /^ {0,3}(`{3,}(?!.*`)|~{3,})/.exec(content)?.[1];
    if (marker !== undefined && fence === null) fence = marker;
    else if (
      marker?.[0] === fence?.[0] &&
      (marker?.length ?? 0) >= (fence?.length ?? 0) &&
      /^ {0,3}[`~]+\s*$/.test(content)
    ) {
      fence = null;
    } else if (fence === null && content.startsWith("# ") && content.trim().length > 1) {
      return { index, length: content.length, title: content.slice(2).trim() };
    }
    index += line.length + 1;
  }
  return null;
}

function readTextList(value: unknown): string[] | null {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string") ? value : null;
}

/** A map of text keys to text values, or null when the value is another shape. */
function readTextMap(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.every((entry): entry is [string, string] => typeof entry[1] === "string")
    ? Object.fromEntries(entries)
    : null;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
