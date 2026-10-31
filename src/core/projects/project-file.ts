/**
 * Changes a project's `AGENTS.md` for the person: the front matter fields and the `# Title`
 * heading. It edits the YAML document in place, so comments, key order and unknown keys stay.
 */
import { createHash } from "node:crypto";
import { isMap, isNode, isScalar, isSeq, parse, parseDocument } from "yaml";
import { EvaError } from "../../shared/errors.ts";
import {
  frontMatterPattern,
  parseFrontMatter,
  repoTypesWarning,
  statusListText,
  titleHeading,
  type ProjectType,
} from "./project-catalog.ts";
import type { ProjectStatus } from "../../shared/project-statuses.ts";

/** The statuses in the comment after `status:` before `in-use` (#690). */
const oldStatusList = "idea, active, paused or closed";

export interface ProjectDetails {
  /** An empty title removes the heading, so the list shows the folder name. */
  readonly title: string;
  /** Null removes the key. */
  readonly status: ProjectStatus | null;
  readonly tags: readonly string[];
  readonly repos: readonly string[];
  /** Absent keeps the type, as from an older page. Software, the default, removes the key (#703). */
  readonly type?: ProjectType | undefined;
}

/** The text of a project file with these details. Throws `project_invalid` for a bad value or file. */
export function applyProjectDetails(text: string, details: ProjectDetails): string {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const withoutBom = text.slice(bom.length);
  const match = frontMatterPattern.exec(withoutBom);
  const current = parseFrontMatter(withoutBom).frontMatter;
  if (match === null || current === null) {
    throw invalid("Eva cannot read the front matter. Fix it in the AGENTS.md editor.");
  }
  const eol = match[0].includes("\r\n") ? "\r\n" : "\n";
  const title = details.title.trim();
  if (/[\r\n]/.test(title)) throw invalid("The title must be one line.");

  const frontMatter = editFrontMatter((match[1] ?? "").replaceAll("\r\n", "\n"), {
    // The form shows "None" for a status it cannot read, so None there keeps the person's value.
    ...(details.status === current.status ? {} : { status: details.status }),
    ...changedList("tags", current.tags, details.tags, (tag) => tag.replace(/^#/, ""), "A tag"),
    ...changedRepos(current.repos, current.repoTypes, details.repos),
    ...(details.type === undefined || details.type === current.type
      ? {}
      : { type: details.type === "software" ? null : details.type }),
  });
  const body = withTitle(withoutBom.slice(match[0].length), title, eol);
  let head = frontMatter === null ? match[0] : `---${eol}${frontMatter.replaceAll("\n", eol)}${eol}---${eol}`;
  // A front matter that ends the file has no line break after `---`; a new heading needs one.
  if (!head.endsWith("\n") && body !== "") head += eol;
  return bom + head + body;
}

/**
 * The text of a project file where one repository of `repos` has this type. Throws
 * `project_invalid` for a repository that the project does not list, or a bad file.
 */
export function setRepositoryType(text: string, repository: string, type: string): string {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const withoutBom = text.slice(bom.length);
  const match = frontMatterPattern.exec(withoutBom);
  const { frontMatter: current, warnings } = parseFrontMatter(withoutBom);
  if (match === null || current === null) {
    throw invalid("Eva cannot read the front matter. Fix it in the AGENTS.md editor.");
  }
  // Eva reads a broken map as empty, so a write would drop the types of the other repositories.
  if (warnings.includes(repoTypesWarning)) throw invalid("Eva cannot read repo_types. Fix it in the AGENTS.md editor.");
  if (!current.repos.includes(repository)) throw invalid(`The project does not list the repository ${repository}.`);
  if (current.repoTypes[repository] === type) return text;
  const eol = match[0].includes("\r\n") ? "\r\n" : "\n";
  const frontMatter = editFrontMatter((match[1] ?? "").replaceAll("\r\n", "\n"), {
    repo_types: { ...current.repoTypes, [repository]: type },
  });
  const after = withoutBom.slice(match[0].length);
  const head = `---${eol}${(frontMatter ?? "").replaceAll("\n", eol)}${eol}---${after === "" ? "" : eol}`;
  return bom + head + after;
}

/** Throws `project_invalid` for a text that the project list cannot read, so the project would vanish. */
export function checkProjectFile(text: string): void {
  const { frontMatter, warnings } = parseFrontMatter(text.replace(/^\uFEFF/, ""));
  if (frontMatter === null) throw invalid(`Eva cannot read the front matter: ${warnings.join(", ")}.`);
}

/** A short hash of the text. A save names the version that it read, so a newer change is never lost. */
export function fileVersion(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Only the fields that changed. A list that the person left alone is neither checked nor cleaned. */
interface FrontMatterChanges {
  readonly status?: ProjectStatus | null;
  readonly tags?: readonly string[];
  readonly repos?: readonly string[];
  readonly repo_types?: Readonly<Record<string, string>> | null;
  readonly type?: ProjectType | null;
}

/** A value of the front matter: text, a list, or a map such as `repo_types`. */
type FrontMatterValue = string | readonly string[] | Readonly<Record<string, string>> | null;

function isEmptyMap(value: FrontMatterValue): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

/** The new `repos`, and the types of the repositories that stay: a removed repository loses its type. */
function changedRepos(
  current: readonly string[],
  types: Readonly<Record<string, string>>,
  next: readonly string[],
): FrontMatterChanges {
  const repos = changedList("repos", current, next, (repo) => repo, "A repository");
  if (repos.repos === undefined) return repos;
  const kept = Object.fromEntries(Object.entries(types).filter(([url]) => repos.repos?.includes(url) === true));
  return Object.keys(kept).length === Object.keys(types).length ? repos : { ...repos, repo_types: kept };
}

function changedList(
  key: "tags" | "repos",
  current: readonly string[],
  next: readonly string[],
  normalize: (value: string) => string,
  label: string,
): FrontMatterChanges {
  if (sameList(current, next)) return {};
  const cleaned = cleanList(
    next.map((value) => normalize(value.trim())),
    label,
  );
  if (key === "repos" && cleaned.some((repo) => repo.startsWith("-"))) {
    throw invalid("A repository cannot start with -.");
  }
  return sameList(current, cleaned) ? {} : { [key]: cleaned };
}

/** The new front matter, or null when no field changes, so an untouched file keeps every byte. */
function editFrontMatter(source: string, changes: FrontMatterChanges): string | null {
  // Failsafe, as the catalog reads it: every value stays text, such as `created: 2026-01-31T09:15`.
  const document = parseDocument(source, { schema: "failsafe" });
  if (document.errors.length > 0 || !isMap(document.contents)) {
    throw invalid("Eva cannot read the front matter. Fix it in the AGENTS.md editor.");
  }
  const entries = Object.entries(changes) as [string, FrontMatterValue][];
  if (entries.length === 0) return null;
  for (const [key, value] of entries) {
    if (value === null || (Array.isArray(value) && value.length === 0) || isEmptyMap(value)) {
      document.delete(key);
      continue;
    }
    const old = document.get(key, true);
    // A changed value keeps the comment after it, such as `status: active # idea, active, ...`.
    if (typeof value === "string" && isScalar(old)) {
      old.value = value;
      // The vault template wrote the old list of statuses. A comment that the person wrote stays.
      if (key === "status" && old.comment?.trim() === oldStatusList) old.comment = ` ${statusListText}`;
      continue;
    }
    const node = document.createNode(value);
    if (isSeq(node)) {
      for (const item of node.items)
        if (isScalar(item) && readsAsOtherThanText(String(item.value))) item.type = "QUOTE_DOUBLE";
      // A list written as `[a, b]` stays in that form.
      if (isSeq(old)) node.flow = old.flow ?? false;
    }
    if (isNode(old) && old.comment !== undefined && old.comment !== null) node.comment = old.comment;
    document.set(key, node);
  }
  return document.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\n$/, "");
}

/**
 * True for a value such as `12`, `true` or `null`. Eva reads every value as text, but other tools,
 * such as Obsidian, read YAML's usual types, so quotes keep the value text for them too.
 */
function readsAsOtherThanText(value: string): boolean {
  try {
    return parse(value) !== value;
  } catch {
    return true;
  }
}

function withTitle(body: string, title: string, eol: string): string {
  const heading = titleHeading(body);
  if ((heading?.title ?? "") === title) return body;
  if (heading !== null) {
    const after = body.slice(heading.index + heading.length);
    if (title !== "") return `${body.slice(0, heading.index)}# ${title}${after}`;
    // Drop the heading line and the blank line after it.
    return body.slice(0, heading.index) + after.replace(/^\r?\n(\r?\n)?/, "");
  }
  const rest = body.replace(/^(\r?\n)+/, "");
  return rest === "" ? `# ${title}${eol}` : `# ${title}${eol}${eol}${rest}`;
}

function cleanList(values: readonly string[], label: string): string[] {
  const kept: string[] = [];
  for (const value of values.map((candidate) => candidate.trim())) {
    if (value === "") continue;
    if (/\s/.test(value)) throw invalid(`${label} cannot hold a space: "${value}".`);
    // The search ignores case, so `Work` and `work` are one tag.
    if (!kept.some((candidate) => candidate.toLowerCase() === value.toLowerCase())) kept.push(value);
  }
  return kept;
}

function sameList(current: readonly string[] | undefined, next: readonly string[]): boolean {
  return current?.length === next.length && current.every((value, index) => value === next[index]);
}

function invalid(message: string): EvaError {
  return new EvaError("project_invalid", message);
}

/**
 * The edited text with the line endings and byte order mark of the file on disk. A browser text
 * area sends LF only, so without this a Windows file would change on every line at each save.
 */
export function matchFileStyle(edited: string, onDisk: string): string {
  const bom = onDisk.startsWith("\uFEFF") ? "\uFEFF" : "";
  const lines = edited.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  return bom + (onDisk.includes("\r\n") ? lines.replaceAll("\n", "\r\n") : lines);
}

/** A project's `AGENTS.md` as a front end edits it. */
export interface ProjectFile {
  readonly text: string;
  readonly version: string;
  /** The form's values, or null when Eva cannot read the front matter. */
  readonly details: (ProjectDetails & { readonly created: string | null }) | null;
}

export function projectFileOf(text: string): ProjectFile {
  const withoutBom = text.replace(/^\uFEFF/, "");
  const { frontMatter } = parseFrontMatter(withoutBom);
  const details =
    frontMatter === null
      ? null
      : {
          title: titleHeading(withoutBom.replace(frontMatterPattern, ""))?.title ?? "",
          status: frontMatter.status,
          tags: frontMatter.tags,
          repos: frontMatter.repos,
          type: frontMatter.type,
          created: frontMatter.created,
        };
  return { text, version: fileVersion(text), details };
}
