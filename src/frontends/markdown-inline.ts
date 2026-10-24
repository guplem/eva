/**
 * Turns the inline Markdown of one line into HTML: code spans, links, bold, italic and strike.
 * Telegram and the web app both use it, so a reply reads the same on each front end. It
 * escapes all text and adds only its own tags, so its output is safe to put in a page.
 */

const codeSpanPattern = /(`+)(.+?)\1/g;
/** One level of parentheses may sit in the URL, as in a Wikipedia link; the first unmatched ")" ends it. */
const linkPattern = /\[([^\]\n]+)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/g;
const boldPattern = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
const strikePattern = /~~(?=\S)(.+?)(?<=\S)~~/g;
const starItalicPattern = /(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])/g;
const underscoreItalicPattern = /(?<![\w_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w_])/g;
/** Code and links are set aside before emphasis runs; the marker is a character no reply carries. */
const heldPattern = /(\d+)/g;

export function inlineHtml(source: string): string {
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

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}
