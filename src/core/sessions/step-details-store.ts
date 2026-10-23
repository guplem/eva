/**
 * The whole input and output of each tool step, in `state/step-details/<session id>.json`.
 * The session list is one file that Eva writes whole at each change, so the big texts live here.
 * The web app reads one step when the person opens it. A broken file costs only its details.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { StepDetail, StepDetailWithId } from "../../shared/turn-steps.ts";

/** The web app lists the steps of the last 10 turns only, so older details have no reader. */
export const turnsWithDetails = 10;

const detailSchema = z.object({ id: z.string(), input: z.string().optional(), output: z.string().optional() });
export const stepDetailsFileSchema = z.object({
  version: z.literal(1),
  turns: z.array(z.object({ steps: z.array(detailSchema) })),
});

/** A session id names a file, so only a plain id may reach the path. */
const safeId = /^[\w-]+$/;

export class StepDetailsStore {
  private readonly folder: string;

  constructor(folder: string) {
    this.folder = folder;
  }

  /** Adds the details of one turn. A turn with no details writes nothing. */
  addTurn(sessionId: string, steps: readonly StepDetailWithId[]): void {
    if (!safeId.test(sessionId) || steps.length === 0) return;
    const turns = [...this.turns(sessionId), { steps }].slice(-turnsWithDetails);
    writeFileAtomic(this.pathOf(sessionId), JSON.stringify({ version: 1, turns }) + "\n");
  }

  /** The details of one step, or null when Eva kept none. */
  get(sessionId: string, stepId: string): StepDetail | null {
    if (!safeId.test(sessionId)) return null;
    // A step id is unique in its chat, so the newest turn that has it is the only one.
    for (const turn of this.turns(sessionId).reverse()) {
      const step = turn.steps.find((candidate) => candidate.id === stepId);
      if (step !== undefined) return { input: step.input, output: step.output };
    }
    return null;
  }

  delete(sessionId: string): void {
    if (!safeId.test(sessionId)) return;
    try {
      rmSync(this.pathOf(sessionId), { force: true });
    } catch {
      // On Windows a locked file, such as one that an antivirus reads, refuses the delete. The chat still goes.
    }
  }

  private turns(sessionId: string): { steps: StepDetailWithId[] }[] {
    const read = readJsonTolerant(this.pathOf(sessionId));
    const parsed = read.ok ? stepDetailsFileSchema.safeParse(read.value) : null;
    return parsed?.success === true ? parsed.data.turns : [];
  }

  private pathOf(sessionId: string): string {
    return join(this.folder, `${sessionId}.json`);
  }
}
