/**
 * The statuses of a project, from the `status` key of its `AGENTS.md`. They are stored names.
 * The web page reads them too, so this file holds data only.
 */

/**
 * The work on the project: `active` while the person works on it, `paused` while the work stops,
 * and `closed` when it ends. The `in-use` key says apart whether the person uses the project (#859).
 */
export const projectStatuses = ["active", "paused", "closed"] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

/**
 * The statuses of an older vault, and how Eva reads them (#859). A migration rewrites them in the
 * vault. A satellite that updates first, or a project in an extra root, can still hold them.
 */
export const oldProjectStatuses: Readonly<Record<string, { readonly status: ProjectStatus; readonly inUse: boolean }>> =
  {
    idea: { status: "paused", inUse: false },
    "in-use": { status: "closed", inUse: true },
  };

/**
 * A status filter: one status, `in-use` for the projects with the `in-use` flag, or `current` for
 * the projects that the person works on or uses now (#690, #859).
 */
export const projectStatusFilters = [...projectStatuses, "in-use", "current"] as const;
export type ProjectStatusFilter = (typeof projectStatusFilters)[number];
