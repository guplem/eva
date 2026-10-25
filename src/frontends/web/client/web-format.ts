/**
 * Turns the agent's Markdown into block HTML for the web app: paragraphs, headings, nested
 * lists, tables, quotes and code blocks. Telegram gets a smaller subset (telegram-format.ts),
 * but a browser shows all of HTML, and it collapses a bare line break into a space. A single
 * line break becomes `<br>`, chat style, so the answer keeps its lines as Telegram does.
 * All text is escaped and only these tags are added, so the HTML is safe to put in the page.
 */
import { closesFence, openingFencePattern } from "../../markdown-fence.ts";
import { escapeHtml, inlineHtml } from "../../markdown-inline.ts";

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
  return blocks(expandIndentTabs(markdown.replaceAll("\r\n", "\n").split("\n")), false);
}

/**
 * The HTML of `toWebHtml` with each heading `levels` deeper, at most `h6`, for a file shown inside
 * a card: its `# Title` must not become a second title of the page.
 */
export function nestedWebHtml(markdown: string, levels: number): string {
  // toWebHtml escapes every `<` of the text, so each heading tag in its output is its own.
  return toWebHtml(markdown).replace(
    /<(\/?)h([1-6])>/g,
    (_tag, close: string, level: string) => `<${close}h${String(Math.min(Number(level) + levels, 6))}>`,
  );
}

/** A tab in an indent counts as four spaces, so it nests a list; a tab in code stays, so copied code works. */
function expandIndentTabs(lines: readonly string[]): string[] {
  let openFence: string | null = null;
  return lines.map((line) => {
    const inCode = openFence !== null;
    // A fence can open on a list item's own line.
    openFence = fenceAfter(inCode ? line : (itemOf(line)?.text ?? line), openFence);
    if (inCode) return line;
    return line.replace(/^[ \t]+/, (indent) => indent.replaceAll("\t", "    "));
  });
}

/** The fence still open after `line`, or null when the line leaves no code block open. */
function fenceAfter(line: string, openFence: string | null): string | null {
  if (openFence === null) return openingFencePattern.exec(line)?.[2] ?? null;
  return closesFence(line, openFence) ? null : openFence;
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
    const fence = openingFencePattern.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !closesFence(lines[index] ?? "", fence[2] ?? "```")) {
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
    let openFence = fenceAfter(item.text, null);
    index += 1;
    while (index < lines.length) {
      const line = lines[index] ?? "";
      const previous = body[body.length - 1] ?? "";
      if (line.trim() === "") {
        const following = nextFilled(lines, index);
        const next = lines[following] ?? "";
        if (following < lines.length && indentOf(next) > first.indent) {
          // A blank line before more text spaces the list out; one inside code or before a nested
          // item belongs to that block.
          if (openFence === null && itemOf(next) === null) loose = true;
          body.push("");
          index += 1;
          continue;
        }
        if (sameList(itemOf(next), first)) loose = true;
        index = following;
        break;
      }
      if (indentOf(line) > first.indent) {
        const dedented = dedent(line, item.contentIndent);
        body.push(dedented);
        openFence = fenceAfter(dedented, openFence);
        index += 1;
        continue;
      }
      if (sameList(itemOf(line), first)) break;
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
    openingFencePattern.test(line) ||
    headingPattern.test(line) ||
    quotePattern.test(line) ||
    rulePattern.test(line) ||
    breaksParagraph(itemOf(line)) ||
    startsTable(lines, index)
  );
}

/** As in CommonMark, a numbered list breaks a paragraph only from 1, so "100. Then" in a sentence stays text. */
function breaksParagraph(item: ListItem | null): boolean {
  return item !== null && (!item.ordered || item.number === 1);
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
  const cells = rows.map((row) => cellsOf(row).map((cell) => inlineHtml(cell.trim())));
  const header = cells[0] ?? [];
  const body = cells
    .slice(1)
    .map((row) => `<tr>${header.map((_, column) => `<td>${row[column] ?? ""}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${header.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Splits a table row on its pipes, but not on an escaped pipe or a pipe in a code span. */
function cellsOf(row: string): string[] {
  const text = row.trim().replace(/^\||\|$/g, "");
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let position = 0; position < text.length; position += 1) {
    const character = text.charAt(position);
    if (character === "\\" && text.charAt(position + 1) === "|") {
      cell += "|";
      position += 1;
      continue;
    }
    if (character === "`") inCode = !inCode;
    if (character === "|" && !inCode) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(cell);
  return cells;
}

/** The empty bar gets the block's Copy button from `MarkdownBody`; the bar stays still when the code scrolls. */
function code(text: string, language: string): string {
  const languageClass = language.length > 0 ? ` class="language-${escapeHtml(language)}"` : "";
  return `<div class="code-box"><div class="code-box-bar"></div><pre><code${languageClass}>${escapeHtml(text)}</code></pre></div>`;
}
