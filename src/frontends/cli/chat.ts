/** `eva chat`: a conversation in the terminal, as a client of the local API. */
import type { EngineName, ModelAlias } from "../../shared/engine-port.ts";
import type { ApprovalQuestion, QuestionAnswer, SessionEvent } from "../../shared/events.ts";
import { EvaError } from "../../shared/errors.ts";
import { describeUsageLimit } from "../../shared/usage-limit.ts";
import { refusalOf } from "./client.ts";

export interface ChatOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly mode: "assistant" | "project";
  /** Without one, the settings' model for new chats. */
  readonly model?: ModelAlias;
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
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.engine === undefined ? {} : { engine: options.engine }),
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      ...(options.clone === undefined ? {} : { clone: options.clone }),
    }),
  });
  if (!created.ok) {
    const refusal = await refusalOf(created);
    throw new EvaError(refusal.code, `Eva refused the chat: ${refusal.message}`);
  }
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
  // A stream that drops, such as when Eva restarts, sends no turn end: without this the loop waits for good.
  const stream = { closed: false, leaving: false };
  const streamIsClosed = (): boolean => stream.closed;
  let markClosed: (closed: null) => void = () => undefined;
  const closed = new Promise<null>((resolve) => (markClosed = resolve));
  socket.addEventListener("close", () => {
    if (stream.leaving) return;
    stream.closed = true;
    markClosed(null);
    wake?.();
  });
  // A prompt that waits for a line must not outlive the stream: a line typed then would go nowhere.
  const readLineOrClose = (): Promise<string | null> => Promise.race([options.readLine(), closed]);
  const waiting: Extract<SessionEvent, { kind: "approval_needed" }>[] = [];
  /** The requests that another front end answered, so the terminal stops asking about them. */
  const resolved = new Map<string, Extract<SessionEvent, { kind: "approval_resolved" }>>();
  const print = createEventPrinter();
  socket.addEventListener("message", (message) => {
    const event = JSON.parse(String(message.data)) as SessionEvent;
    if (event.sessionId !== session.id) return;
    const text = print(event);
    if (text !== null) options.write(text);
    if (event.kind === "approval_needed") waiting.push(event);
    if (event.kind === "approval_resolved") resolved.set(event.requestId, event);
    const answered =
      event.kind === "approval_resolved" ? waiting.findIndex((asked) => asked.requestId === event.requestId) : -1;
    if (answered !== -1) waiting.splice(answered, 1);
    if (event.kind === "turn_finished" || event.kind === "turn_failed") turn.over = true;
    wake?.();
  });
  const nextChange = (): Promise<void> => new Promise<void>((resolve) => (wake = resolve));

  try {
    while (!streamIsClosed()) {
      options.write("\n> ");
      const line = await readLineOrClose();
      if (line === null || line.trim() === "/exit" || streamIsClosed()) break;
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
        options.write(`Eva refused the message: ${(await refusalOf(sent)).message}\n`);
        continue;
      }
      // Wait for the turn end; answer each approval here, with y or n, and each question of the model.
      while (!turnIsOver() && !streamIsClosed()) {
        const asked = waiting.shift();
        if (asked === undefined) {
          await nextChange();
          continue;
        }
        const isOpen = (): boolean => !resolved.has(asked.requestId);
        const body =
          asked.questions === undefined
            ? await readApproval(readLineOrClose, options.write)
            : await readQuestionAnswers(asked.questions, readLineOrClose, options.write, isOpen);
        if (streamIsClosed()) break;
        if (body === null) {
          const timedOut = resolved.get(asked.requestId)?.timedOut === true;
          options.write(timedOut ? "  (Not answered in time.)\n" : "  (Answered elsewhere.)\n");
          continue;
        }
        await fetch(`${options.baseUrl}/api/approvals/${encodeURIComponent(asked.requestId)}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
      }
    }
    // The person did not leave, so the chat failed: `eva chat` exits 1.
    if (streamIsClosed()) throw new EvaError("request_failed", "Eva closed the connection.");
  } finally {
    stream.leaving = true;
    socket.close();
  }
}

type ApprovalBody = { answer: "allow"; answers: QuestionAnswer[] } | { answer: "allow" | "deny" };

/** An input that ends denies, as no answer is coming. */
async function readApproval(
  readLine: () => Promise<string | null>,
  write: (text: string) => void,
): Promise<ApprovalBody> {
  write("  Allow it? [y/N] ");
  const line = await readLine();
  return { answer: line?.trim().toLowerCase().startsWith("y") === true ? "allow" : "deny" };
}

/**
 * One answer for each question, or a skip of them all. An input that ends skips. Null when another
 * front end answered first: the rest of the questions would wait for nobody.
 */
async function readQuestionAnswers(
  questions: readonly ApprovalQuestion[],
  readLine: () => Promise<string | null>,
  write: (text: string) => void,
  isOpen: () => boolean,
): Promise<ApprovalBody | null> {
  const answers: QuestionAnswer[] = [];
  for (const [index, question] of questions.entries()) {
    for (;;) {
      if (!isOpen()) return null;
      const which = questions.length === 1 ? "" : ` ${String(index + 1)}`;
      write(`  Answer${which} (a number, or your own text; an empty line skips): `);
      const line = await readLine();
      if (line === null) return { answer: "deny" };
      if (!isOpen()) return null;
      const read = readQuestionAnswer(question, line);
      if (read.kind === "skip") return { answer: "deny" };
      if (read.kind === "answer") {
        answers.push(read.answer);
        break;
      }
      write(`  ${read.message}\n`);
    }
  }
  return isOpen() ? { answer: "allow", answers } : null;
}

/**
 * Reads one typed answer. Numbers in range pick options, with commas for several. Text with a
 * letter is an own answer. Any other line of digits, commas and signs asks again, so a typo never
 * becomes an own answer.
 */
export function readQuestionAnswer(
  question: ApprovalQuestion,
  line: string,
): { kind: "answer"; answer: QuestionAnswer } | { kind: "skip" } | { kind: "again"; message: string } {
  const text = line.trim();
  if (text === "") return { kind: "skip" };
  if (!/^[\d\s,+-]+$/.test(text)) return { kind: "answer", answer: { selected: [], other: text } };
  const parts = text.split(",").map((part) => part.trim());
  const picked = [...new Set(parts.map((part) => Number(part) - 1))].sort((a, b) => a - b);
  if (
    parts.some((part) => !/^\d+$/.test(part)) ||
    picked.some((option) => option < 0 || option >= question.options.length)
  ) {
    return { kind: "again", message: `Pick a number from 1 to ${String(question.options.length)}.` };
  }
  if (!question.multiSelect && picked.length > 1) return { kind: "again", message: "Pick one option." };
  return { kind: "answer", answer: { selected: picked } };
}

/** The questions with their numbered options, as `eva chat` asks them. */
function describeQuestions(questions: readonly ApprovalQuestion[]): string {
  const intro = questions.length === 1 ? "Eva has a question." : `Eva has ${String(questions.length)} questions.`;
  const lines = questions.flatMap((question) => [
    `    ${question.header === "" ? "" : `[${question.header}] `}${question.question}${question.multiSelect ? " (one or more)" : ""}`,
    ...question.options.map(
      (option, index) =>
        `      ${String(index + 1)}. ${option.label}${option.description === "" ? "" : `: ${option.description}`}`,
    ),
  ]);
  return [`  ? ${intro}`, ...lines].join("\n") + "\n";
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
  if (!renamed.ok) return `Eva refused the new title: ${(await refusalOf(renamed)).message}\n`;
  return `The chat is now called ${((await renamed.json()) as { title: string }).title}.\n`;
}

/**
 * Prints each event of one chat. It writes the pieces of a block as they come, so at the block's
 * final text it writes only the rest. A final text that differs, such as a redacted one, comes again in full.
 */
export function createEventPrinter(): (event: SessionEvent) => string | null {
  let written = "";
  let lineOpen = false;
  return (event) => {
    if (event.kind === "text_delta") {
      // A block that starts again leaves the old pieces on their own line.
      const endLine = event.startsBlock === true && lineOpen ? "\n" : "";
      written = (event.startsBlock === true ? "" : written) + event.text;
      lineOpen = true;
      return `${endLine}${event.text}`;
    }
    const described = describeEvent(event);
    if (event.kind === "text" && written !== "") {
      const block = written;
      const endLine = lineOpen ? "\n" : "";
      written = "";
      lineOpen = false;
      return event.text.startsWith(block) ? `${event.text.slice(block.length)}\n` : `${endLine}${event.text}\n`;
    }
    if (event.kind === "turn_finished" || event.kind === "turn_failed") written = "";
    if (!lineOpen || (described === null && event.kind !== "turn_finished")) return described;
    // The pieces left a line open: end it before anything else.
    lineOpen = false;
    return `\n${described ?? ""}`;
  };
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
      if (event.questions !== undefined) return describeQuestions(event.questions);
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
    case "text_delta":
      // The printer writes the pieces, because only it knows which part of the block is out.
      return event.text;
    // The person typed the message in this terminal, and `eva work` prints the Project chat it started.
    case "message_received":
    case "project_work_started":
    case "turn_finished":
    case "tool_finished":
    case "approval_resolved":
      return null;
    case "session_renamed":
      // The terminal shows no title, and its own /rename answers from the request.
      return null;
    case "session_seen":
    case "session_archived":
    case "fork_named":
      // Only the web app has a list with unread and archived chats, and fork names.
      return null;
    case "session_closed":
      return "Eva closed this chat to reuse its clone. Start a new chat to go on.\n";
  }
}
