/**
 * The folder name of a repository in a clone. It reads no disk, so the web page names the same
 * folder as the core, such as for the Preview button of a widget repository (#693).
 */

/** The repository part of a git URL or path: `https://github.com/o/app.git` → `app`. */
export function repositoryName(url: string): string {
  const trimmed = url.replace(/[\\/]+$/, "").replace(/\.git$/, "");
  const parts = trimmed.split(/[\\/:]/);
  return parts[parts.length - 1] ?? trimmed;
}
