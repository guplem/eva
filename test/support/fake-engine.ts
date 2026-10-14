/** A scripted engine for tests: it records each request and replays the events a test gives it. */
import type { EnginePort, TurnRequest } from "../../src/shared/engine-port.ts";
import type { EngineEventPayload } from "../../src/shared/events.ts";

export type FakeTurnScript = (
  request: TurnRequest,
  turnNumber: number,
) => AsyncIterable<EngineEventPayload> | EngineEventPayload[];

export class FakeEngine implements EnginePort {
  readonly name = "claude-code" as const;
  readonly requests: TurnRequest[] = [];
  private readonly script: FakeTurnScript;

  constructor(script?: FakeTurnScript) {
    this.script = script ?? ((request, turnNumber) => FakeEngine.answer(request, `answer ${String(turnNumber)}`));
  }

  async *runTurn(request: TurnRequest): AsyncIterable<EngineEventPayload> {
    this.requests.push(request);
    const events = this.script(request, this.requests.length);
    if (Array.isArray(events)) {
      for (const event of events) yield event;
      return;
    }
    yield* events;
  }

  /** A text answer and a clean finish, with message ids that tell turns apart. */
  static answer(request: TurnRequest, text: string): EngineEventPayload[] {
    const engineSessionId = sessionIdOf(request);
    const messageId = `${engineSessionId}:${text}`;
    return [
      { kind: "text", text, messageId },
      {
        kind: "turn_finished",
        engineSessionId,
        lastMessageId: messageId,
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: null,
      },
    ];
  }
}

export function sessionIdOf(request: TurnRequest): string {
  switch (request.history.kind) {
    case "new":
    case "continue":
      return request.history.engineSessionId;
    case "fork":
      return `fork-of-${request.history.fromEngineSessionId}`;
  }
}
