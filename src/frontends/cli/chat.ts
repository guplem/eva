/** `eva chat`: a conversation in the terminal, as a client of the local API. */
import type { EngineName, ModelAlias } from "../../shared/engine-port.ts";
import type { SessionEvent } from "../../shared/events.ts";
import { describeUsageLimit } from "../../shared/usage-limit.ts";

export interface ChatOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly mode: "assistant" | "project";
  readonly model: ModelAlias;
  readonly engine?: EngineName;
  readonly projectId?: string;
  readonly clone?: string;
  /** The next line the person typed, or null at the end of input. */
  readonly readLine: () => Promise<string | null>;
  readonly write: (text: string) => void;
}

export async function runChat(options: ChatOptions): Promise<void> {
  const headers = { authorization: `Bearer ${options.token}`, "content-type": "application/json" };
  const created = await fetch(`${options.baseUrl}/api/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      mode: options.mode,
      model: options.model,
      ...(options.engine === undefined ? {} : { engine: options.engine }),
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      ...(options.clone === undefined ? {} : { clone: options.clone }),
    }),
  });
  if (!created.ok) throw new Error(`Eva refused the chat: ${await created.text()}`);
  const session = (await created.json()) as { id: string; startFolder: string };
  options.write(`Chat ${session.id} in ${session.startFolder}. Type /rename <title> to name it, or /exit to leave.\n`);

  const socket = new WebSocket(`${options.baseUrl.replace(/^http/, "ws")}/api/events`, {
    headers,
  } as unknown as string[]);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener(
      "open",
      () => {
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        reject(new Error("Could not open the event stream."));
      },
      { once: true },
    );
  });

  let wake: (() => void) | null = null;
  const turn = { over: false };
  // A function, so TypeScript reads the flag that the socket listener sets, not the value it last saw here.
  const turnIsOver = (): boolean => turn.over;
  const questions: string[] = [];
  socket.addEventListener("message", (message) => {
    const event = JSON.parse(String(message.data)) as SessionEvent;
    if (event.sessionId !== session.id) return;
    const text = describeEvent(event);
    if (text !== null) options.write(text);
    if (event.kind === "approval_needed") questions.push(event.requestId);
    const answered = event.kind === "approval_resolved" ? questions.indexOf(event.requestId) : -1;
    if (answered !== -1) questions.splice(answered, 1);
    if (event.kind === "turn_finished" || event.kind === "turn_failed") turn.over = true;
    wake?.();
  });
  const nextChange = (): Promise<void> => new Promise<void>((resolve) => (wake = resolve));

  try {
    for (;;) {
      options.write("\n> ");
      const line = await options.readLine();
      if (line === null || line.trim() === "/exit") break;
      if (line.trim() === "") continue;
      if (/^\/rename(\s|$)/.test(line.trim())) {
        options.write(await renameChat(options.baseUrl, headers, session.id, line.trim().slice("/rename".length)));
        continue;
      }
      turn.over = false;
      const sent = await fetch(`${options.baseUrl}/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: line }),
      });
      if (!sent.ok) {
        options.write(`Eva refused the message: ${await sent.text()}\n`);
        continue;
      }
      // Wait for the turn end; answer each approval here, with y or n.
      while (!turnIsOver()) {
        const requestId = questions.shift();
        if (requestId === undefined) {
          await nextChange();
          continue;
        }
        options.write("  Allow it? [y/N] ");
        const answer = (await options.readLine())?.trim().toLowerCase().startsWith("y") === true ? "allow" : "deny";
        await fetch(`${options.baseUrl}/api/approvals/${encodeURIComponent(requestId)}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ answer }),
        });
      }
    }
  } finally {
    socket.close();
  }
}

/** Renames the chat and returns the line to show: the new title, or the reason Eva refused it. */
async function renameChat(
  baseUrl: string,
  headers: Record<string, string>,
  sessionId: string,
  title: string,
): Promise<string> {
  if (title.trim() === "") return "Use: /rename <title>\n";
  const renamed = await fetch(`${baseUrl}/api/sessions/${sessionId}/rename`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title }),
  });
  if (!renamed.ok) return `Eva refused the new title: ${await renamed.text()}\n`;
  return `The chat is now called ${((await renamed.json()) as { title: string }).title}.\n`;
}

export function describeEvent(event: SessionEvent): string | null {
  switch (event.kind) {
    case "text":
      return `${event.text}\n`;
    case "tool_started":
      return `  · ${event.summary}\n`;
    case "task_changed":
      return `  · task ${event.state}: ${event.description}\n`;
    case "approval_needed":
      return `  ! Eva wants to run ${event.toolName}: ${event.summary}\n`;
    case "notice":
      return `  (${event.text})\n`;
    case "history_lost":
      return "  (The earlier history of this chat is lost.)\n";
    case "usage_limit":
      return `  (${describeUsageLimit(event, new Date())})\n`;
    case "turn_failed":
      return `  The turn failed: ${event.reason}\n`;
    case "session_deleted":
      return "  (This chat was deleted elsewhere.)\n";
    // The person typed the message in this terminal, and `eva work` prints the Project chat it started.
    case "text_delta":
    case "message_received":
    case "project_work_started":
    case "turn_finished":
    case "tool_finished":
    case "approval_resolved":
      return null;
    case "session_renamed":
      // The terminal shows no title, and its own /rename answers from the request.
      return null;
  }
}
