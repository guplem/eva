/** The figures of the chat panel. */
import { contextGroups, type ContextGroup, type ContextPart } from "../../../shared/chat-context.ts";
import type { TurnStep } from "../../../shared/turn-steps.ts";
import type { SessionRecord } from "./api.ts";
import { pathOf, type BranchSession } from "./branch-path.ts";
import { answeredModel, modelLabel } from "./conversation-parts.ts";
import type { IconName } from "./icons.tsx";
import type { LiveState } from "./live-state.ts";

/** How full the context is, and the size of the window when the engine said it. */
export interface ContextUse {
  readonly tokens: number;
  readonly window: number | null;
}

/** "25.4k": short enough for the panel. */
export function formatTokenCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${trimmed(count / 1000)}k`;
  return `${trimmed(count / 1_000_000)}M`;
}

function trimmed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/**
 * The context of the newest answer in the chat and its forks, or null when its engine did not
 * say. An older number would look current, so a failed newest answer gives null too.
 */
export function latestContext(sessions: readonly Pick<SessionRecord, "turns">[]): ContextUse | null {
  const turns = sessions.flatMap((session) => session.turns);
  // Turns keep only their time, not a sequence number, so the time orders them.
  const newest = turns.reduce<(typeof turns)[number] | undefined>(
    (found, candidate) => (found === undefined || candidate.at > found.at ? candidate : found),
    undefined,
  );
  if (newest === undefined || newest.contextTokens === null) return null;
  return { tokens: newest.contextTokens, window: newest.contextWindow };
}

/**
 * The models of the chat and its forks, each once. Each branch can change its model (#545). A
 * branch with no answer on its model yet takes the answered name of another branch on that model.
 */
export function modelNames(sessions: readonly Pick<SessionRecord, "modelAlias" | "turns">[]): string {
  const aliases = [...new Set(sessions.map((session) => session.modelAlias))];
  return aliases
    .map((alias) => {
      const answers = sessions
        .filter((session) => session.modelAlias === alias)
        .map((session) => answeredModel(session.turns, alias));
      return modelLabel(alias, answers.find((answer) => answer !== null) ?? null);
    })
    .join(", ");
}

/** The whole percent of the window in use, or null when the window is not known: Eva guesses no limit. */
export function contextShare(context: ContextUse): number | null {
  if (context.window === null) return null;
  return Math.min(100, Math.round((context.tokens / context.window) * 100));
}

/** "76k of 200k", or "25.4k" when the window is not known. The panel adds the word "tokens". */
export function contextFigure(context: ContextUse): string {
  const count = formatTokenCount(context.tokens);
  return context.window === null ? count : `${count} of ${formatTokenCount(context.window)}`;
}

const engineLabels: Readonly<Record<SessionRecord["engine"], string>> = { "claude-code": "Claude Code", pi: "pi" };

/** The engine's name as its maker writes it. */
export function engineLabel(engine: SessionRecord["engine"]): string {
  return engineLabels[engine];
}

/** "sonnet" becomes "Sonnet", for a model alias or a mode. */
export function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The line under a chat's title, such as "Claude Code · Assistant". The model shows only in the composer chip. */
export function chatSubtitle(chat: Pick<SessionRecord, "engine" | "mode">, running: boolean): string {
  const words = `${engineLabel(chat.engine)} · ${titleCase(chat.mode)}`;
  return running ? `Working · ${words}` : words;
}

export type StatusTone = "live" | "ok" | "bad" | "idle";

export interface TaskStatus {
  readonly label: string;
  readonly tone: StatusTone;
  /** Only a running task shows the sync arrows, so a task that ended does not look busy. */
  readonly icon: IconName;
}

const statuses: Readonly<Record<string, TaskStatus>> = {
  running: { label: "Running", tone: "live", icon: "sync" },
  done: { label: "OK", tone: "ok", icon: "check" },
  failed: { label: "Failed", tone: "bad", icon: "alert" },
  ended: { label: "Ended", tone: "idle", icon: "check" },
  started: { label: "Started", tone: "idle", icon: "chat" },
};

/** One word, one tone and one icon for the state of a task, as the task cards show it. */
export function taskStatus(state: string): TaskStatus {
  return statuses[state] ?? { label: state, tone: "idle", icon: "info" };
}

/** Where "Fork this chat" forks a branch: the newest answer on its path, which can be a shared one. */
export function branchForkPoint(
  tree: readonly (BranchSession & Pick<SessionRecord, "turns">)[],
  shownId: string | null,
): { sessionId: string; messageId: string } | null {
  const shown = tree.find((session) => session.id === shownId) ?? tree[0];
  if (shown === undefined) return null;
  // An answer with no message id, or one that failed, cannot be forked.
  const step = pathOf(shown, tree).findLast(
    (candidate) => candidate.turn.lastMessageId !== null && candidate.turn.failure === null,
  );
  if (step === undefined || step.turn.lastMessageId === null) return null;
  return { sessionId: step.session.id, messageId: step.turn.lastMessageId };
}

/**
 * The chats around a chat and its forks (issue 522): the chat that the root continues, and each
 * chat that continues one of the branches. Only the new chat stores the link.
 */
export function chatLinks<Chat extends Pick<SessionRecord, "id" | "continuedFrom">>(
  tree: readonly Chat[],
  sessions: readonly Chat[],
): { from: Chat | null; next: Chat[] } {
  const fromId = tree[0]?.continuedFrom ?? null;
  const ids = new Set(tree.map((session) => session.id));
  return {
    from: sessions.find((session) => session.id === fromId) ?? null,
    next: sessions.filter((session) => session.continuedFrom !== null && ids.has(session.continuedFrom)),
  };
}

/**
 * The tasks of a stored answer, from its steps. Each one ended with its turn; a step keeps
 * only an error, so "ended" covers done and stopped alike. `endedWork` maps each Project chat
 * whose result came back to whether its work failed.
 */
export function tasksOfTurn(
  steps: readonly TurnStep[],
  sessionId: string,
  endedWork: ReadonlyMap<string, boolean> = new Map(),
): LiveState["tasks"] {
  const tasks: Record<string, LiveState["tasks"][string]> = {};
  for (const step of steps) {
    if (step.kind !== "task" || step.id === null) continue;
    // The Project chat of project work goes on after the answer, so its task only started until its result comes back.
    if (step.chatId !== undefined) {
      const failed = endedWork.get(step.chatId);
      const state = failed === undefined ? "started" : failed ? "failed" : "done";
      tasks[step.id] = { description: step.text, state, sessionId, chatId: step.chatId };
      continue;
    }
    tasks[step.id] = { description: step.text, state: step.isError ? "failed" : "ended", sessionId };
  }
  return tasks;
}

/** Each Project chat that sent its result back, and whether its work failed. */
export function endedProjectWork(
  turns: readonly Pick<SessionRecord["turns"][number], "projectReports">[],
): Map<string, boolean> {
  return new Map(
    turns.flatMap((turn) => turn.projectReports.map((report) => [report.projectSessionId, report.failed] as const)),
  );
}

const contextGroupLabels: Readonly<Record<ContextGroup, string>> = {
  prompt: "System prompt",
  instructions: "Instruction files",
  skills: "Skills",
  // Not "message": a label with that word would match the composer's "Message" label in the browser tests.
  message: "Each turn",
};

/** The parts of a chat's context by group, in the order of the groups. An empty group is left out. */
export function contextSections(parts: readonly ContextPart[]): { label: string; parts: ContextPart[] }[] {
  return contextGroups.flatMap((group) => {
    const inGroup = parts.filter((part) => part.group === group);
    return inGroup.length === 0 ? [] : [{ label: contextGroupLabels[group], parts: inGroup }];
  });
}

/** A lock only for a text that the engine keeps inside, such as its own prompt. A missing file has a source. */
export function partIcon(part: ContextPart): IconName {
  if (part.group === "skills") return "command";
  return part.text === null && part.source === null ? "lock" : "file";
}
