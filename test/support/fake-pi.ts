/**
 * A fake `pi --mode rpc` for adapter tests (docs/plan.md §10, P7). It replays records captured
 * from pi 0.73.1 (test/fixtures/pi/) the way pi sends them: it starts on the `prompt` command,
 * pauses after an `extension_ui_request` until the answer comes, and pauses after an
 * `agent_end` (with the `auto_retry_*` records that pi emits in the same tick) until the next
 * command, such as `get_state`, which it answers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PiProcess, PiProcessStarter } from "../../src/engines/pi/pi-process.ts";

export type PiRecord = Record<string, unknown>;

export interface FakePiRun {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly sent: PiRecord[];
}

export interface FakePiScript {
  readonly records: readonly PiRecord[];
  /** Runs when the adapter closes the process, such as a write of the session file. */
  readonly onClose?: (run: FakePiRun) => void;
  readonly stderr?: string;
}

export function loadPiFixture(name: string): PiRecord[] {
  return readFileSync(join(import.meta.dir, "..", "fixtures", "pi", `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as PiRecord);
}

export class FakePi {
  readonly runs: FakePiRun[] = [];
  private readonly scripts: FakePiScript[];

  constructor(scripts: FakePiScript[]) {
    this.scripts = scripts;
  }

  readonly start: PiProcessStarter = (command, options) => {
    const script = this.scripts.shift();
    if (script === undefined) throw new Error("No fake pi script left.");
    const run: FakePiRun = { command, cwd: options.cwd, environment: options.environment, sent: [] };
    this.runs.push(run);
    return new FakePiProcess(script, run);
  };
}

class FakePiProcess implements PiProcess {
  readonly records: AsyncIterable<PiRecord>;
  private readonly script: FakePiScript;
  private readonly run: FakePiRun;
  private readonly inbox: PiRecord[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  constructor(script: FakePiScript, run: FakePiRun) {
    this.script = script;
    this.run = run;
    this.records = this.replay();
  }

  send(record: PiRecord): void {
    this.run.sent.push(record);
    this.inbox.push(record);
    this.wake?.();
  }

  close(): Promise<void> {
    this.closed = true;
    this.wake?.();
    this.script.onClose?.(this.run);
    return Promise.resolve();
  }

  stderrTail(): string {
    return this.script.stderr ?? "";
  }

  private async nextCommand(): Promise<PiRecord | null> {
    while (this.inbox.length === 0 && !this.closed) {
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = null;
    }
    return this.inbox.shift() ?? null;
  }

  private async *replay(): AsyncIterable<PiRecord> {
    const prompt = await this.nextCommand();
    if (prompt === null) return;
    const records = this.script.records.filter(
      (record) => record["type"] !== "response" || record["command"] === "prompt",
    );
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index] ?? {};
      yield record["type"] === "response" ? { ...record, id: prompt["id"] } : record;
      const next = records[index + 1];
      const pause =
        (record["type"] === "extension_ui_request" && record["method"] !== "notify") ||
        (record["type"] === "agent_end" && !String(next?.["type"]).startsWith("auto_retry")) ||
        (String(record["type"]).startsWith("auto_retry") && records[index - 1]?.["type"] === "agent_end");
      if (!pause) continue;
      const command = await this.nextCommand();
      if (command === null) return;
      if (command["type"] === "get_state") {
        yield { id: command["id"], type: "response", command: "get_state", success: true, data: {} };
      }
    }
  }
}
