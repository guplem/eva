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
 * A colour as a browser computes it, such as `oklch(0.97 0.008 245.1)` or `#f1f6fb`. No `:`, so
 * no `url(https:...)`; no `;`, braces, quotes or backslash, so a value never leaves its declaration.
 */
const colourValue = /^[#a-zA-Z0-9 ().,%/*+-]{1,120}$/;

/** The theme of a page, with each value that is not a plain colour left out. */
export function widgetTheme(scheme: "light" | "dark", colors: Readonly<Record<string, string>>): WidgetTheme {
  const kept: Partial<Record<ThemeVariable, string>> = {};
  for (const name of themeVariables) {
    const value = colors[name]?.trim();
    if (value !== undefined && colourValue.test(value)) kept[name] = value;
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
