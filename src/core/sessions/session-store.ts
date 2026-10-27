/**
 * The session index of one instance, in `state/sessions.json`. Every
 * front end shows this one list. A broken file starts an empty list, never a crash
 * (lesson 54), and a bad entry costs only that session (lesson 69).
 */
import { copyFileSync } from "node:fs";
import { z } from "zod";
import { effortLevels, modelAliases } from "../../shared/engine-port.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { Logger } from "../../shared/logger.ts";
import type { ProjectReport } from "../../shared/project-report.ts";
import { stepKinds } from "../../shared/turn-steps.ts";

const stepSchema = z.object({
  kind: z.enum(stepKinds),
  text: z.string(),
  isError: z.boolean(),
  id: z.string().nullable(),
  /** The chat that a task runs in. A step from before this field has none. */
  chatId: z.string().optional().catch(undefined),
});

/** The facts of a project work result, so a front end shows a card instead of the raw message. */
const projectReportSchema = z.object({
  projectId: z.string(),
  projectTitle: z.string(),
  /** The Project chat that did the work. */
  projectSessionId: z.string(),
  request: z.string(),
  clone: z.string(),
  repositories: z.array(
    z.object({ name: z.string(), branch: z.string().nullable(), pullRequest: z.number().int().nullable() }),
  ),
  failed: z.boolean(),
  /** The end of the last answer of the Project chat, or the failure reason. */
  result: z.string(),
  /** The answer was longer, so `result` holds only its end. */
  resultCut: z.boolean(),
}) satisfies z.ZodType<ProjectReport>;

const turnSchema = z.object({
  userText: z.string(),
  /**
   * Eva sent every message of the turn, such as a project work result or a follow-up of the mode,
   * so a front end does not show it as the person's. A turn from before the field has none.
   */
  fromEva: z.boolean().default(false).catch(false),
  /** The project work results that Eva sent in this turn. A turn from before the field has none. */
  projectReports: z.array(projectReportSchema).catch([]),
  /**
   * The person's own words when a turn gathered them with a message from Eva, or null. The front ends
   * show them apart from the result, so the result does not show twice.
   */
  personText: z.string().nullable().default(null).catch(null),
  /** The answer's text, for the history views of the front ends. */
  answerText: z.string().default(""),
  /** How many tools the turn used, commands included, for the activity chips. */
  toolCount: z.number().int().min(0).default(0),
  /** How many of those tools were shell commands. */
  commandCount: z.number().int().min(0).default(0),
  /** How many background tasks the turn started, such as a subagent or a background command. */
  taskCount: z.number().int().min(0).default(0),
  /** The turn's messages, commands, tools and tasks, for the badges. A bad list costs only the badges. */
  steps: z.array(stepSchema).catch([]),
  /** How many early steps the turn dropped to keep the list short. */
  omittedSteps: z.number().int().min(0).catch(0),
  /** The turn's notices, such as an MCP server that did not start (issue 157). A turn from before the field has none. */
  notes: z.array(z.string()).catch([]),
  /** How full the context was after the turn, or null when the engine did not say. */
  contextTokens: z.number().int().min(0).nullable().catch(null),
  /** The size of the context window of the model that answered, or null when the engine did not say. */
  contextWindow: z.number().int().positive().nullable().catch(null),
  /** The id of the model that answered, so the chip names it beside the tier. Null when the engine did not say. */
  model: z.string().nullable().catch(null),
  /**
   * The model that the chat chose for the turn (issue 545). The chat can change it between turns,
   * so a front end names an answered model only for the model that the chat has now. A turn from
   * before the field has none.
   */
  modelAlias: z
    .preprocess((value) => (value === "default" ? "opus" : value), z.enum(modelAliases))
    .optional()
    .catch(undefined),
  /** Why the turn failed, or null. A failed turn stays in the history, so the person sees what happened. */
  failure: z.string().nullable().default(null),
  lastMessageId: z.string().nullable(),
  at: z.string(),
  /**
   * The snapshot of the clone's files before and after the turn (issue 523), or null. A retry undoes
   * the turn with the first, and a fork at its answer starts from the second. An older turn has none.
   */
  startSnapshot: z.string().nullable().default(null).catch(null),
  endSnapshot: z.string().nullable().default(null).catch(null),
});

/** The chat that a chat in another clone branched from (issue 523), with the point of its history. */
const forkedFromSchema = z.object({
  sessionId: z.string(),
  clone: z.string().nullable(),
  /** The engine session and the message that the history goes on from, or null to start with none. */
  engineSessionId: z.string().nullable(),
  atMessageId: z.string().nullable(),
});

