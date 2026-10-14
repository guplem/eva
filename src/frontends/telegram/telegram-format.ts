/**
 * Turns the agent's Markdown into the HTML subset Telegram renders (lesson 58), ported from
 * Wall-I v1. HTML and not MarkdownV2: MarkdownV2 needs an escape before every `_`, `.`, `-`
 * and `!`, and one missed escape makes Telegram refuse the whole message. HTML reserves only
 * `<`, `>` and `&`. Telegram has no headings, lists or tables: a heading becomes a bold line,
 * a bullet a dot, and a table aligned columns in a monospace block.
 */

const fencePattern = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/;
const headingPattern = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const bulletPattern = /^(\s*)[-*+]\s+(.*)$/;
const quotePattern = /^>\s?(.*)$/;
const rulePattern = /^\s*([-*_])(\s*\1){2,}\s*$/;
const tableRowPattern = /^\s*\|.*\|\s*$/;
const tableSeparatorPattern = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const codeSpanPattern = /(`+)(.+?)\1/g;
const linkPattern = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
const boldPattern = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
const strikePattern = /~~(?=\S)(.+?)(?<=\S)~~/g;
const starItalicPattern = /(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])/g;
const underscoreItalicPattern = /(?<![\w_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w_])/g;
/** Code and links are set aside before emphasis runs; the marker is a character no reply carries. */
const heldPattern = /(\d+)/g;
const ruleText = "──────";

export function toTelegramHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = fencePattern.exec(line);
    if (fence) {
      const closing = (fence[1] ?? "```").charAt(0).repeat(3);
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith(closing)) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      out.push(pre(body.join("\n"), fence[2] ?? ""));
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
        quoted.push(inline(found[1] ?? ""));
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
  let openFence: string | null = null;
  for (const original of chunks) {
    const reopened = openFence;
    for (const line of original.split("\n")) {
      if (fencePattern.test(line)) openFence = openFence === null ? line.trim() : null;
    }
    let chunk = reopened === null ? original : `${reopened}\n${original}`;
    if (openFence !== null) chunk += `\n${openFence.charAt(0).repeat(3)}`;
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
  if (heading) return `<b>${inline(heading[1] ?? "")}</b>`;
  if (rulePattern.test(line)) return ruleText;
  const bullet = bulletPattern.exec(line);
  if (bullet) return `${bullet[1] ?? ""}• ${inline(bullet[2] ?? "")}`;
  return inline(line);
}

function inline(source: string): string {
  const held: string[] = [];
  const hold = (markup: string): string => {
    held.push(markup);
    return `${String(held.length - 1)}`;
  };
  let text = source.replace(codeSpanPattern, (_match, _ticks: string, code: string) =>
    hold(`<code>${escapeHtml(code)}</code>`),
  );
  text = text.replace(linkPattern, (_match, label: string, url: string) =>
    hold(`<a href="${escapeAttribute(url)}">${escapeHtml(label)}</a>`),
  );
  text = escapeHtml(text);
  text = text.replace(boldPattern, "<b>$1</b>");
  text = text.replace(strikePattern, "<s>$1</s>");
  text = text.replace(starItalicPattern, "<i>$1</i>");
  text = text.replace(underscoreItalicPattern, "<i>$1</i>");
  return text.replace(heldPattern, (_match, position: string) => held[Number(position)] ?? "");
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

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}
