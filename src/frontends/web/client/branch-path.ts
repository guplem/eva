/**
 * A chat and its forks as paths. The page shows the path of one branch: the turns that it shares
 * with its parents, then its own. At each answer that has a fork, the person picks the branch that
 * continues after it. The branch map draws the whole tree as a small graph, one lane per branch.
 */

/** The parts of a session that the paths need. */
export interface BranchSession {
  readonly id: string;
  readonly parentId: string | null;
  /** The answer that the fork continues. Null for a chat, and for a fork that starts from the beginning. */
  readonly forkAtMessageId: string | null;
  readonly turns: readonly { readonly userText: string; readonly lastMessageId: string | null }[];
  readonly createdAt: string;
  readonly lastTurnAt: string | null;
}

/** One turn of a path, with the session that owns it, so Retry and Fork act on that session. */
export interface PathStep<S extends BranchSession> {
  readonly session: S;
  /** The index of the turn in its own session. */
  readonly index: number;
  readonly turn: S["turns"][number];
}

/** The branches that continue after a fork point, and the one that the shown path takes. */
export interface ForkPoint<S extends BranchSession> {
  readonly branches: readonly S[];
  readonly shownId: string;
}

/** The turns of a branch: those that it shares with its parents, then its own. */
export function pathOf<S extends BranchSession>(session: S, sessions: readonly S[]): PathStep<S>[] {
  return [...sharedSteps(session, sessions, new Set([session.id])), ...ownSteps(session)];
}

function ownSteps<S extends BranchSession>(session: S): PathStep<S>[] {
  return session.turns.map((turn, index) => ({ session, index, turn }));
}

function sharedSteps<S extends BranchSession>(session: S, sessions: readonly S[], seen: Set<string>): PathStep<S>[] {
  // A fork from the beginning starts its engine with no history, so it shares no turn.
  if (session.parentId === null || session.forkAtMessageId === null) return [];
  const parent = sessions.find((candidate) => candidate.id === session.parentId);
  // A damaged list can hold a loop of parents; the walk stops at a session it saw.
  if (parent === undefined || seen.has(parent.id)) return [];
  seen.add(parent.id);
  const at = parent.turns.findIndex((turn) => turn.lastMessageId === session.forkAtMessageId);
  const own = ownSteps(parent);
  // An answer that the list no longer has: the fork still continues the whole parent.
  return [...sharedSteps(parent, sessions, seen), ...(at === -1 ? own : own.slice(0, at + 1))];
}

/**
 * The sessions whose turns the page shows for a branch, each with only the turns on the path,
 * the branch first. A hidden branch then stays unread until the person opens it.
 */
export function seenPart<S extends BranchSession>(tree: readonly S[], shownId: string): S[] {
  const shown = tree.find((session) => session.id === shownId);
  if (shown === undefined) return [];
  const path = pathOf(shown, tree);
  return lineOf(shown, tree).flatMap((session) => {
    const count = path.filter((step) => step.session.id === session.id).length;
    return session === shown || count > 0 ? [{ ...session, turns: session.turns.slice(0, count) }] : [];
  });
}

/** The fork point after the step at `position` of the path, or null when that answer has no fork. */
export function branchesAfter<S extends BranchSession>(
  path: readonly PathStep<S>[],
  position: number,
  shown: S,
  sessions: readonly S[],
): ForkPoint<S> | null {
  const step = path[position];
  const messageId = step?.turn.lastMessageId ?? null;
  if (step === undefined || messageId === null) return null;
  const forks = byAge(
    sessions.filter((session) => session.parentId === step.session.id && session.forkAtMessageId === messageId),
  );
  if (forks.length === 0) return null;
  const taken = lineOf(shown, sessions).find((session) => forks.includes(session));
  return { branches: [step.session, ...forks], shownId: (taken ?? step.session).id };
}

/** The start of the chat as a fork point, when a fork starts from the beginning. `tree` starts with the chat. */
export function branchesAtStart<S extends BranchSession>(shown: S, tree: readonly S[]): ForkPoint<S> | null {
  const [root] = tree;
  if (root === undefined) return null;
  const starts = byAge(tree.filter((session) => session.parentId !== null && session.forkAtMessageId === null));
  if (starts.length === 0) return null;
  const branches = [root, ...starts];
  // The shown path starts at the first branch of its line that shares no turn.
  const start = lineOf(shown, tree).find((session) => session.parentId === null || session.forkAtMessageId === null);
  return { branches, shownId: (start !== undefined && branches.includes(start) ? start : root).id };
}

/** The session and its parents, the session first. */
function lineOf<S extends BranchSession>(session: S, sessions: readonly S[]): S[] {
  const line = [session];
  let current = session;
  while (current.parentId !== null) {
    const parent = sessions.find((candidate) => candidate.id === current.parentId);
    if (parent === undefined || line.includes(parent)) break;
    line.push(parent);
    current = parent;
  }
  return line;
}

function byAge<S extends BranchSession>(sessions: readonly S[]): S[] {
  return [...sessions].sort((first, second) => first.createdAt.localeCompare(second.createdAt));
}

/** "Main line" for the chat, then "Fork 1", "Fork 2" in the order of the tree. */
export function branchNames(tree: readonly BranchSession[]): Map<string, string> {
  return new Map(tree.map((session, index) => [session.id, index === 0 ? "Main line" : `Fork ${String(index)}`]));
}

/** The branch that a chat shows when it opens: the one with the newest activity. */
export function firstShownBranch<S extends BranchSession>(tree: readonly [S, ...S[]]): S {
  const activity = (session: S): string => session.lastTurnAt ?? session.createdAt;
  return tree.reduce((newest, session) => (activity(session) > activity(newest) ? session : newest));
}

