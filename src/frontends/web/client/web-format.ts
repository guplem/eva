/**
 * Turns the agent's Markdown into block HTML for the web app: paragraphs, headings, nested
 * lists, tables, quotes and code blocks. Telegram gets a smaller subset (telegram-format.ts),
 * but a browser shows all of HTML, and it collapses a bare line break into a space. A single
 * line break becomes `<br>`, chat style, so the answer keeps its lines as Telegram does.
 * All text is escaped and only these tags are added, so the HTML is safe to put in the page.
 */
import { escapeHtml, inlineHtml } from "../../markdown-inline.ts";

const fencePattern = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)/;
const headingPattern = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const quotePattern = /^\s{0,3}>\s?(.*)$/;
const rulePattern = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const itemPattern = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
const tableRowPattern = /^\s*\|.*\|\s*$/;
const tableSeparatorPattern = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
/** Two trailing spaces or a backslash mark a hard break in Markdown; each line breaks here anyway. */
const hardBreakPattern = /(?: {2,}|\\)$/;

interface ListItem {
  readonly indent: number;
  readonly ordered: boolean;
  readonly number: number;
  /** The column where the item's text starts; deeper lines belong to the item. */
  readonly contentIndent: number;
  readonly text: string;
}

export function toWebHtml(markdown: string): string {
  return blocks(markdown.replaceAll("\r\n", "\n").replaceAll("\t", "    ").split("\n"), false);
}

/** In a tight list item, a paragraph is bare text, so the item does not gain extra space. */
function blocks(lines: readonly string[], tight: boolean): string {
  let html = "";
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const fence = fencePattern.exec(line);
    if (fence) {
      const closing = (fence[2] ?? "```").charAt(0).repeat(3);
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith(closing)) {
        body.push(dedent(lines[index] ?? "", (fence[1] ?? "").length));
        index += 1;
      }
      index += 1;
      html += code(body.join("\n"), fence[3] ?? "");
      continue;
    }
    if (startsTable(lines, index)) {
      const rows = [line];
      index += 2;
      while (index < lines.length && tableRowPattern.test(lines[index] ?? "")) {
        rows.push(lines[index] ?? "");
        index += 1;
      }
      html += table(rows);
      continue;
    }
    if (quotePattern.test(line)) {
      const quoted: string[] = [];
      let found = quotePattern.exec(line);
      while (found) {
        quoted.push(found[1] ?? "");
        index += 1;
        found = quotePattern.exec(lines[index] ?? "");
      }
      html += `<blockquote>${blocks(quoted, false)}</blockquote>`;
      continue;
    }
    const heading = headingPattern.exec(line);
    if (heading) {
      const level = String((heading[1] ?? "#").length);
      html += `<h${level}>${inlineHtml(heading[2] ?? "")}</h${level}>`;
      index += 1;
      continue;
    }
    if (rulePattern.test(line)) {
      html += "<hr>";
      index += 1;
      continue;
    }
    const item = itemOf(line);
    if (item) {
      const parsed = list(lines, index, item);
      html += parsed.html;
      index = parsed.next;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim() !== "" && !startsBlock(lines, index)) {
      paragraph.push(inlineHtml((lines[index] ?? "").trim().replace(hardBreakPattern, "").trimEnd()));
      index += 1;
    }
    html += tight ? paragraph.join("<br>") : `<p>${paragraph.join("<br>")}</p>`;
  }
  return html;
}

/**
 * Reads one list from `start`. A deeper line belongs to the item above it, so nested lists and
 * code blocks stay inside their item. A blank line between items makes the list loose: each
 * item then holds real paragraphs.
 */
function list(lines: readonly string[], start: number, first: ListItem): { html: string; next: number } {
  const bodies: string[][] = [];
  let loose = false;
  let index = start;
  while (index < lines.length) {
    const item = itemOf(lines[index] ?? "");
    if (item === null || !sameList(item, first)) break;
    const body = [item.text];
    index += 1;
    while (index < lines.length) {
      const line = lines[index] ?? "";
      const previous = body[body.length - 1] ?? "";
      if (line.trim() === "") {
        const following = nextFilled(lines, index);
        const next = lines[following] ?? "";
        if (following < lines.length && indentOf(next) > first.indent) {
          loose = true;
          body.push("");
          index += 1;
          continue;
        }
        if (sameList(itemOf(next), first)) loose = true;
        index = following;
        break;
      }
      if (indentOf(line) > first.indent) {
        body.push(dedent(line, item.contentIndent));
        index += 1;
        continue;
      }
      // A lazy line: text right under an item's text, with no indent, still belongs to the item.
      if (previous.trim() !== "" && !startsBlock(lines, index)) {
        body.push(line.trim());
        index += 1;
        continue;
      }
      break;
    }
    bodies.push(body);
  }
  const items = bodies.map((body) => `<li>${blocks(body, !loose)}</li>`).join("");
  if (!first.ordered) return { html: `<ul>${items}</ul>`, next: index };
  const startAttribute = first.number === 1 ? "" : ` start="${String(first.number)}"`;
  return { html: `<ol${startAttribute}>${items}</ol>`, next: index };
}

function sameList(item: ListItem | null, first: ListItem): boolean {
  return item?.indent === first.indent && item.ordered === first.ordered;
}

function itemOf(line: string): ListItem | null {
  if (rulePattern.test(line)) return null;
  const found = itemPattern.exec(line);
  if (!found) return null;
  const indent = (found[1] ?? "").length;
  const marker = found[2] ?? "-";
  const ordered = /\d/.test(marker);
  return {
    indent,
    ordered,
    number: ordered ? Number.parseInt(marker, 10) : 1,
    contentIndent: indent + marker.length + (found[3] ?? " ").length,
    text: found[4] ?? "",
  };
}

function startsBlock(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? "";
  return (
    fencePattern.test(line) ||
    headingPattern.test(line) ||
    quotePattern.test(line) ||
    rulePattern.test(line) ||
    itemOf(line) !== null ||
    startsTable(lines, index)
  );
}

function startsTable(lines: readonly string[], index: number): boolean {
  return tableRowPattern.test(lines[index] ?? "") && tableSeparatorPattern.test(lines[index + 1] ?? "");
}

function nextFilled(lines: readonly string[], index: number): number {
  let next = index;
  while (next < lines.length && (lines[next] ?? "").trim() === "") next += 1;
  return next;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Removes up to `width` leading spaces, so a less indented line keeps its text. */
function dedent(line: string, width: number): string {
  return line.slice(Math.min(width, indentOf(line)));
}

function table(rows: readonly string[]): string {
  const cells = rows.map((row) =>
    row
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => inlineHtml(cell.trim())),
  );
  const header = cells[0] ?? [];
  const body = cells
    .slice(1)
    .map((row) => `<tr>${header.map((_, column) => `<td>${row[column] ?? ""}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${header.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

function code(text: string, language: string): string {
  const languageClass = language.length > 0 ? ` class="language-${escapeHtml(language)}"` : "";
  return `<pre><code${languageClass}>${escapeHtml(text)}</code></pre>`;
}
