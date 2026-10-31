/**
 * The look of each file in a folder list: a small badge with the type of the file, and the two
 * ends of its name, so a long name can lose its start, its middle or its end.
 */

/** Each tone is a `--type-*` token in `styles.css`. "plain" is the quiet colour of other files. */
export type FileTone = "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "violet" | "pink" | "plain";

export interface FileBadge {
  /** The extension in capitals, as "PDF". */
  readonly label: string;
  readonly tone: FileTone;
}

/** The colours that people know from the apps of these types, such as a red PDF and a green sheet. */
const tones: Readonly<Record<string, FileTone>> = {
  pdf: "red",
  md: "violet",
  mdx: "violet",
  doc: "blue",
  docx: "blue",
  odt: "blue",
  rtf: "blue",
  xls: "green",
  xlsx: "green",
  ods: "green",
  csv: "green",
  tsv: "green",
  ppt: "orange",
  pptx: "orange",
  odp: "orange",
  key: "orange",
  html: "orange",
  htm: "orange",
  js: "yellow",
  mjs: "yellow",
  cjs: "yellow",
  jsx: "yellow",
  json: "yellow",
  ts: "blue",
  tsx: "blue",
  py: "blue",
  css: "teal",
  scss: "teal",
  go: "teal",
  sh: "green",
  ps1: "blue",
  png: "pink",
  jpg: "pink",
  jpeg: "pink",
  gif: "pink",
  svg: "pink",
  webp: "pink",
  heic: "pink",
  mp3: "teal",
  wav: "teal",
  m4a: "teal",
  mp4: "teal",
  mov: "teal",
  webm: "teal",
};

/** A longer extension does not fit in the badge. */
const longestLabel = 4;

/** The badge of a file, or null for a name with no short extension, such as "Makefile". */
export function fileBadgeOf(name: string): FileBadge | null {
  const dot = name.lastIndexOf(".");
  const extension = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
  if (extension === "" || extension.length > longestLabel) return null;
  return { label: extension.toUpperCase(), tone: tones[extension] ?? "plain" };
}

/** The letters before the extension that the tail keeps, so a cut name still shows how it ends. */
const tailLetters = 8;

/**
 * Splits a name in two parts. A cut in the middle shortens only the head, so the tail and the
 * extension stay. A dot at the start, as in ".env", is no extension.
 */
export function nameEnds(name: string): { readonly head: string; readonly tail: string } {
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.length - dot : 0;
  const kept = Math.min(extension + tailLetters, Math.floor(name.length / 2));
  return { head: name.slice(0, name.length - kept), tail: name.slice(name.length - kept) };
}

export interface Media {
  readonly kind: "image" | "audio" | "video";
  /** The MIME type that the browser needs to show the bytes. */
  readonly type: string;
}

/**
 * The formats that every current browser shows by itself. A PDF stays out: most phone browsers do
 * not show one inside a page. An SVG stays out too: Eva shows it as text.
 */
const media: Readonly<Record<string, Media>> = {
  png: { kind: "image", type: "image/png" },
  jpg: { kind: "image", type: "image/jpeg" },
  jpeg: { kind: "image", type: "image/jpeg" },
  gif: { kind: "image", type: "image/gif" },
  webp: { kind: "image", type: "image/webp" },
  avif: { kind: "image", type: "image/avif" },
  bmp: { kind: "image", type: "image/bmp" },
  ico: { kind: "image", type: "image/x-icon" },
  mp3: { kind: "audio", type: "audio/mpeg" },
  wav: { kind: "audio", type: "audio/wav" },
  ogg: { kind: "audio", type: "audio/ogg" },
  opus: { kind: "audio", type: "audio/ogg" },
  m4a: { kind: "audio", type: "audio/mp4" },
  aac: { kind: "audio", type: "audio/aac" },
  flac: { kind: "audio", type: "audio/flac" },
  mp4: { kind: "video", type: "video/mp4" },
  m4v: { kind: "video", type: "video/mp4" },
  webm: { kind: "video", type: "video/webm" },
  mov: { kind: "video", type: "video/quicktime" },
};

/** The media of a file that the page can show, or null for any other file. */
export function mediaOf(name: string): Media | null {
  const dot = name.lastIndexOf(".");
  const start = name.lastIndexOf("/") + 1;
  // A dot at the start of the name, as in ".png", is no extension.
  if (dot <= start) return null;
  return media[name.slice(dot + 1).toLowerCase()] ?? null;
}