export const sessionSchema = z
  .object({
    id: z.string(),
    engineSessionId: z.string(),
    engine: z.enum(["claude-code", "pi"]),
    mode: z.enum(["assistant", "project"]),
    /** The old `default` alias let the engine login choose; it reads as Smart (#550). */
    modelAlias: z.preprocess((value) => (value === "default" ? "opus" : value), z.enum(modelAliases)),
    /** How much the model reasons (issue 419). An older record, the old `default`, or a bad value reads as Medium. */
    effort: z.enum(effortLevels).default("medium").catch("medium"),
    startFolder: z.string(),
    projectId: z.string().nullable(),
    clone: z.string().nullable(),
    parentId: z.string().nullable(),
    forkAtMessageId: z.string().nullable(),
    /** Set until the fork's first turn has run; the engine then gives the fork its own id. */
    forkFromEngineSessionId: z.string().nullable(),
    title: z.string(),
    createdAt: z.string(),
    lastTurnAt: z.string().nullable(),
    source: z.enum(["cli", "telegram", "web", "schedule"]),
    telegramTopicId: z.number().int().nullable(),
    /** True after the engine lost the history: the next turn starts a new engine session (lesson 46). */
    historyLost: z.boolean().default(false),
    turns: z.array(turnSchema),
    /**
     * How many turns the person saw in the web app (issue 381). A record from before the field, or a
     * bad value, counts every turn as seen: an old chat never shows as unread.
     */
    seenTurns: z.number().int().min(0).optional().catch(undefined),
    /** True when the person archived the chat (issue 388). The web app lists it apart. */
    archived: z.boolean().default(false).catch(false),
    /**
     * True after Eva closed the chat to reuse its clone (issue 521). It keeps its history, but takes no
     * message. A record from before the field, or a bad value, is open.
     */
    closed: z.boolean().default(false).catch(false),
    /** The chat that this chat continues from a summary (issue 522), or null. The old chat finds its successors in the list. */
    continuedFrom: z.string().nullable().default(null).catch(null),
    /** The summary that the person reads and can change before the first turn, or null. */
    firstMessageDraft: z.string().nullable().default(null).catch(null),
    /**
     * A snapshot of the clone's files that the next turn brings back before it starts (issue 523), or
     * null. An undo retry sets it, so the restore runs while the turn holds the clone.
     */
    pendingRestore: z.string().nullable().default(null).catch(null),
    /** The chat in another clone that this chat branched from (issue 523), or null. It is not its parent. */
    forkedFrom: forkedFromSchema.nullable().default(null).catch(null),
    /**
     * The Assistant chat that this Project chat does a work for and reports to (#614), or null when
     * the person made the chat. The web app never lists Eva's own chat as unread. A record from
     * before the field, or a bad value, is the person's.
     */
    reportsTo: z.string().nullable().default(null).catch(null),
    /**
     * The name that the person gave a fork (issue 637), or null. A fork with no name shows as "Fork N".
     * A record from before the field, or a bad value, has no name.
     */
    forkName: z.string().nullable().default(null).catch(null),
  })
  .transform((session) => ({ ...session, seenTurns: session.seenTurns ?? session.turns.length }));

export type SessionRecord = z.infer<typeof sessionSchema>;

/** Each session is checked on its own, so one bad entry never empties the list (lesson 69). */
export const storeSchema = z.object({ version: z.literal(1), sessions: z.array(z.unknown()) });

export interface SessionStoreOptions {
  /** Names the copy of a broken file. */
  readonly now: () => Date;
  readonly logger?: Logger;
}

export class SessionStore {
  private readonly path: string;
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(path: string, options: SessionStoreOptions) {
    this.path = path;
    const read = readJsonTolerant(path);
    if (!read.ok && read.reason === "missing") return;
    const parsed = read.ok ? storeSchema.safeParse(read.value) : null;
    let badEntries = 0;
    for (const entry of parsed?.success === true ? parsed.data.sessions : []) {
      const session = sessionSchema.safeParse(entry);
      if (session.success) this.sessions.set(session.data.id, session.data);
      else badEntries += 1;
    }
    if (parsed?.success === true && badEntries === 0) return;
    // The next save rewrites the file with the good sessions only: keep the original for a person to repair.
    const copyPath = `${path}.corrupt-${options.now().toISOString().replace(/[:.]/g, "-")}`;
    let copied = true;
    try {
      copyFileSync(path, copyPath);
    } catch {
      // A failed copy must not stop Eva (lesson 54); the log says that no copy exists.
      copied = false;
    }
    options.logger?.log("warn", "The session list had entries that Eva cannot read.", {
      copy: copied ? copyPath : null,
      badEntries: parsed?.success === true ? badEntries : "the whole file",
      keptSessions: this.sessions.size,
    });
  }

  get(id: string): SessionRecord | undefined {
    return this.sessions.get(id);
  }

  list(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  save(session: SessionRecord): void {
    this.sessions.set(session.id, session);
    this.write();
  }

  delete(id: string): void {
    this.sessions.delete(id);
    this.write();
  }

  private write(): void {
    writeFileAtomic(this.path, JSON.stringify({ version: 1, sessions: this.list() }, null, 2) + "\n");
  }
}
