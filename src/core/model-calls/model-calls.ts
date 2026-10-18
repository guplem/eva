/**
 * Model calls: one question to a model, outside every chat, with one text answer. A feature that
 * needs a short answer from a model, such as a chat name or a suggested reply, asks here.
 * The call runs through the engine port, so the person's own engine login pays for it.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineName, EnginePort, ModelAlias } from "../../shared/engine-port.ts";
import type { EngineEventPayload } from "../../shared/events.ts";

export const engineLabels: Readonly<Record<EngineName, string>> = { "claude-code": "Claude Code", pi: "pi" };

export interface ModelCallRequest {
  readonly engine: EngineName;
  readonly model: ModelAlias;
  /** What the model is and how it answers. It replaces the engine's own system prompt. */
  readonly systemPrompt: string;
  readonly prompt: string;
  /** Named facts for the model. Each goes after the prompt, in a block tagged with its name. */
  readonly context?: Readonly<Record<string, string>>;
  /** A limit for this call in place of the default one. */
  readonly timeoutMs?: number;
}

/** `missing`: the engine is not on this machine. `late`: no answer in time. */
export type ModelCallFailure = "missing" | "late" | "failed";

export type ModelCallResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly failure: ModelCallFailure; readonly reason: string };

export interface ModelCallsOptions {
  readonly engines: readonly EnginePort[];
  /** The environment of a real turn: the engine's login, and no GitHub token (lesson 96). */
  readonly environment: Readonly<Record<string, string>>;
  readonly redact: (text: string) => string;
  readonly timeoutMs: number;
}

/** Claude Code's smallest model. pi maps each alias to a model of the person's choice, so it keeps the chat's. */
export function cheapestModel(engine: EngineName, chatModel: ModelAlias): ModelAlias {
  return engine === "claude-code" ? "haiku" : chatModel;
}

export class ModelCalls {
  private readonly options: ModelCallsOptions;

  constructor(options: ModelCallsOptions) {
    this.options = options;
  }

  /** Never throws: every problem comes back as a failure with a redacted reason. */
  async ask(request: ModelCallRequest): Promise<ModelCallResult> {
    const label = engineLabels[request.engine];
    const engine = this.options.engines.find((candidate) => candidate.name === request.engine);
    if (engine === undefined)
      return { ok: false, failure: "missing", reason: `Eva did not find ${label} on this machine.` };
    // An empty folder gives the engine no file to read and no project settings to load.
    const folder = mkdtempSync(join(tmpdir(), "eva-model-call-"));
    const controller = new AbortController();
    // The abort asks the engine to stop; the deadline ends the call even if the engine never does.
    const deadline = new Promise<"late">((resolve) => {
      controller.signal.addEventListener("abort", () => {
        resolve("late");
      });
    });
    const timer = setTimeout(() => {
      controller.abort();
    }, request.timeoutMs ?? this.options.timeoutMs);
    const late: ModelCallResult = { ok: false, failure: "late", reason: `${label} gave no answer in time.` };
    let events: AsyncIterator<EngineEventPayload> | null = null;
    try {
      const parts: string[] = [];
      const stream = engine.runTurn({
        mode: "model-call",
        history: { kind: "new", engineSessionId: randomUUID() },
        startFolder: folder,
        prompt: withContext(request.prompt, request.context ?? {}),
        model: request.model,
        appendSystemPrompt: request.systemPrompt,
        pluginFolders: [],
        mcpServers: {},
        trusted: false,
        environment: this.options.environment,
        requestApproval: () => Promise.resolve("deny"),
        signal: controller.signal,
      });
      events = stream[Symbol.asyncIterator]();
      for (;;) {
        const next = await Promise.race([events.next(), deadline]);
        if (next === "late" || controller.signal.aborted) return late;
        if (next.done === true) return { ok: false, failure: "failed", reason: `${label} stopped without an answer.` };
        const event = next.value;
        if (event.kind === "text") parts.push(event.text);
        if (event.kind === "turn_failed")
          return { ok: false, failure: "failed", reason: this.options.redact(event.reason) };
        if (event.kind === "turn_finished") return { ok: true, text: parts.join("\n\n") };
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "failed";
      return { ok: false, failure: "failed", reason: this.options.redact(reason) };
    } finally {
      clearTimeout(timer);
      controller.abort();
      // Not awaited: a stuck engine would hold the call again. It lets the adapter clean up.
      void events?.return?.().catch(() => undefined);
      removeFolder(folder);
    }
  }
}

function withContext(prompt: string, context: Readonly<Record<string, string>>): string {
  const blocks = Object.entries(context).map(([name, text]) => `<${name}>\n${text}\n</${name}>`);
  return [prompt, ...blocks].join("\n\n");
}

/** On Windows an engine that is still stopping holds its folder; a leftover temporary folder is harmless. */
function removeFolder(folder: string): void {
  try {
    rmSync(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    // The system cleans its temporary folder.
  }
}
