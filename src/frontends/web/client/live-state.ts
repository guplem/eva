/** What the web UI learns from the event stream while turns run. */
export interface LiveState {
  /** Text that arrived for a running turn, by session id. */
  readonly streaming: Readonly<Record<string, string>>;
  /** Background tasks by task id. */
  readonly tasks: Readonly<Record<string, { description: string; state: string; sessionId: string }>>;
}
