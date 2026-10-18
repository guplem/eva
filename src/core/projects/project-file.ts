/**
 * Changes a project's `AGENTS.md` for the person: the front matter fields and the `# Title`
 * heading. It edits the YAML document in place, so comments, key order and unknown keys stay.
 */
import { createHash } from "node:crypto";
import { isMap, isNode, isScalar, isSeq, parseDocument } from "yaml";
import { EvaError } from "../../shared/errors.ts";
import { frontMatterPattern, parseFrontMatter, readTitle, type ProjectStatus } from "./project-catalog.ts";

export interface ProjectDetails {
  /** An empty title removes the heading, so the list shows the folder name. */
  readonly title: string;
  /** Null removes the key. */
  readonly status: ProjectStatus | null;
  readonly tags: readonly string[];
  readonly repos: readonly string[];
}

/** The text of a project file with these details. Throws `project_invalid` for a bad value or file. */
export function applyProjectDetails(text: string, details: ProjectDetails): string {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const withoutBom = text.slice(bom.length);
  const match = frontMatterPattern.exec(withoutBom);
  if (match === null) throw invalid("The file has no front matter to change. Fix it in the AGENTS.md editor.");
  const eol = match[0].includes("\r\n") ? "\r\n" : "\n";
  const title = details.title.trim();
  if (/[\r\n]/.test(title)) throw invalid("The title must be one line.");
  const tags = cleanList(
    details.tags.map((tag) => tag.trim().replace(/^#/, "")),
    "A tag",
  );
  const repos = cleanList(details.repos, "A repository");
  if (repos.some((repo) => repo.startsWith("-"))) throw invalid("A repository cannot start with -.");

  const frontMatter = editFrontMatter((match[1] ?? "").replaceAll("\r\n", "\n"), {
    status: details.status,
    tags,
    repos,
  });
  const head = frontMatter === null ? match[0] : `---${eol}${frontMatter.replaceAll("\n", eol)}${eol}---${eol}`;
  // A front matter that ends the file has no line break after `---`; an unchanged one keeps that.
  const body = withTitle(withoutBom.slice(match[0].length), title, eol);
  return bom + head + body;
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

interface FrontMatterFields {
  readonly status: ProjectStatus | null;
  readonly tags: readonly string[];
  readonly repos: readonly string[];
}

/** The new front matter, or null when no field changes, so an untouched file keeps every byte. */
function editFrontMatter(source: string, fields: FrontMatterFields): string | null {
  // Failsafe, as the catalog reads it: every value stays text, such as `created: 2026-01-31T09:15`.
  const document = parseDocument(source, { schema: "failsafe" });
  if (document.errors.length > 0 || !isMap(document.contents)) {
    throw invalid("Eva cannot read the front matter. Fix it in the AGENTS.md editor.");
  }
  const current = parseFrontMatter(`---\n${source}\n---\n`).frontMatter;
  const set = (key: string, value: string | readonly string[] | null, same: boolean): boolean => {
    if (same) return false;
    if (value === null || (Array.isArray(value) && value.length === 0)) {
      document.delete(key);
      return true;
    }
    const old = document.get(key, true);
    // A changed value keeps the comment after it, such as `status: active # idea, active, ...`.
    if (typeof value === "string" && isScalar(old)) {
      old.value = value;
      return true;
    }
    const node = document.createNode(value);
    if (isNode(old) && old.comment !== undefined && old.comment !== null) node.comment = old.comment;
    // A list written as `[a, b]` stays in that form.
    if (isSeq(node) && isSeq(old)) node.flow = old.flow ?? false;
    document.set(key, node);
    return true;
  };
  const changes = [
    set(
      "status",
      fields.status,
      current?.status === fields.status && document.has("status") === (fields.status !== null),
    ),
    set("tags", fields.tags, sameList(current?.tags, fields.tags)),
    set("repos", fields.repos, sameList(current?.repos, fields.repos)),
  ];
  if (!changes.includes(true)) return null;
  return document.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\n$/, "");
}

function withTitle(body: string, title: string, eol: string): string {
  if (readTitle(body) === (title === "" ? null : title)) return body;
  const heading = /^# .+$/m.exec(body);
  if (heading !== null) {
    const after = body.slice(heading.index + heading[0].length);
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
          title: readTitle(withoutBom.replace(frontMatterPattern, "")) ?? "",
          status: frontMatter.status,
          tags: frontMatter.tags,
          repos: frontMatter.repos,
          created: frontMatter.created,
        };
  return { text, version: fileVersion(text), details };
}
