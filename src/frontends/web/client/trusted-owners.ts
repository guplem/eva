/**
 * The owner list of the Trusted repositories section. Pure, so a test covers it without a browser.
 */

/** A GitHub login: letters, digits and single hyphens, at most 39 characters. */
const loginPattern = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/**
 * The list with one more owner, or the problem with what the person typed. A typed `@name` or a
 * pasted `https://github.com/name` gives the name.
 */
export function withOwner(
  owners: readonly string[],
  typed: string,
): { readonly owners: readonly string[] } | { readonly problem: string } {
  const owner = typed
    .trim()
    .replace(/^@/, "")
    .replace(/^(?:https?:\/\/)?github\.com\//i, "")
    .replace(/\/+$/, "");
  if (!loginPattern.test(owner)) return { problem: `${owner || "An empty name"} is not a GitHub account name.` };
  if (owners.some((each) => each.toLowerCase() === owner.toLowerCase())) {
    return { problem: `${owner} is in the list already.` };
  }
  return { owners: [...owners, owner] };
}

export function withoutOwner(owners: readonly string[], owner: string): readonly string[] {
  return owners.filter((each) => each !== owner);
}
