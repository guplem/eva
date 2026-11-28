/**
 * The git settings that Eva forces on her own git commands (#1131). They go into the environment
 * as `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>` and `GIT_CONFIG_VALUE_<n>`. These beat every config
 * file, and git passes them on to the git that it starts in a submodule, and so does `gh`.
 * `GIT_CONFIG_COUNT` needs git 2.31 or later. Older git ignores it.
 */

export type GitConfigEntry = readonly [key: string, value: string];

/**
 * The settings that name a program and that Eva can force for every git call, the vault's too,
 * with no loss for the person: Eva's git never needs a pager, an editor or an external diff.
 * A folder that a chat writes, such as a nested repository, can hold any of them.
 * A submodule's git runs in a folder that a chat can write, so Eva's git never enters one.
 * `dirty` still shows a submodule's new commit, and starts no git inside it.
 */
export const ownGitConfig: readonly GitConfigEntry[] = [
  ["core.fsmonitor", "false"],
  ["core.pager", "cat"],
  ["core.editor", ":"],
  ["sequence.editor", ":"],
  ["core.askPass", ""],
  ["core.alternateRefsCommand", ""],
  ["diff.external", ""],
  ["gc.recentObjectsHook", ""],
  ["diff.ignoreSubmodules", "dirty"],
  ["submodule.recurse", "false"],
  ["status.submoduleSummary", "false"],
  ["fetch.recurseSubmodules", "false"],
  ["push.recurseSubmodules", "no"],
];

/** The variables that beat the matching config settings, for the same reason. */
export const ownGitVariables: Readonly<Record<string, string>> = {
  GIT_PAGER: "cat",
  GIT_EDITOR: ":",
  GIT_SEQUENCE_EDITOR: ":",
};

/**
 * The environment with `entries` added after the `GIT_CONFIG_*` settings that it already holds.
 * A later entry wins over an earlier one with the same key.
 */
export function withGitConfig(
  environment: Readonly<Record<string, string>>,
  entries: readonly GitConfigEntry[],
): Record<string, string> {
  const count = Number.parseInt(environment["GIT_CONFIG_COUNT"] ?? "0", 10);
  const start = Number.isSafeInteger(count) && count > 0 ? count : 0;
  const result: Record<string, string> = { ...environment };
  entries.forEach(([key, value], index) => {
    result[`GIT_CONFIG_KEY_${String(start + index)}`] = key;
    result[`GIT_CONFIG_VALUE_${String(start + index)}`] = value;
  });
  result["GIT_CONFIG_COUNT"] = String(start + entries.length);
  return result;
}
