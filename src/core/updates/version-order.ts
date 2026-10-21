/** Orders version numbers. It imports nothing, so the web client can use it too. */

/** True when `candidate` (such as `v0.2.0` or `0.2.0`) is a newer version than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (version: string): number[] =>
    version
      .replace(/^v/, "")
      .split("-")[0]
      ?.split(".")
      .map((part) => Number(part) || 0) ?? [];
  const next = parse(candidate);
  const now = parse(current);
  for (let index = 0; index < Math.max(next.length, now.length); index += 1) {
    const difference = (next[index] ?? 0) - (now[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}
