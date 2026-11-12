/**
 * The repository list of the vault step (#919): the person searches their GitHub repositories by
 * name. A repository with the default name of a new vault comes first, and the step picks it already.
 */
import type { GitHubRepository } from "./api.ts";

/** The repository name that a new vault gets. */
export const defaultVaultRepository = "vault";

function hasDefaultName(repository: GitHubRepository): boolean {
  // The name without the owner: an account named "vault" holds other repositories too.
  return repository.fullName.split("/").at(-1)?.toLowerCase() === defaultVaultRepository;
}

/** The repositories with the default name first. The others keep their order, pushed most recently first. */
export function vaultFirst(repositories: readonly GitHubRepository[]): GitHubRepository[] {
  return [...repositories.filter(hasDefaultName), ...repositories.filter((each) => !hasDefaultName(each))];
}

/** The repository that the step picks before the person does, or null. */
export function firstVaultMatch(repositories: readonly GitHubRepository[]): GitHubRepository | null {
  return repositories.find(hasDefaultName) ?? null;
}

function searchText(search: string): string {
  // GitHub's copied clone text ends in .git.
  return search
    .trim()
    .toLowerCase()
    .replace(/\.git$/, "");
}

/** The repositories whose full name holds the search, in any case. An empty search shows them all. */
export function matchingRepositories(repositories: readonly GitHubRepository[], search: string): GitHubRepository[] {
  const text = searchText(search);
  return repositories.filter((each) => each.fullName.toLowerCase().includes(text));
}

/**
 * What "Use this vault" clones: the picked repository while the search shows it, else the only match.
 * When no listed repository matches, the typed text is a name or an address, such as `you/vault`.
 * Empty when the person must still pick.
 */
export function chosenRepository(shown: readonly GitHubRepository[], picked: string | null, search: string): string {
  const visible = shown.find((each) => each.cloneUrl === picked);
  if (visible !== undefined) return visible.cloneUrl;
  if (shown.length === 1) return shown[0]?.cloneUrl ?? "";
  return shown.length === 0 ? search.trim() : "";
}
