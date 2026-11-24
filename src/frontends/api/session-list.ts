/**
 * The session list that the web app fetches after each turn and on each reconnect, and the one
 * chat that it opens. The list holds no turns: a long history made it megabytes, and a slow
 * network then never finished the first load (#1046). The open chat reads its turns on its own.
 */
import { createHash } from "node:crypto";
import type { SessionRecord } from "../../core/sessions/session-store.ts";
import { turnsWithDetails } from "../../core/sessions/step-details-store.ts";

type Turn = SessionRecord["turns"][number];

/** Enough answers to scroll back through. An older answer shows its whole text, as one from before steps. */
export const recentTurnsWithSteps = turnsWithDetails;

/** The longest text of the last turn that the list keeps. A preview shows one short line. */
export const previewTextLimit = 600;

/** A chat of the list: its facts, with no turns. */
export type ListedSession = Omit<SessionRecord, "turns"> & {
  /** True while a turn runs. The store keeps no such field. */
  readonly running: boolean;
  readonly turnCount: number;
  /** The last turn with its long texts cut and no steps, for the preview. Null before the first turn. */
  readonly lastTurn: Turn | null;
  /** Changes with any change of the turns, so the page reads an open chat again only then. */
  readonly turnsKey: string;
};

/** One chat with its turns, as the open chat reads it. */
export type OpenedSession = ListedSession & { readonly turns: SessionRecord["turns"] };

/** A reload or a reconnect loses the events, so the list itself says which chats work now. */
export function listedSessions(
  sessions: readonly SessionRecord[],
  isRunning: (id: string) => boolean,
): ListedSession[] {
  return sessions.map((session) => listedSession(session, isRunning));
}

/** The chat with every turn. Only its recent turns keep their steps: the store keeps every step (issue 121). */
export function openedSession(
  session: SessionRecord,
  isRunning: (id: string) => boolean,
  recentTurns: number,
): OpenedSession {
  return { ...listedSession(session, isRunning), turns: withRecentSteps(session.turns, recentTurns) };
}

function listedSession(session: SessionRecord, isRunning: (id: string) => boolean): ListedSession {
  const { turns, ...facts } = session;
  const last = turns.at(-1);
  return {
    ...facts,
    running: isRunning(session.id),
    turnCount: turns.length,
    lastTurn: last === undefined ? null : shortTurn(last),
    turnsKey: turnsKeyOf(turns),
  };
}

function withRecentSteps(turns: SessionRecord["turns"], recentTurns: number): SessionRecord["turns"] {
  const firstKept = turns.length - recentTurns;
  if (firstKept <= 0) return turns;
  return turns.map((turn, index) => (index < firstKept ? { ...turn, steps: [], omittedSteps: 0 } : turn));
}

function shortTurn(turn: Turn): Turn {
  return {
    ...turn,
    userText: cut(turn.userText),
    answerText: cut(turn.answerText),
    personText: turn.personText === null ? null : cut(turn.personText),
    failure: turn.failure === null ? null : cut(turn.failure),
    projectReports: turn.projectReports.map((report) => ({
      ...report,
      request: cut(report.request),
      result: cut(report.result),
    })),
    steps: [],
    omittedSteps: 0,
    notes: [],
  };
}

function cut(text: string): string {
  return text.length > previewTextLimit ? text.slice(0, previewTextLimit) : text;
}

// The store replaces the turns array at each change, so its identity keys the hash.
const turnsKeys = new WeakMap<SessionRecord["turns"], string>();

/** A hash of the content, not a counter: a counter would start again after a restart and match an old key. */
function turnsKeyOf(turns: SessionRecord["turns"]): string {
  const known = turnsKeys.get(turns);
  if (known !== undefined) return known;
  const key = createHash("sha1").update(JSON.stringify(turns)).digest("hex").slice(0, 16);
  turnsKeys.set(turns, key);
  return key;
}
