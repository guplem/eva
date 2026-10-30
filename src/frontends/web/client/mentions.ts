/**
 * The mentions of an Assistant chat (issue 657): `@project:<id>` and `@file:<vault path>`. An `@`
 * opens a search of the projects and the vault files, and a pick writes the mention in the text.
 * The text stays as the person typed it. Eva gets one note for each mention after it, as for an
 * attached file, so the agent knows where the project or the file is.
 */
import { mentionsIn, mentionToken } from "../../../shared/mentions.ts";
import type { ListedSession, Project } from "./api.ts";

/** The part of a project that the search shows and a note names. */
export interface MentionProject {
  readonly id: string;
  readonly title: string;
  readonly status: Project["frontMatter"]["status"];
  /** The folder of the project: its vault path, or the full path for a project outside the vault. */
  readonly folder: string;
}

export function mentionProjectOf(project: Project): MentionProject {
  return {
    id: project.id,
    title: project.title,
    status: project.frontMatter.status,
    folder: project.vaultFolder ?? project.path,
  };
}

/** The `@` that the person types now, and the word after it. */
export interface MentionQuery {
  /** The place of the `@` in the text. */
  readonly start: number;
  readonly query: string;
}

const kindPrefix = /^(?:project|file):/;

/**
 * The mention that the person types at `caret`, or null. Only an `@` at the start or after a space
 * counts, so an email address opens no search.
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const match = /(?:^|\s)@(\S*)$/.exec(text.slice(0, caret));
  if (match === null) return null;
  const word = match[1] ?? "";
  return { start: caret - word.length - 1, query: word.replace(kindPrefix, "") };
}

/** The end of the word at the caret, so a pick in the middle of a mention replaces all of it. */
export function mentionWordEnd(text: string, caret: number): number {
  return caret + (/^\S*/.exec(text.slice(caret))?.[0].length ?? 0);
}

/** Puts the mention in place of the typed `@word`, with a space after it, and gives the new caret. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  token: string,
): { readonly text: string; readonly caret: number } {
  const after = text.slice(caret);
  // A space or a line break already ends the mention. The caret goes past a space, not past a line break.
  const spaced = /^\s/.test(after) ? token : `${token} `;
  const skip = after.startsWith(" ") || spaced !== token ? 1 : 0;
  return { text: text.slice(0, start) + spaced + after, caret: start + token.length + skip };
}

const statusOrder: readonly MentionProject["status"][] = ["active", "idea", "paused", "closed", null];

/**
 * The projects that match `query` in the title or the id. A project with a chat that runs now comes
 * first, then the order of `statusOrder`. Each group keeps the order of `projects`.
 */
export function pickedProjects(
  projects: readonly MentionProject[],
  busyIds: readonly string[],
  query: string,
  limit: number,
): MentionProject[] {
  const needle = query.toLowerCase();
  const rank = (project: MentionProject): number =>
    busyIds.includes(project.id) ? -1 : statusOrder.indexOf(project.status);
  return projects
    .filter((project) => project.title.toLowerCase().includes(needle) || project.id.toLowerCase().includes(needle))
    .map((project, index) => ({ project, index }))
    .sort((a, b) => rank(a.project) - rank(b.project) || a.index - b.index)
    .slice(0, limit)
    .map(({ project }) => project);
}

/** One note for each mention of the text, in order. A mention that shows twice gets one note. */
export function mentionNotes(text: string, projects: readonly MentionProject[]): string[] {
  const notes = new Map<string, string>();
  for (const { kind, name } of mentionsIn(text)) {
    const token = mentionToken(kind, name);
    if (notes.has(token)) continue;
    notes.set(token, kind === "file" ? fileNote(token, name) : projectNote(token, name, projects));
  }
  return [...notes.values()];
}

function fileNote(token: string, path: string): string {
  return `[${token} is the file ${path} of the vault]`;
}

function projectNote(token: string, id: string, projects: readonly MentionProject[]): string {
  const project = projects.find((candidate) => candidate.id === id);
  // The vault layout is a contract, so a project that the list does not know yet still has its folder.
  if (project === undefined) return `[${token} is the project in the folder Projects/${id}]`;
  return `[${token} is the project "${project.title}", in the folder ${project.folder}]`;
}

/** The text of a new chat about a project: the mention first, then what the person typed before. */
export function withProjectMention(text: string, projectId: string): string {
  const token = mentionToken("project", projectId);
  if (mentionNotes(text, []).some((note) => note.startsWith(`[${token} `))) return text;
  return `${token} ${text}`;
}

/**
 * The text of a new chat that asks Eva to fix a repository of a project (issue 668). The text that
 * the person typed before goes after the fix, so nothing is lost.
 */
export function withFixRequest(text: string, projectId: string, request: string): string {
  const fix = `${mentionToken("project", projectId)} ${request}`;
  return text.trim() === "" ? fix : `${fix}\n\n${text}`;
}

/** The projects with a Project chat that runs now: by the chat list, or by a turn that started since. */
export function busyProjects(
  chats: readonly Pick<ListedSession, "id" | "mode" | "projectId" | "running">[],
  isLive: (sessionId: string) => boolean,
): string[] {
  const ids = chats.flatMap((chat) =>
    chat.mode === "project" && chat.projectId !== null && (chat.running || isLive(chat.id)) ? [chat.projectId] : [],
  );
  return [...new Set(ids)];
}
