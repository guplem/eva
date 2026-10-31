/**
 * The plain secret files in a list of commits (#707). A push sends every commit, so each commit
 * counts, not only the last: a later commit can hold the same file encrypted. The vault sync checks
 * the unpushed commits, and the first push of a local vault checks its whole history.
 */
export type GitRun = (args: readonly string[]) => Promise<{ readonly exitCode: number; readonly stdout: string }>;

/**
 * Each path that some commit of `range` holds as a plain secret. `onRemote` names a file version
 * that the remote holds already, which leaks nothing new. Null when git cannot say, so a push waits.
 */
export async function plainSecretsIn(
  git: GitRun,
  range: string,
  isPlainSecret: (path: string, bytes: Uint8Array) => boolean,
  onRemote: (commit: string, path: string) => Promise<boolean> = () => Promise.resolve(false),
): Promise<string[] | null> {
  const commits = await git(["rev-list", range]);
  if (commits.exitCode !== 0) return null;
  const plain = new Set<string>();
  for (const commit of commits.stdout.split("\n").filter((sha) => sha !== "")) {
    // `-m` lists a merge's files against each parent, so a merge hides nothing. `--root` lists a first commit's files.
    const changed = await git([
      "diff-tree",
      "-r",
      "-m",
      "--root",
      "--no-commit-id",
      "--name-only",
      "--no-renames",
      "-z",
      commit,
    ]);
    if (changed.exitCode !== 0) return null;
    for (const path of new Set(changed.stdout.split("\0").filter((name) => name !== ""))) {
      const blob = await git(["show", `${commit}:${path}`]);
      // A deleted file is in no tree of that commit.
      if (blob.exitCode !== 0 || !isPlainSecret(path, new TextEncoder().encode(blob.stdout))) continue;
      if (!(await onRemote(commit, path))) plain.add(path);
    }
  }
  return [...plain];
}
