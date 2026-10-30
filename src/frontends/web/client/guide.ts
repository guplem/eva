/**
 * The guide in Settings: the docs for people, as each build ships them. A change to one of these
 * Markdown files reaches the guide with the next build, with no other step.
 * Pure, so a test covers the links, the headings and the search without a browser.
 */
import readmeFile from "../../../../README.md" with { type: "text" };
import referenceFile from "../../../../docs/guide/reference.md" with { type: "text" };
import setupFile from "../../../../docs/guide/setup.md" with { type: "text" };
import { closesFence, openingFencePattern } from "../../markdown-fence.ts";
import { evaRepository } from "../../../shared/version.ts";
import { toWebHtml } from "./web-format.ts";

export type GuidePageId = "overview" | "setup" | "reference";

export interface GuideSource {
  readonly id: GuidePageId;
  readonly title: string;
  /** One line under the title on the guide's home page. */
  readonly summary: string;
  /** The file's path in the repository. */
  readonly path: string;
  readonly markdown: string;
}

/** Only the docs for people (AGENTS.md): the other docs are for the people who change Eva. */
export const guidePages: readonly GuideSource[] = [
  {
    id: "overview",
    title: "About Eva",
    summary: "What Eva is, how she works, and answers to common problems.",
    path: "README.md",
    markdown: readmeFile,
  },
  {
    id: "setup",
    title: "Install Eva, step by step",
    summary: "The install on Windows and Linux, the logins, the phone, and how to remove Eva.",
    path: "docs/guide/setup.md",
    markdown: setupFile,
  },
  {
    id: "reference",
    title: "Eva reference",
    summary: "Every command and setting, several computers, updates, and the optional features.",
    path: "docs/guide/reference.md",
    markdown: referenceFile,
  },
];

/** A part of a doc: the text from one heading to the next. The text before the first heading has no slug. */
export interface GuideSection {
  readonly page: GuidePageId;
  readonly slug: string | null;
  readonly title: string;
  readonly level: number;
  /** Plain text, for the search. */
  readonly text: string;
}

export interface RenderedGuide {
  readonly html: string;
  readonly sections: readonly GuideSection[];
}

export interface SnippetPart {
  readonly text: string;
  readonly marked: boolean;
}

export interface GuideMatch {
  readonly page: GuidePageId;
  readonly slug: string | null;
  readonly title: string;
  readonly pageTitle: string;
  readonly snippet: readonly SnippetPart[];
}

const guidePrefix = "#/settings/guide";
/** The file view on GitHub of the default branch, as the messages of the core link to it. */
const repositoryFiles = `https://github.com/${evaRepository}/blob/main/`;
const relativeLinkPattern = /\[([^\]\n]+)\]\((?!https?:|mailto:)([^()\s]+)\)/g;
const rawHtmlPattern = /^\s*<\/?[a-z][^>]*>/i;
const titlePattern = /^#\s/;
const headingTagPattern = /<h([1-6])>(.*?)<\/h\1>/g;
const sectionHeadingPattern = /<h([23]) id="guide-([^"]+)">(.*?)<\/h\1>/g;
const snippetLength = 160;
const snippetLead = 40;
const resultLimit = 12;

export function guidePageOf(id: string): GuideSource | undefined {
  return guidePages.find((page) => page.id === id);
}

/** The Settings item of a doc, or of a heading in it, such as `reference/vault-sync`. */
export function guideItem(page: GuidePageId, slug: string | null): string {
  return slug === null ? page : `${page}/${slug}`;
}

export function parseGuideItem(item: string): { page: GuidePageId; slug: string | null } | null {
  const [page = "", ...rest] = item.split("/");
  const known = guidePageOf(page);
  if (known === undefined) return null;
  return { page: known.id, slug: rest.length === 0 || rest.join("/") === "" ? null : rest.join("/") };
}

/** The element id of a heading. The prefix keeps it apart from the other ids of the page. */
export function guideHeadingId(slug: string): string {
  return `guide-${slug}`;
}

/** GitHub's rule, so a link of a doc finds the same heading on GitHub and in the app. */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replaceAll(" ", "-");
}

const rendered = new Map<GuidePageId, RenderedGuide>();

/** The page's HTML and sections, made once: the docs do not change while the page runs. */
export function renderedGuide(id: GuidePageId): RenderedGuide {
  const known = rendered.get(id);
  if (known !== undefined) return known;
  const page = guidePages.find((each) => each.id === id) ?? guidePages[0];
  if (page === undefined) return { html: "", sections: [] };
  const result = renderGuide(page);
  rendered.set(id, result);
  return result;
}

export function renderGuide(page: GuideSource): RenderedGuide {
  const html = withHeadingIds(appLinks(toWebHtml(prepared(page))));
  return { html, sections: sectionsOf(page, html) };
}

/**
 * The Markdown without its title, which the page header shows, and without raw HTML, which
 * `toWebHtml` would show as text. Each relative link becomes a link to the file on GitHub.
 */
function prepared(page: GuideSource): string {
  const lines: string[] = [];
  let openFence: string | null = null;
  let titleDropped = false;
  for (const line of page.markdown.replaceAll("\r\n", "\n").split("\n")) {
    if (openFence !== null) {
      if (closesFence(line, openFence)) openFence = null;
      lines.push(line);
      continue;
    }
    const fence = openingFencePattern.exec(line);
    if (fence) {
      openFence = fence[2] ?? "```";
      lines.push(line);
      continue;
    }
    if (rawHtmlPattern.test(line)) continue;
    if (!titleDropped && titlePattern.test(line)) {
      titleDropped = true;
      continue;
    }
    lines.push(
      line.replace(
        relativeLinkPattern,
        (_match, label: string, target: string) => `[${label}](${fileUrl(page.path, target)})`,
      ),
    );
  }
  return lines.join("\n");
}

