/**
 * Turns the inline Markdown of one line into HTML: code spans, links, bare URLs, bold, italic and strike.
 * Telegram and the web app both use it, so a reply reads the same on each front end. It
 * escapes all text and adds only its own tags, so its output is safe to put in a page.
 */

const codeSpanPattern = /(`+)(.+?)\1/g;
/** One level of parentheses may sit in the URL, as in a Wikipedia link; the first unmatched ")" ends it. */
const linkPattern = /\[([^\]\n]+)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/g;
/** A URL in angle brackets, the CommonMark autolink. */
const autolinkPattern = /<(https?:\/\/[^\s<>\uE000]+)>/g;
/** A bare URL runs to white space; `bareUrlEnd` then gives back the punctuation of the sentence. */
const bareUrlPattern = /(?<![A-Za-z\d])https?:\/\/[^\s<>"`\uE000]+/g;
/** Characters that end a sentence, a quote or emphasis around a URL. Agents also answer in other scripts. */
const trailingPunctuation = ".,:;!?'\"*_~…»›”’。、，！？：；）】」』";
/** A closing bracket stays in the URL only when it closes an opening one there, as in a Wikipedia link. */
const bracketPairs: Readonly<Record<string, string>> = { ")": "(", "]": "[" };
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
  text = text.replace(linkPattern, (_match, label: string, url: string) => hold(link(url, label)));
  text = text.replace(autolinkPattern, (_match, url: string) => hold(link(url, url)));
  text = text.replace(bareUrlPattern, (match) => {
    const url = match.slice(0, bareUrlEnd(match));
    // "https://." is punctuation after a bare scheme, not a URL.
    if (!/^https?:\/\/[^/?#]/.test(url)) return match;
    return hold(link(url, url)) + match.slice(url.length);
  });
  text = escapeHtml(text);
  text = text.replace(boldPattern, "<b>$1</b>");
  text = text.replace(strikePattern, "<s>$1</s>");
  text = text.replace(starItalicPattern, "<i>$1</i>");
  text = text.replace(underscoreItalicPattern, "<i>$1</i>");
  return text.replace(heldPattern, (_match, position: string) => held[Number(position)] ?? "");
}

function link(url: string, label: string): string {
  return `<a href="${escapeAttribute(url)}">${escapeHtml(label)}</a>`;
}

/**
 * The length of the URL without its trailing punctuation. It counts each bracket once and updates
 * the counts as it trims, so a long tail of punctuation costs linear time.
 */
function bareUrlEnd(url: string): number {
  const counts = new Map<string, number>();
  for (const character of url) counts.set(character, (counts.get(character) ?? 0) + 1);
  let end = url.length;
  for (;;) {
    const last = url.charAt(end - 1);
    const opening = bracketPairs[last];
    const unmatched = opening !== undefined && (counts.get(last) ?? 0) > (counts.get(opening) ?? 0);
    if (!trailingPunctuation.includes(last) && !unmatched) return end;
    counts.set(last, (counts.get(last) ?? 0) - 1);
    end -= 1;
  }
}

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}
