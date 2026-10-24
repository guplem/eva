/**
 * The model's questions in Telegram (issue #544): one message that shows one question at a time,
 * with a button for each option. A reply to the message is the person's own answer.
 */
import type { Eva } from "../../core/eva.ts";
import type { ApprovalQuestion, QuestionAnswer, QuestionAnswers, SessionEvent } from "../../shared/events.ts";
import { answerText, pickOption } from "../../shared/questions.ts";
import { telegramMessageLimit, type TelegramSender } from "./telegram-sender.ts";

/** A button shows a short label. Telegram cuts a longer one itself, with no sign. */
const buttonLabelLimit = 60;

export interface TelegramQuestionsOptions {
  readonly eva: Eva;
  readonly sender: TelegramSender;
}

/** A question message, and the answers so far. It lives in memory: an approval ends with the core anyway. */
interface QuestionForm {
  readonly chatId: number;
  readonly messageId: number;
  /** Where the questions come from, for a chat that lives elsewhere: "" or ` (in “title”)`. */
  readonly where: string;
  readonly questions: readonly ApprovalQuestion[];
  readonly answers: QuestionAnswer[];
  /** The options picked so far in a multiple-choice question, before Done. */
  picked: number[];
}

export class TelegramQuestions {
  private readonly eva: Eva;
  private readonly sender: TelegramSender;
  private readonly forms: Map<string, QuestionForm>;

  constructor(options: TelegramQuestionsOptions) {
    this.eva = options.eva;
    this.sender = options.sender;
    this.forms = new Map();
  }

  /** Sends the first question of an approval with questions. */
  async show(
    chatId: number,
    topicId: number | null,
    event: Extract<SessionEvent, { kind: "approval_needed" }>,
    chatTitle: string | null,
  ): Promise<void> {
    const questions = event.questions ?? [];
    const where = chatTitle === null ? "" : ` (in “${chatTitle}”)`;
    const form = { where, questions, answers: [], picked: [] };
    const messageId = await this.sender.send(chatId, topicId, questionText(form), keyboard(event.requestId, form));
    if (messageId !== null) this.forms.set(event.requestId, { ...form, chatId, messageId });
  }

  /** True when this request is a question message of this bot. */
  has(requestId: string): boolean {
    return this.forms.has(requestId);
  }

  /**
   * A press of a question button. Returns the short note for the press, or null for none.
   * `step` is the question index, or "skip". `choice` is an option index or "done".
   */
  async press(requestId: string, step: string | undefined, choice: string | undefined): Promise<string | null> {
    const form = this.forms.get(requestId);
    if (form === undefined) return "This question is closed.";
    // Every question has its answer, and the close is on its way.
    if (form.answers.length >= form.questions.length) return "This question is closed.";
    if (step === "skip") {
      this.eva.sessions.answerApproval(requestId, "deny");
      return "Skipped";
    }
    // A button of an earlier question stays on screen until the edit lands.
    if (step !== String(form.answers.length)) return "This question has moved on.";
    const question = form.questions[form.answers.length];
    if (question === undefined) return null;
    if (choice === "done") {
      if (form.picked.length === 0) return "Pick at least one option.";
      await this.next(requestId, form, { selected: form.picked });
      return null;
    }
    const option = Number(choice);
    if (!Number.isInteger(option) || question.options[option] === undefined) return null;
    if (!question.multiSelect) {
      await this.next(requestId, form, { selected: [option] });
      return null;
    }
    form.picked = pickOption(form.picked, option, true);
    await this.edit(requestId, form);
    return null;
  }

  /** A reply to a question message answers its current question. False when the reply is to no question. */
  async reply(chatId: number, messageId: number, text: string): Promise<boolean> {
    const found = [...this.forms].find(([, form]) => form.chatId === chatId && form.messageId === messageId);
    if (found === undefined) return false;
    const [requestId, form] = found;
    // Every question has its answer, and the close is on its way: the text is a message of the chat.
    if (form.answers.length >= form.questions.length) return false;
    await this.next(requestId, form, { selected: [], other: text });
    return true;
  }

  /** Shows the end of the questions in their message, with no buttons. Every front end may have answered. */
  async close(event: Extract<SessionEvent, { kind: "approval_resolved" }>): Promise<void> {
    const form = this.forms.get(event.requestId);
    if (form === undefined) return;
    this.forms.delete(event.requestId);
    const head = `Eva asked${form.where}:`;
    const end =
      event.answers === undefined
        ? event.timedOut
          ? "Not answered in time"
          : "Skipped"
        : `Answered:\n${answerLines(form.questions, event.answers)}`;
    await this.sender.quietCall("editMessageText", {
      chat_id: form.chatId,
      message_id: form.messageId,
      text: `${head}\n\n${end}`.slice(0, telegramMessageLimit),
    });
  }

  private async next(requestId: string, form: QuestionForm, answer: QuestionAnswer): Promise<void> {
    form.answers.push(answer);
    form.picked = [];
    if (form.answers.length < form.questions.length) {
      await this.edit(requestId, form);
      return;
    }
    // The form builds only fitting answers. The close comes with the approval_resolved event.
    this.eva.sessions.answerApproval(requestId, "allow", form.answers);
  }

  private async edit(requestId: string, form: QuestionForm): Promise<void> {
    await this.sender.quietCall("editMessageText", {
      chat_id: form.chatId,
      message_id: form.messageId,
      text: questionText(form).slice(0, telegramMessageLimit),
      reply_markup: keyboard(requestId, form),
    });
  }
}

type FormView = Pick<QuestionForm, "where" | "questions" | "answers" | "picked">;

function questionText(form: FormView): string {
  const index = form.answers.length;
  const question = form.questions[index];
  if (question === undefined) return "";
  const count = form.questions.length;
  const intro =
    count === 1
      ? `Eva has a question${form.where}.`
      : `Eva has ${String(count)} questions${form.where}. Question ${String(index + 1)} of ${String(count)}.`;
  const header = question.header === "" ? "" : `[${question.header}] `;
  const options = question.options.map(
    (option, at) => `${String(at + 1)}. ${option.label}${option.description === "" ? "" : `: ${option.description}`}`,
  );
  const how = question.multiSelect
    ? "Pick one or more options, then press Done. Or reply to this message with your own answer."
    : "Pick an option, or reply to this message with your own answer.";
  return [intro, "", `${header}${question.question}`, ...options, "", how].join("\n");
}

function keyboard(requestId: string, form: FormView): unknown {
  const index = form.answers.length;
  const question = form.questions[index];
  if (question === undefined) return { inline_keyboard: [] };
  const options = question.options.map((option, at) => {
    const mark = question.multiSelect && form.picked.includes(at) ? "✓ " : "";
    return [
      {
        // A cut by code point never splits a surrogate pair, which Telegram would refuse.
        text: Array.from(`${mark}${option.label}`).slice(0, buttonLabelLimit).join(""),
        callback_data: `q:${requestId}:${String(index)}:${String(at)}`,
      },
    ];
  });
  const done = question.multiSelect ? [{ text: "Done", callback_data: `q:${requestId}:${String(index)}:done` }] : [];
  return { inline_keyboard: [...options, [...done, { text: "Skip", callback_data: `q:${requestId}:skip` }]] };
}

/** One line for each question: its text and the answer, in the labels that Telegram showed. */
function answerLines(questions: readonly ApprovalQuestion[], answers: QuestionAnswers): string {
  return questions
    .map((question, index) => {
      const answer = answers[index];
      const text = answer === undefined ? null : answerText(question, answer);
      return `• ${question.question}\n  ${text ?? "?"}`;
    })
    .join("\n");
}