/** The page of a file of the repository on GitHub. */
export function githubFileUrl(path: string): string {
  return `${repositoryFiles}${path}`;
}

function fileUrl(from: string, target: string): string {
  const resolved = new URL(target, `https://repository/${from}`);
  return githubFileUrl(`${resolved.pathname.slice(1)}${resolved.hash}`);
}

/** A link to a doc of the guide opens it in the app, in the same tab, so Back returns. */
function appLinks(html: string): string {
  return html.replace(/<a target="_blank" rel="noreferrer" href="([^"]*)">/g, (tag, url: string) => {
    if (!url.startsWith(repositoryFiles)) return tag;
    const [path = "", hash = ""] = url.slice(repositoryFiles.length).split("#");
    const page = guidePages.find((each) => each.path === path);
    if (page === undefined) return tag;
    return `<a href="${guidePrefix}/${guideItem(page.id, hash === "" ? null : hash)}">`;
  });
}

function withHeadingIds(html: string): string {
  const seen = new Map<string, number>();
  return html.replace(headingTagPattern, (_tag, level: string, inner: string) => {
    const base = headingSlug(plainText(inner));
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const slug = count === 0 ? base : `${base}-${String(count)}`;
    return `<h${level} id="${guideHeadingId(slug)}">${inner}</h${level}>`;
  });
}

function sectionsOf(page: GuideSource, html: string): GuideSection[] {
  const headings = [...html.matchAll(sectionHeadingPattern)];
  const sections: GuideSection[] = [];
  const intro = plainText(html.slice(0, headings[0]?.index ?? html.length));
  if (intro !== "") sections.push({ page: page.id, slug: null, title: page.title, level: 1, text: intro });
  headings.forEach((heading, index) => {
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? html.length;
    sections.push({
      page: page.id,
      slug: heading[2] ?? "",
      title: plainText(heading[3] ?? ""),
      level: Number(heading[1]),
      text: plainText(html.slice(start, end)),
    });
  });
  return sections;
}

/** The text of HTML from `toWebHtml`, which escapes only these characters. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,:;!?)])/g, "$1")
    .trim();
}

/**
 * The sections that hold every typed word, in their title or their text. A section whose title
 * holds more of the words comes first; the others keep the order of the docs.
 */
export function searchGuide(query: string): GuideMatch[] {
  const words = fold(query)
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words.length === 0) return [];
  const found: { match: GuideMatch; inTitle: number }[] = [];
  for (const page of guidePages) {
    for (const section of renderedGuide(page.id).sections) {
      const title = fold(section.title);
      const text = fold(section.text);
      if (!words.every((word) => title.includes(word) || text.includes(word))) continue;
      found.push({
        match: {
          page: page.id,
          slug: section.slug,
          title: section.title,
          pageTitle: page.title,
          snippet: snippet(section.text, words),
        },
        inTitle: words.filter((word) => title.includes(word)).length,
      });
    }
  }
  // Array sort is stable, so equal sections keep the order of the docs.
  return found
    .sort((first, second) => second.inTitle - first.inTitle)
    .slice(0, resultLimit)
    .map((each) => each.match);
}

/**
 * Lower case, without accents, one character for each character, so a place in the folded text
 * is the same place in the text.
 */
function fold(text: string): string {
  let folded = "";
  for (const character of text) {
    const plain = character.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    folded += plain.length === character.length ? plain : character;
  }
  return folded;
}

/** A piece of the text around the first typed word, cut at spaces, with each typed word marked. */
function snippet(text: string, words: readonly string[]): SnippetPart[] {
  const folded = fold(text);
  const first = Math.min(...words.map((word) => folded.indexOf(word)).filter((at) => at >= 0));
  let start = Number.isFinite(first) ? Math.max(0, first - snippetLead) : 0;
  let end = Math.min(text.length, start + snippetLength);
  if (start > 0) start = text.indexOf(" ", start) + 1 || start;
  if (end < text.length) end = text.lastIndexOf(" ", end) > start ? text.lastIndexOf(" ", end) : end;
  const piece = text.slice(start, end);
  const marks = markedRanges(fold(piece), words);
  const parts: SnippetPart[] = [];
  if (start > 0) parts.push({ text: "…", marked: false });
  let position = 0;
  for (const [from, to] of marks) {
    if (from > position) parts.push({ text: piece.slice(position, from), marked: false });
    parts.push({ text: piece.slice(from, to), marked: true });
    position = to;
  }
  if (position < piece.length) parts.push({ text: piece.slice(position), marked: false });
  if (end < text.length) parts.push({ text: "…", marked: false });
  return parts;
}

/** Each place of each word, joined where two places overlap. */
function markedRanges(folded: string, words: readonly string[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const word of words) {
    for (let at = folded.indexOf(word); at >= 0; at = folded.indexOf(word, at + word.length)) {
      ranges.push([at, at + word.length]);
    }
  }
  ranges.sort((first, second) => first[0] - second[0]);
  const joined: [number, number][] = [];
  for (const range of ranges) {
    const last = joined[joined.length - 1];
    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else joined.push(range);
  }
  return joined;
}
