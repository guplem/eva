# Plan: answer AskUserQuestion from every front end (#544)

## Motivation

Claude Code's `AskUserQuestion` tool asks the person a multiple-choice question.
In a terminal, Claude Code shows a form.
Through the Agent SDK, the question reaches Eva's `canUseTool` callback.
Eva showed it as a tool approval with the raw JSON, and only "Allow once" and "Deny".
An allow carries no answers, so the model got "The user did not answer the questions".
In an Assistant chat, Eva let the tool through with no question, with the same empty result.

Goals that apply:

- **Eva works from a phone.** The question must reach the web app and Telegram, and the answer must reach the model.
- **Project mode is a transparent wrapper.** In a terminal, the person answers the form. Eva must give the same form.
- **Reuse a shared component before you add one.** An approval already reaches every front end, waits, times out and expires.

The first commit of this branch is a stopgap: Eva denies the tool and tells the model to ask in plain text.
This plan replaces it with a real form, and keeps the plain-text message as the fallback.

## SDK facts

- The input is `{ questions: [{ question, header, options: [{ label, description, preview? }], multiSelect }] }`, with 1 to 4 questions and 2 to 4 options.
- The answer goes back as `{ behavior: "allow", updatedInput: { ...input, answers: { [question]: answer } } }`.
- A multi-select answer is the labels joined by ", ". A free-text answer ("Other") is the text itself.

## Gaps and decisions

1. **New event kind, or an extended approval?**
   Decision: extend the approval. `approval_needed` gets an optional `questions` field.
   `approval_resolved` gets an optional `answers` field, so other front ends can show what the person picked.
   `PendingApproval` gets the redacted `questions` too, so a front end that reconnects still shows the form.
   The `summary` is the first question, so an older reader and the push text still show something useful.
   The session manager checks each answer: the right count, indexes in range, one choice for a single-choice question, and no empty answer.
   It refuses a bad answer, and a plain "allow" with no answers, with the new code `approval_invalid`. The API sends 400, and the question stays open.
   A plain "deny" is Skip.
   The pending list, the time-out, the stop and the "Needs you" state then work with no new code.
2. **The engine port.**
   Decision: `TurnRequest` gets `askQuestions(questions) => Promise<QuestionAnswers | "declined" | "expired">`.
   `requestApproval` keeps its strict `"allow" | "deny"` answer. pi has no such tool and ignores it.
   Answers are an array in the order of the questions. Each answer is `{ selected: number[]; other?: string }`: option indexes, or the person's own text.
   Indexes, not labels: the front ends see redacted labels, and the model must get the original ones.
   The adapter maps each index to the original label and joins several with ", ". Own text wins over a selection.
   The field is required, so the compiler finds each place that builds a `TurnRequest`.
3. **What the model gets when there is no answer.**
   Decision: "declined" (the person pressed Skip) denies with "The person chose not to answer these questions."
   "expired" (nobody answered in time) denies with the plain-text message of the stopgap, so the model asks in its reply.
   An input that does not match the schema also gets the plain-text message.
   A model call denies the tool with no question, as it denies every tool. The adapter checks the mode first.
4. **Web UI.**
   Decision: the approval card shows each question with its header chip, one button per option, the description under the label, and an "Other" text field.
   One choice per question, or several when `multiSelect` is true. "Send" stays off until every question has an answer. "Skip" declines.
   The notice for a chat that is not on screen says "Eva has a question in …".
5. **Telegram.**
   Decision: one message per question set. It shows one question at a time, with one button per option and a "Skip" button.
   A multi-select question toggles its buttons, then "Done" sends that question's answer.
   A reply to the question message is a free-text answer to the current question.
   Callback data: `q:<requestId>:<question index>:<option index>`, `q:<requestId>:<question index>:done`, `q:<requestId>:skip`.
   The request id is a 36-character UUID, so each fits the 64-byte limit. The question index keeps a stale button from answering the next question.
   The flow lives in its own file, `telegram-questions.ts`, like `telegram-conflicts.ts`. Its state is in memory, and goes on `approval_resolved`.
   `TelegramMessage` gets `reply_to_message`. A plain text that is no reply goes to the chat as today, and the question stays open.
6. **CLI (`eva chat`).**
   Decision: print each question with numbered options. A line of numbers in range picks options (comma-separated for multi-select). Other text is a free answer. An empty line skips.
7. **The `preview` field.** Decision: not shown in this change. It is optional, and the label and description carry the choice.
8. **Push notification.** Decision: "Eva has a question: <first question>" in place of "Eva waits for your approval".
9. **Redaction.** Decision: redact the question, header, label and description texts in `approval_needed` and in `PendingApproval`, and the own text of each answer in `approval_resolved`. The model gets the original texts.
10. **Stored names.** Events are not stored, and the web page ships with the core. New fields are optional, so an older client ignores them.

## Steps

1. Shared types and the engine port: `ApprovalQuestion`, `QuestionAnswers`, `askQuestions`.
2. Session manager: questions in the pending approval, answers in `answerApproval`, redaction, events.
3. Claude Code adapter: parse the input, call `askQuestions`, build `updatedInput.answers`.
4. Local API: accept `answers` in `POST /api/approvals/:id`.
5. Web: the question card and the notice.
6. Telegram: the question message, buttons and replies.
7. CLI: the questions in `eva chat`.
8. Push notification text.
