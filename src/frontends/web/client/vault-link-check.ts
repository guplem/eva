/**
 * A chat links a vault path by its shape alone, so the page asks the core which paths exist, and
 * drops the link of a missing one (#932). A tap on it would only open an error.
 */

/** Answers the paths of the list that exist. */
export type ExistingPaths = (paths: readonly string[]) => Promise<readonly string[]>;

/** The most paths that the core takes in one request. */
export const maxPathsPerAsk = 500;
/**
 * A live answer renders its links again on each token, so a missing path waits this long before
 * Eva asks again. A turn can create the file later, and a new answer then links it.
 */
export const missingAnswerMs = 10_000;

export interface MissingPathsCheck {
  /** The missing paths of the list. Asks the core about each path that it does not know now. */
  readonly missing: (paths: readonly string[]) => Promise<Set<string>>;
  /** The paths of the list known as missing now, with no request, so a new render hides them before it paints. */
  readonly knownMissing: (paths: readonly string[]) => Set<string>;
}

/**
 * An existing path stays known for the page's life. When the core does not answer, no path counts
 * as missing, and the next check asks again.
 */
export function missingPathsChecker(existing: ExistingPaths, now: () => number = Date.now): MissingPathsCheck {
  const found = new Set<string>();
  const missingSince = new Map<string, number>();
  const asking = new Map<string, Promise<void>>();
  const isKnownMissing = (path: string): boolean => {
    const since = missingSince.get(path);
    return since !== undefined && now() - since < missingAnswerMs;
  };
  const ask = (paths: readonly string[]): void => {
    const answer = existing(paths).then(
      (existingPaths) => {
        const exists = new Set(existingPaths);
        for (const path of paths) {
          if (exists.has(path)) {
            found.add(path);
            missingSince.delete(path);
          } else missingSince.set(path, now());
        }
      },
      () => undefined,
    );
    const done = answer.finally(() => {
      for (const path of paths) asking.delete(path);
    });
    for (const path of paths) asking.set(path, done);
  };
  const knownMissing = (paths: readonly string[]): Set<string> => new Set(paths.filter(isKnownMissing));
  return {
    knownMissing,
    missing: async (paths) => {
      const unknown = [...new Set(paths)].filter(
        (path) => !found.has(path) && !isKnownMissing(path) && !asking.has(path),
      );
      for (let start = 0; start < unknown.length; start += maxPathsPerAsk)
        ask(unknown.slice(start, start + maxPathsPerAsk));
      await Promise.all(paths.flatMap((path) => asking.get(path) ?? []));
      return knownMissing(paths);
    },
  };
}
