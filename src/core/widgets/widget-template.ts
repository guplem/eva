/**
 * The template of a new widget repository: the files of `templates/widget/` (#688). Eva pushes
 * them as the first commit of the repository. The template on disk is a working widget with
 * example names, so its own checks pass; Eva puts the names of the new repository in their place.
 */
import { readWidgetTemplate } from "./widget-template-files.ts" with { type: "macro" };

const templateFiles: Readonly<Record<string, string>> = readWidgetTemplate();
const manifestNameLimit = 60;

export interface WidgetNames {
  /** The GitHub account of the repository, such as `you`. */
  readonly owner: string;
  /** The repository name, such as `habits-widget`. */
  readonly repository: string;
  /** The title of the project, for the widget's name and headings. */
  readonly title: string;
}

/** Each file of the template, by its path from the repository root, with the names filled in. */
export function widgetTemplate(names: WidgetNames): Record<string, string> {
  return Object.fromEntries(Object.entries(templateFiles).map(([path, text]) => [path, fillNames(path, text, names)]));
}

function fillNames(path: string, text: string, names: WidgetNames): string {
  // The manifest keeps a name of 60 characters at most (docs/widgets/manifest-v1.json). The JSON Schema
  // counts code points, as Array.from does.
  const name =
    path === "eva-widget.json" ? Array.from(names.title).slice(0, manifestNameLimit).join("").trim() : names.title;
  const title = path.endsWith(".json")
    ? JSON.stringify(name).slice(1, -1)
    : path.endsWith(".html")
      ? escapeHtml(name)
      : name;
  // A function, so a "$" in a name is never read as a pattern of the replacement.
  return (
    text
      // GitHub Pages serves an account at its name in lower case.
      .replaceAll("example-owner.github.io", () => `${names.owner.toLowerCase()}.github.io`)
      .replaceAll("example-owner", () => names.owner)
      .replaceAll("example-widget", () => names.repository)
      .replaceAll("Example widget", () => title)
  );
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
