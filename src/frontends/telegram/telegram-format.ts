/**
 * Turns the agent's Markdown into the HTML subset Telegram renders (lesson 58), ported from
 * Wall-I v1. HTML and not MarkdownV2: MarkdownV2 needs an escape before every `_`, `.`, `-`
 * and `!`, and one missed escape makes Telegram refuse the whole message. HTML reserves only
 * `<`, `>` and `&`. Telegram has no headings, lists or tables: a heading becomes a bold line,
 * a bullet a dot, and a table aligned columns in a monospace block.
 */
import { closesFence, openingFencePattern } from "../markdown-fence.ts";
import { escapeHtml, inlineHtml } from "../markdown-inline.ts";

const headingPattern = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const bulletPattern = /^(\s*)[-*+]\s+(.*)$/;
const quotePattern = /^>\s?(.*)$/;
const rulePattern = /^\s*([-*_])(\s*\1){2,}\s*$/;
const tableRowPattern = /^\s*\|.*\|\s*$/;
const tableSeparatorPattern = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const ruleText = "──────";

export function toTelegramHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = openingFencePattern.exec(line);
    if (fence) {
      const opening = fence[2] ?? "```";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !closesFence(lines[index] ?? "", opening)) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      out.push(pre(body.join("\n"), fence[3] ?? ""));
      continue;
    }
    if (tableRowPattern.test(line) && tableSeparatorPattern.test(lines[index + 1] ?? "")) {
      const rows = [line];
      index += 2;
      while (index < lines.length && tableRowPattern.test(lines[index] ?? "")) {
        rows.push(lines[index] ?? "");
        index += 1;
      }
      out.push(pre(aligned(rows), ""));
      continue;
    }
    if (quotePattern.test(line)) {
      const quoted: string[] = [];
      let found = quotePattern.exec(lines[index] ?? "");
      while (index < lines.length && found) {
        quoted.push(inlineHtml(found[1] ?? ""));
        index += 1;
        found = quotePattern.exec(lines[index] ?? "");
      }
      out.push(`<blockquote>${quoted.join("\n")}</blockquote>`);
      continue;
    }
    out.push(blockLine(line));
    index += 1;
  }
  return out.join("\n");
}

/**
 * Closes a code block that a chunk ends inside, and opens it again in the next chunk. Each
 * chunk is converted and sent alone, so a cut block would otherwise turn the rest into code.
 */
export function keepFencesWhole(chunks: readonly string[]): string[] {
  const whole: string[] = [];
  // The open block's first line, to reopen it, and its fence, to close it with the same length.
  let open: { line: string; fence: string } | null = null;
  for (const original of chunks) {
    const reopened = open;
    for (const line of original.split("\n")) {
      if (open === null) {
        const fence = openingFencePattern.exec(line);
        if (fence) open = { line: line.trim(), fence: fence[2] ?? "```" };
      } else if (closesFence(line, open.fence)) {
        open = null;
      }
    }
    let chunk = reopened === null ? original : `${reopened.line}\n${original}`;
    if (open !== null) chunk += `\n${open.fence}`;
    whole.push(chunk);
  }
  return whole;
}

/** Splits Markdown into chunks of at most `limit` characters, at line ends where possible. */
export function splitForTelegram(markdown: string, limit: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of markdown.split("\n")) {
    for (const piece of hardCut(line, limit)) {
      const candidate = current.length === 0 ? piece : `${current}\n${piece}`;
      if (candidate.length <= limit) {
        current = candidate;
      } else {
        chunks.push(current);
        current = piece;
      }
    }
  }
  chunks.push(current);
  return chunks;
}

function hardCut(line: string, limit: number): string[] {
  if (line.length <= limit) return [line];
  const pieces: string[] = [];
  for (let start = 0; start < line.length; start += limit) pieces.push(line.slice(start, start + limit));
  return pieces;
}

function blockLine(line: string): string {
  const heading = headingPattern.exec(line);
  if (heading) return `<b>${inlineHtml(heading[1] ?? "")}</b>`;
  if (rulePattern.test(line)) return ruleText;
  const bullet = bulletPattern.exec(line);
  if (bullet) return `${bullet[1] ?? ""}• ${inlineHtml(bullet[2] ?? "")}`;
  return inlineHtml(line);
}

function aligned(rows: readonly string[]): string {
  const cells = rows.map((row) =>
    row
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim().replaceAll("**", "").replaceAll("`", "")),
  );
  const columnCount = Math.max(...cells.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(...cells.map((row) => (row[column] ?? "").length)),
  );
  const header = cells[0] ?? [];
  const lines = [header, widths.map((width) => "-".repeat(width)), ...cells.slice(1)];
  return lines
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

function pre(text: string, language: string): string {
  if (language.length > 0)
    return `<pre><code class="language-${escapeHtml(language)}">${escapeHtml(text)}</code></pre>`;
  return `<pre>${escapeHtml(text)}</pre>`;
}
