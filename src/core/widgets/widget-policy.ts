/**
 * The Content Security Policy of each widget answer, and the theme of `eva/theme.css` (#691).
 * Eva builds the policy from the approved record, never from the manifest, so a manifest that
 * changed after the approval gives the widget no new host.
 */

/** The colour variables of the contract (`docs/widgets.md`). A later contract keeps them. */
export const themeVariables = [
  "--bg",
  "--panel",
  "--ink",
  "--muted",
  "--line",
  "--chip",
  "--accent",
  "--accent-ink",
  "--on-accent",
  "--soft",
  "--soft-ink",
  "--ok",
  "--ok-bg",
  "--warn",
  "--warn-bg",
  "--bad",
  "--bad-bg",
] as const;

export type ThemeVariable = (typeof themeVariables)[number];

export interface WidgetTheme {
  readonly scheme: "light" | "dark";
  readonly colors: Readonly<Partial<Record<ThemeVariable, string>>>;
}

/**
 * A colour as a browser computes it, such as `oklch(0.97 0.008 245.1)` or `#f1f6fb`: only these
 * characters, only the words of a colour function, and no `//` or `/*`. So a value never loads a
 * file, such as `url(//host/x)`, and never leaves its declaration.
 */
const colourCharacters = /^[#a-zA-Z0-9 ().,%/*+-]{1,120}$/;
const colourWords: ReadonlySet<string> = new Set([
  "oklch",
  "oklab",
  "lch",
  "lab",
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "color",
  "srgb",
  "calc",
  "min",
  "max",
  "clamp",
  "none",
  "transparent",
  "deg",
]);

function isColour(value: string): boolean {
  if (!colourCharacters.test(value) || value.includes("//") || value.includes("/*") || value.includes("*/"))
    return false;
  // A hex colour and a number hold letters too, such as `#ffaa00` or `0.5e-3`: only the words count.
  const words = value.replace(/#[0-9a-f]+/gi, " ").match(/[a-z]+/gi) ?? [];
  return words.every((word) => colourWords.has(word.toLowerCase()) || /^e$/i.test(word));
}

/** The theme of a page, with each value that is not a plain colour left out. */
export function widgetTheme(scheme: "light" | "dark", colors: Readonly<Record<string, string>>): WidgetTheme {
  const kept: Partial<Record<ThemeVariable, string>> = {};
  for (const name of themeVariables) {
    const value = colors[name]?.trim();
    if (value !== undefined && isColour(value)) kept[name] = value;
  }
  return { scheme, colors: kept };
}

/** The text of `eva/theme.css`. It sets the mode too, for a browser that does not pass Eva's mode to the frame. */
export function themeCss(theme: WidgetTheme): string {
  const lines = themeVariables.flatMap((name) => {
    const value = theme.colors[name];
    return value === undefined ? [] : [`  ${name}: ${value};`];
  });
  return `:root {\n  color-scheme: ${theme.scheme};\n${lines.join("\n")}\n}\n`;
}

/**
 * The policy of one answer. `base` is the token path, such as `http://127.0.0.1:7420/widgets/<token>/`;
 * `frameAncestor` is Eva's own origin. `sandbox` keeps a widget without an origin, and so without a
 * cookie, even when its address opens in a tab of its own.
 */
export function widgetPolicy(base: string, frameAncestor: string, hosts: readonly string[]): string {
  const outside = hosts.join(" ");
  const withHosts = (sources: string): string => (outside === "" ? sources : `${sources} ${outside}`);
  return [
    "sandbox allow-scripts",
    `default-src ${base}`,
    `script-src ${base}`,
    `style-src ${base}`,
    `font-src ${base}`,
    `connect-src ${withHosts(base)}`,
    `img-src ${withHosts(`${base} data: blob:`)}`,
    `media-src ${withHosts(base)}`,
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestor}`,
  ].join("; ");
}
