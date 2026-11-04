/**
 * The facts of a project card: each key of the front matter, known or not, in a form that a
 * person reads at a glance (#866). The front matter has no fixed form, so each value falls back
 * to plain text, and a broken value never breaks the card.
 */
import type { Project } from "./api.ts";
import { projectTypeLabel } from "./project-format.ts";
import { clockTime, zonedClockTime, type Clock } from "../../../shared/time-format.ts";

export interface FactFormat {
  /** No locale: the language of the browser. */
  readonly locale?: string | undefined;
  readonly clock: Clock | null;
}

export interface FactLink {
  readonly href: string;
  /** What the link is, such as "GitHub", or the host for a site that Eva does not know. */
  readonly site: string;
  /** The text of a Markdown link, or a short path. Empty for the home page of the site. */
  readonly label: string;
}

/** A piece of a text. A piece with `href` is an address in the text. */
export interface TextPart {
  readonly text: string;
  readonly href?: string;
}

export type FactValue =
  | { readonly kind: "text"; readonly parts: readonly TextPart[] }
  | { readonly kind: "date"; readonly text: string; readonly raw: string }
  | { readonly kind: "link"; readonly link: FactLink }
  | { readonly kind: "list"; readonly items: readonly FactValue[] }
  | { readonly kind: "map"; readonly facts: readonly Fact[] };

export interface Fact {
  readonly key: string;
  readonly label: string;
  readonly value: FactValue;
}

/** Short forms that read better in capitals. */
const shortForms: Readonly<Record<string, string>> = {
  id: "ID",
  ids: "IDs",
  url: "URL",
  urls: "URLs",
  api: "API",
  ui: "UI",
  ux: "UX",
  ai: "AI",
  pr: "PR",
  cli: "CLI",
  sdk: "SDK",
  mvp: "MVP",
  seo: "SEO",
  faq: "FAQ",
  kpi: "KPI",
  okr: "OKR",
  eta: "ETA",
};

/** "next_step", "release-date" and "lastReview" as "Next step", "Release date" and "Last review". */
export function keyLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter((word) => word !== "");
  if (words.length === 0) return key;
  const tidy = words.map((word) => {
    const short = shortForms[word.toLowerCase()];
    if (short !== undefined) return short;
    // A word in capitals is a name or a short form that the person chose.
    return word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word) ? word : word.toLowerCase();
  });
  const first = tidy[0] ?? "";
  return [first.charAt(0).toUpperCase() + first.slice(1), ...tidy.slice(1)].join(" ");
}

/**
 * Sites by the end of their host. `pages` marks a site where each subdomain is a page of its own,
 * so the label keeps the subdomain.
 */
const sites: readonly { readonly host: string; readonly name: string; readonly pages?: true }[] = [
  { host: "github.io", name: "GitHub Pages", pages: true },
  { host: "github.com", name: "GitHub" },
  { host: "gist.github.com", name: "GitHub Gist" },
  { host: "gitlab.com", name: "GitLab" },
  { host: "bitbucket.org", name: "Bitbucket" },
  { host: "figma.com", name: "Figma" },
  { host: "notion.so", name: "Notion" },
  { host: "notion.site", name: "Notion", pages: true },
  { host: "docs.google.com", name: "Google Docs" },
  { host: "drive.google.com", name: "Google Drive" },
  { host: "play.google.com", name: "Google Play" },
  { host: "apps.apple.com", name: "App Store" },
  { host: "youtube.com", name: "YouTube" },
  { host: "youtu.be", name: "YouTube" },
  { host: "x.com", name: "X" },
  { host: "twitter.com", name: "X" },
  { host: "linkedin.com", name: "LinkedIn" },
  { host: "itch.io", name: "itch.io", pages: true },
  { host: "store.steampowered.com", name: "Steam" },
  { host: "npmjs.com", name: "npm" },
  { host: "pypi.org", name: "PyPI" },
  { host: "vercel.app", name: "Vercel", pages: true },
  { host: "netlify.app", name: "Netlify", pages: true },
  { host: "linear.app", name: "Linear" },
  { host: "trello.com", name: "Trello" },
  { host: "discord.gg", name: "Discord" },
  { host: "discord.com", name: "Discord" },
  { host: "wikipedia.org", name: "Wikipedia" },
  { host: "reddit.com", name: "Reddit" },
  { host: "medium.com", name: "Medium" },
];

/** The most characters of a link label. */
const labelLength = 40;

function shortLabel(text: string): string {
  return text.length <= labelLength ? text : `${text.slice(0, labelLength - 1)}…`;
}

/** The link of a web address. Only `http` and `https` open, so a value never runs a script. */
function webLink(href: string, text: string | null): FactLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  // The longest match wins, so `gist.github.com` is not GitHub.
  const site = [...sites]
    .sort((first, second) => second.host.length - first.host.length)
    .find((each) => host === each.host || host.endsWith(`.${each.host}`));
  // A query or a fragment can hold a token, so the label shows only the path.
  let path = url.pathname.replace(/^\/+|\/+$/g, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    // A broken escape stays as it is.
  }
  const subdomain = site?.pages === true && host !== site.host ? host.slice(0, -site.host.length - 1) : "";
  const label = text ?? [subdomain, path].filter((part) => part !== "").join("/");
  return { href, site: site?.name ?? host, label: shortLabel(label) };
}

