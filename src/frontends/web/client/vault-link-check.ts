/**
 * A chat links a vault path by its shape alone, so the page asks the core which paths exist, and
 * drops the link of a missing one (#932). A tap on it would only open an error.
 */

/** Answers the paths of the list that exist. */
export type ExistingPaths = (paths: readonly string[]) => Promise<readonly string[]>;

/**
 * A check that answers the missing paths of a list. It asks the core once for each path and
 * keeps the answer for the page's life: a live answer renders its links again on each token.
 * When the core does not answer, no path counts as missing, and the next check asks again.
 */
export function missingPathsChecker(existing: ExistingPaths): (paths: readonly string[]) => Promise<Set<string>> {
  const known = new Map<string, Promise<boolean>>();
  return async (paths) => {
    const unknown = [...new Set(paths)].filter((path) => !known.has(path));
    if (unknown.length > 0) {
      const answer = existing(unknown).then((found) => new Set(found));
      for (const path of unknown) {
        known.set(
          path,
          answer.then(
            (found) => found.has(path),
            () => {
              known.delete(path);
              return true;
            },
          ),
        );
      }
    }
    const found = await Promise.all(paths.map(async (path) => [path, await known.get(path)] as const));
    return new Set(found.filter(([, exists]) => exists === false).map(([path]) => path));
  };
}