/** How a lane looks in one half of a row: no line, a plain line, or the accent of the shown path. */
export type MapLine = "none" | "plain" | "hot";

export interface MapRow {
  readonly key: string;
  readonly sessionId: string;
  /** The turn in its own session, or null for a fork that has no turn yet. */
  readonly index: number | null;
  readonly text: string;
  /** The branch and the answer number on that branch, such as "Fork 1 · answer 3". */
  readonly label: string;
  /** The lane of the row's own dot. */
  readonly lane: number;
  readonly onPath: boolean;
  /** The last row of the shown branch. */
  readonly current: boolean;
  /** The line of each lane above and below the middle of the row. */
  readonly lines: readonly { readonly lane: number; readonly up: MapLine; readonly down: MapLine }[];
  /** A fork that leaves this row's answer: a bend from the row's lane down into the fork's lane. */
  readonly bends: readonly { readonly to: number; readonly hot: boolean }[];
}

export interface BranchMapLayout {
  readonly lanes: number;
  readonly rows: readonly MapRow[];
}

/**
 * The rows and lanes of the branch map. `tree` is in the order of `chatTree`, so the rows of each
 * branch come together, after the answer that it leaves.
 */
export function branchMap(tree: readonly BranchSession[], shownId: string): BranchMapLayout {
  const shown = tree.find((session) => session.id === shownId) ?? tree[0];
  if (shown === undefined) return { lanes: 0, rows: [] };
  const names = branchNames(tree);
  const path = pathOf(shown, tree);
  const onPath = new Set(path.map((step) => stepKey(step.session.id, step.index)));
  // A fork from the beginning shares no turn, so the shown path stops there and never reaches its parent.
  const line = lineOf(shown, tree);
  const start = line.findIndex((session) => session.forkAtMessageId === null);
  const shownLine = new Set(line.slice(0, start === -1 ? undefined : start + 1).map((session) => session.id));

  const drafts = tree.flatMap((session, lane) => {
    const before = sharedSteps(session, tree, new Set([session.id])).length;
    const name = names.get(session.id) ?? "";
    const rows =
      session.turns.length === 0
        ? [{ index: null, text: "No message yet", label: `${name} · no answer yet` }]
        : session.turns.map((turn, index) => ({
            index,
            text: turn.userText,
            label: `${name} · answer ${String(before + index + 1)}`,
          }));
    return rows.map((row) => ({
      ...row,
      session,
      lane,
      key: stepKey(session.id, row.index),
      onPath: row.index === null ? session.id === shown.id : onPath.has(stepKey(session.id, row.index)),
    }));
  });

  const rowsOf = (sessionId: string): number[] =>
    drafts.flatMap((row, position) => (row.session.id === sessionId ? [position] : []));
  const spans = tree.map((session, lane) => {
    const own = rowsOf(session.id);
    return { session, lane, own, anchor: anchorRow(session, tree, drafts, rowsOf) };
  });

  const rows = drafts.map((row, position): MapRow => {
    const lines: { lane: number; up: MapLine; down: MapLine }[] = [];
    const bends: { to: number; hot: boolean }[] = [];
    for (const span of spans) {
      const first = span.own[0] ?? position;
      const last = span.own.at(-1) ?? position;
      // Only a fork that shares turns joins its parent on the shown path.
      const hot = shownLine.has(span.session.id) && span.session.forkAtMessageId !== null;
      if (span.anchor === position) bends.push({ to: span.lane, hot });
      if (span.session.id === row.session.id) {
        const next = drafts[position + 1];
        const up: MapLine =
          position === first
            ? span.anchor === null
              ? "none"
              : hot && row.onPath
                ? "hot"
                : "plain"
            : link(drafts[position - 1]?.onPath, row.onPath);
        const down: MapLine = position === last ? "none" : link(row.onPath, next?.onPath);
        lines.push({ lane: span.lane, up, down });
      } else if (span.anchor !== null && span.anchor < position && position < first) {
        const pass: MapLine = hot ? "hot" : "plain";
        lines.push({ lane: span.lane, up: pass, down: pass });
      }
    }
    return {
      key: row.key,
      sessionId: row.session.id,
      index: row.index,
      text: row.text,
      label: row.label,
      lane: row.lane,
      onPath: row.onPath,
      current: row.session.id === shown.id && position === rowsOf(shown.id).at(-1),
      lines,
      bends,
    };
  });
  return { lanes: tree.length, rows };
}

function link(from: boolean | undefined, to: boolean | undefined): MapLine {
  return from === true && to === true ? "hot" : "plain";
}

/** The row of the answer that a fork leaves. A fork from the beginning leaves the parent's first row. */
function anchorRow(
  session: BranchSession,
  tree: readonly BranchSession[],
  drafts: readonly { readonly session: BranchSession; readonly index: number | null }[],
  rowsOf: (sessionId: string) => number[],
): number | null {
  const parent = tree.find((candidate) => candidate.id === session.parentId);
  if (parent === undefined) return null;
  const parentRows = rowsOf(parent.id);
  const at = parentRows.find((position) => {
    const index = drafts[position]?.index;
    return index !== null && index !== undefined && parent.turns[index]?.lastMessageId === session.forkAtMessageId;
  });
  if (session.forkAtMessageId === null) return parentRows[0] ?? null;
  return at ?? parentRows.at(-1) ?? null;
}

/** The key of one turn of a branch, the same in the path and in the map. */
export function stepKey(sessionId: string, index: number | null): string {
  return `${sessionId}:${index === null ? "new" : String(index)}`;
}