const emailPattern = /^(?:mailto:)?([^\s@<>()[\]]+@[^\s@<>()[\]]+\.[a-z]{2,})$/i;

/** The link of a value that is only a link: a web address, a Markdown link or an e-mail address. */
export function linkOf(value: string): FactLink | null {
  const text = value.trim();
  const markdown = /^\[([^\]]+)\]\(\s*<?([^\s>]+)>?\s*\)$/.exec(text);
  if (markdown !== null) return webLink(markdown[2] ?? "", (markdown[1] ?? "").trim());
  if (/^https?:\/\/\S+$/i.test(text)) return webLink(text, null);
  if (/^www\.\S+$/i.test(text)) return webLink(`https://${text}`, null);
  const email = emailPattern.exec(text);
  if (email !== null) return { href: `mailto:${email[1] ?? ""}`, site: "E-mail", label: email[1] ?? "" };
  return null;
}

/** An address in a text. It ends before a closing mark, such as the dot of a sentence. */
const addressInText = /https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]/gi;

function textParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(addressInText)) {
    const start = match.index;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: match[0], href: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

function plain(text: string): FactValue {
  return { kind: "text", parts: [{ text }] };
}

/** True for a real day of the calendar, such as `2024-02-29` but not `2026-02-30`. */
function realDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dayText(year: number, month: number, day: number, locale: string | undefined): string {
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const dayPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const monthPattern = /^(\d{4})-(\d{2})$/;
const timePattern = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/i;

/** A day, a month or a moment in a readable form, or null for any other text. */
function dateValue(text: string, format: FactFormat): FactValue | null {
  const day = dayPattern.exec(text);
  if (day !== null) {
    const [year, month, date] = [Number(day[1]), Number(day[2]), Number(day[3])];
    return realDay(year, month, date)
      ? { kind: "date", text: dayText(year, month, date, format.locale), raw: text }
      : null;
  }
  const month = monthPattern.exec(text);
  if (month !== null) {
    const [year, number] = [Number(month[1]), Number(month[2])];
    if (number < 1 || number > 12) return null;
    const words = new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString(format.locale, {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return { kind: "date", text: words, raw: text };
  }
  const time = timePattern.exec(text);
  if (time === null) return null;
  const [year, number, date, hour, minute] = [1, 2, 3, 4, 5].map((index) => Number(time[index]));
  if (!realDay(year ?? 0, number ?? 0, date ?? 0) || (hour ?? 0) > 23 || (minute ?? 0) > 59) return null;
  if (time[6] === undefined) {
    // With no zone, the person wrote the time of their own clock: it shows as written.
    const days = dayText(year ?? 0, number ?? 0, date ?? 0, format.locale);
    return { kind: "date", text: `${days}, ${clockTime(hour ?? 0, minute ?? 0, format.clock)}`, raw: text };
  }
  const moment = new Date(text.replace(" ", "T"));
  if (Number.isNaN(moment.getTime())) return null;
  const days = moment.toLocaleDateString(format.locale, { day: "numeric", month: "short", year: "numeric" });
  return { kind: "date", text: `${days}, ${zonedClockTime(moment, undefined, format.clock)}`, raw: text };
}

/** A value of the front matter in a readable form, or null for an empty value. */
export function factValue(value: unknown, format: FactFormat): FactValue | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const items = value.map((item) => factValue(item, format)).filter((item) => item !== null);
    return items.length === 0 ? null : { kind: "list", items };
  }
  if (typeof value === "object") {
    const facts = factsOf(Object.entries(value as Record<string, unknown>), format);
    return facts.length === 0 ? null : { kind: "map", facts };
  }
  if (typeof value === "boolean") return plain(value ? "Yes" : "No");
  if (typeof value === "number") return plain(String(value));
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return null;
  if (/^(true|false)$/i.test(text)) return plain(text.toLowerCase() === "true" ? "Yes" : "No");
  const date = dateValue(text, format);
  if (date !== null) return date;
  const link = linkOf(text);
  if (link !== null) return { kind: "link", link };
  return { kind: "text", parts: textParts(text) };
}

function factsOf(entries: readonly (readonly [string, unknown])[], format: FactFormat): Fact[] {
  return entries.flatMap(([key, raw]) => {
    const value = factValue(raw, format);
    return value === null ? [] : [{ key, label: keyLabel(key), value }];
  });
}

/** The keys that come first, in this order, when the file has them. */
const leadingKeys = ["started"];

/**
 * Each fact of the front matter, for the project card. The status and In use pills, the description
 * and the repository chips show `status`, `in-use`, `summary`, `repos` and `repo_types`, so the facts
 * leave them out (#859).
 */
export function frontMatterFacts(frontMatter: Project["frontMatter"], format: FactFormat): Fact[] {
  const extra = Object.entries(frontMatter.extra);
  const leading = leadingKeys.flatMap((key) => extra.filter(([each]) => each === key));
  const rest = extra.filter(([key]) => !leadingKeys.includes(key));
  return factsOf(
    [
      ["type", projectTypeLabel(frontMatter.type)],
      ["created", frontMatter.created],
      ...leading,
      ["closed", frontMatter.closed],
      ["tags", frontMatter.tags.map((tag) => `#${tag}`)],
      ...rest,
      ["legacy_id", frontMatter.legacyId],
      ["pinned", frontMatter.pinned],
    ],
    format,
  );
}
