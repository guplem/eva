/** The exit codes are a contract with the supervisor (lesson 89, docs/plan.md §4.3). */
export const exitCodes = {
  clean: 0,
  crash: 1,
  /** Bad config or bad arguments: a restart cannot help, so the supervisor never retries. */
  badConfig: 2,
  /** Another Eva already runs with this home: never retried. */
  secondInstance: 3,
  /** Restart to load a new version. */
  update: 4,
} as const;
