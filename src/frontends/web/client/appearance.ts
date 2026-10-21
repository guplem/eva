/**
 * Each browser keeps its own theme, density, seed colour, files view and cut of long file names in
 * `localStorage`. A phone and a desktop need different density, so the vault keeps none of them.
 */
export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";
/** The part of a long file name that gives way to "…" when the name does not fit on one line. */
export type FileNameCut = "start" | "middle" | "end";
/** "columns" shows each folder of the path, as a Finder does. "single" shows one folder at a time, as Windows does. */
export type FilesView = "columns" | "single";

export interface Appearance {
  readonly theme: Theme;
  readonly density: Density;
  /** The colour that every other colour of the page comes from, as `#rrggbb`. */
  readonly seed: string;
  readonly fileNameCut: FileNameCut;
  readonly filesView: FilesView;
}

export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

/** EVE blue. */
export const defaultSeed = "#2aa8ff";

/** The seeds of the design guide, in the order of its palette picker. */
export const seedColours: readonly { readonly name: string; readonly hex: string }[] = [
  { name: "EVE blue", hex: defaultSeed },
  { name: "Cyan", hex: "#11c5d9" },
  { name: "Teal", hex: "#14b8a6" },
  { name: "Mint", hex: "#34d399" },
  { name: "Leaf", hex: "#4caf50" },
  { name: "Lime", hex: "#a3d82b" },
  { name: "Sun", hex: "#f7c600" },
  { name: "Amber", hex: "#ff9f1a" },
  { name: "Coral", hex: "#ff6f59" },
  { name: "Red", hex: "#e5484d" },
  { name: "Pink", hex: "#ff5ca8" },
  { name: "Magenta", hex: "#d63bd9" },
  { name: "Violet", hex: "#8b5cf6" },
  { name: "Indigo", hex: "#5468ff" },
  { name: "Graphite", hex: "#6b7a90" },
];

const storageKey = "eva.appearance";
const defaultAppearance: Appearance = {
  theme: "system",
  density: "comfortable",
  seed: defaultSeed,
  fileNameCut: "middle",
  filesView: "columns",
};

/** A private window or blocked storage throws or holds nothing: the page then uses the defaults. */
export function readAppearance(): Appearance {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Partial<Record<string, unknown>>;
    const seed = stored["seed"];
    const cut = stored["fileNameCut"];
    return {
      theme: stored["theme"] === "light" || stored["theme"] === "dark" ? stored["theme"] : defaultAppearance.theme,
      density: stored["density"] === "compact" ? "compact" : defaultAppearance.density,
      seed: typeof seed === "string" && /^#[0-9a-f]{6}$/i.test(seed) ? seed.toLowerCase() : defaultAppearance.seed,
      fileNameCut: cut === "start" || cut === "end" ? cut : defaultAppearance.fileNameCut,
      filesView: stored["filesView"] === "single" ? "single" : defaultAppearance.filesView,
    };
  } catch {
    return defaultAppearance;
  }
}

export function saveAppearance(appearance: Appearance): void {
  applyAppearance(appearance);
  try {
    localStorage.setItem(storageKey, JSON.stringify(appearance));
  } catch {
    // The choice still applies until the page reloads.
  }
}

/** `styles.css` reads these attributes and the seed variables; "system" leaves the theme to the system. */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  if (appearance.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", appearance.theme);
  root.setAttribute("data-density", appearance.density);
  root.setAttribute("data-file-name-cut", appearance.fileNameCut);
  root.setAttribute("data-files-view", appearance.filesView);
  for (const [name, value] of Object.entries(seedVariables(appearance.seed))) root.style.setProperty(name, value);
  // The phone's browser bar takes its colour from these tags, so they follow the theme and the seed too.
  const colours = themeColours(appearance.seed);
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.dataset["media"] ??= meta.media;
    const media = meta.dataset["media"];
    meta.content = media.includes("dark") ? colours.dark : colours.light;
    const own = media.includes(appearance.theme);
    meta.media = appearance.theme === "system" ? media : own ? "all" : "not all";
  }
}

/** The name of a seed from the picker, or the code of any other colour. */
export function seedName(seed: string): string {
  return seedColours.find((colour) => colour.hex === seed.toLowerCase())?.name ?? seed.toUpperCase();
}

/**
 * The seed numbers that every token in `styles.css` uses. The clamps keep each seed readable:
 * a pale or a very dark seed still gives an accent with enough contrast.
 */
export function seedVariables(seed: string): Record<"--h" | "--c" | "--l" | "--on-l", string> {
  const { l, c, h } = hexToOklch(seed);
  return {
    "--h": h.toFixed(1),
    "--c": Math.min(c, 0.2).toFixed(3),
    "--l": Math.min(Math.max(l, 0.45), 0.9).toFixed(3),
    "--on-l": l > 0.72 ? "0.2" : "1",
  };
}

/** `--bg` of each theme as hex: some browsers do not read `oklch()` in a `theme-color` tag. */
export function themeColours(seed: string): { readonly light: string; readonly dark: string } {
  const { h } = hexToOklch(seed);
  return { light: oklchToHex({ l: 0.972, c: 0.008, h }), dark: oklchToHex({ l: 0.16, c: 0.02, h }) };
}

/** sRGB to OKLCH, with Björn Ottosson's matrices, as `hexToOklch` in the design reference. */
export function hexToOklch(hex: string): Oklch {
  const n = Number.parseInt(hex.slice(1), 16);
  const linear = (channel: number): number => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = linear((n >> 16) & 255);
  const g = linear((n >> 8) & 255);
  const b = linear(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(bAxis, a) * 180) / Math.PI;
  return { l: lightness, c: Math.hypot(a, bAxis), h: hue < 0 ? hue + 360 : hue };
}

/** OKLCH to sRGB hex. A colour outside sRGB clips to its nearest edge. */
export function oklchToHex({ l, c, h }: Oklch): string {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lCone = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCone = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCone = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone,
    -1.2684380046 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone,
    -0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone,
  ];
  const channel = (v: number): string => {
    const clipped = Math.min(Math.max(v, 0), 1);
    const encoded = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${linear.map(channel).join("")}`;
}
