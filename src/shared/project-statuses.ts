/**
 * The statuses of a project, from the `status` key of its `AGENTS.md`. They are stored names.
 * The web page reads them too, so this file holds data only.
 */

/** `active`: the person develops the project. `in-use`: the person uses it now, such as for the week's menus. */
export const projectStatuses = ["idea", "active", "in-use", "paused", "closed"] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

/** A status filter: one status, or `current` for the projects that the person develops or uses now (#690). */
export const projectStatusFilters = [...projectStatuses, "current"] as const;
export type ProjectStatusFilter = (typeof projectStatusFilters)[number];
