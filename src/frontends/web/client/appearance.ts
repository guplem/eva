/**
 * Each browser keeps its own theme and density in `localStorage`. A phone and a desktop need
 * different density, so the vault keeps neither.
 */
export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";

export interface Appearance {
  readonly theme: Theme;
  readonly density: Density;
}

const storageKey = "eva.appearance";
const defaultAppearance: Appearance = { theme: "system", density: "comfortable" };

/** A private window or blocked storage throws or holds nothing: the page then uses the defaults. */
export function readAppearance(): Appearance {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Partial<Record<string, unknown>>;
    return {
      theme: stored["theme"] === "light" || stored["theme"] === "dark" ? stored["theme"] : defaultAppearance.theme,
      density: stored["density"] === "compact" ? "compact" : defaultAppearance.density,
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

/** `styles.css` reads these attributes; "system" leaves the theme to the system's setting. */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  if (appearance.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", appearance.theme);
  root.setAttribute("data-density", appearance.density);
  // The phone's browser bar takes its color from these tags, so they follow the chosen theme too.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.dataset["media"] ??= meta.media;
    const own = meta.dataset["media"].includes(appearance.theme);
    meta.media = appearance.theme === "system" ? meta.dataset["media"] : own ? "all" : "not all";
  }
}
