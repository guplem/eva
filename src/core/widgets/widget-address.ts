/**
 * The address of a widget repository (#691). The person pastes it in any common form, and Eva
 * keeps one form: `https://github.com/<owner>/<name>`. The id is the slug in lower case, because
 * GitHub ignores the case of a name, and Windows ignores the case of a folder.
 */
import { githubSlug } from "../projects/clones.ts";

export interface WidgetAddress {
  /** `owner/name` in lower case: the key of the widget in each store and in each route. */
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  /** `https://github.com/<owner>/<name>`, as the person wrote the names. */
  readonly url: string;
}

/** The address of a GitHub repository, or null for any other text. */
export function widgetAddress(text: string): WidgetAddress | null {
  const trimmed = text.trim();
  // `owner/name` and `github.com/owner/name` are what a person copies from a page most often.
  const full = /^[\w.-]+\/[\w.-]+$/.test(trimmed)
    ? `https://github.com/${trimmed}`
    : /^github\.com\//i.test(trimmed)
      ? `https://${trimmed}`
      : trimmed;
  const slug = githubSlug(full);
  if (slug === null) return null;
  const [owner = "", name = ""] = slug.split("/");
  // GitHub's own limits: an owner of 39 characters at most, which starts with a letter or a digit.
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) || name.length > 100) return null;
  return { id: slug.toLowerCase(), owner, name, url: `https://github.com/${owner}/${name}` };
}
