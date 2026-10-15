/**
 * The session index of one instance, in `state/sessions.json` (docs/plan.md §4.5). Every
 * front end shows this one list (D13). A broken file starts an empty list, never a crash
 * (lesson 54).
 */
import { z } from "zod";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";

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

const storeSchema = z.object({ version: z.literal(1), sessions: z.array(sessionSchema) });

export class SessionStore {
  private readonly path: string;
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(path: string) {
    this.path = path;
    const read = readJsonTolerant(path);
    const parsed = read.ok ? storeSchema.safeParse(read.value) : null;
    if (parsed?.success === true) {
      for (const session of parsed.data.sessions) this.sessions.set(session.id, session);
    }
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
