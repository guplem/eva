/**
 * The session index of one instance, in `state/sessions.json` (docs/plan.md §4.5). Every
 * front end shows this one list (D13). A broken file starts an empty list, never a crash
 * (lesson 54), and a bad entry costs only that session (lesson 69).
 */
import { copyFileSync } from "node:fs";
import { z } from "zod";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { Logger } from "../../shared/logger.ts";

const turnSchema = z.object({
  userText: z.string(),
  /** The answer's text, for the history views of the front ends. */
  answerText: z.string().default(""),
  /** How many tools the turn used, for the activity chips. */
  toolCount: z.number().int().min(0).default(0),
  /** Why the turn failed, or null. A failed turn stays in the history, so the person sees what happened. */
  failure: z.string().nullable().default(null),
  lastMessageId: z.string().nullable(),
  at: z.string(),
});

const sessionSchema = z.object({
  id: z.string(),
  engineSessionId: z.string(),
  engine: z.enum(["claude-code", "pi"]),
  mode: z.enum(["assistant", "project"]),
  modelAlias: z.enum(["default", "opus", "sonnet", "haiku"]),
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
});

export type SessionRecord = z.infer<typeof sessionSchema>;

/** Each session is checked on its own, so one bad entry never empties the list (lesson 69). */
const storeSchema = z.object({ version: z.literal(1), sessions: z.array(z.unknown()) });

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
    writeFileAtomic(this.path, JSON.stringify({ version: 1, sessions: this.list() }, null, 2) + "\n");
  }
}
