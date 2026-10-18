# Plan: let the person set how chats are named (issue 50)

## Today

- A chat takes the first line of its first message as its title, cut to 60 characters (`titleOf` in `src/core/sessions/session-manager.ts`).
- No model names a chat. The "chat name skill" in the issue does not exist yet.
- The person can rename a chat from the web page, Telegram and the terminal. A rename emits `session_renamed`, and Telegram renames the topic.

## Decisions (owner)

- Eva names a chat with one short model call after the first turn. The rules live in an optional vault file.
- Assistant chats and project chats both get names. The call runs outside the clone, so the project session sees nothing of Eva's.
- Claude Code uses `haiku`. pi uses the chat's own model, because pi has no fixed cheap model.
- Eva names a chat once. A rename by the person always wins.
- The owner asked for a general model-call module, so that later features (such as suggested replies) can ask a model for one answer.

## Design

### 1. Model calls: one question, one answer

A model call is one question to a model, outside every chat, with one text answer. It is not a session and has no history.

- `src/core/model-calls/model-calls.ts` holds `ModelCalls`. Its `ask()` takes an engine, a model, a system prompt, a prompt, named context blocks, an optional time limit and an optional stop signal. It returns the answer text, or a failure: `missing`, `late`, `aborted` or `failed`, with a redacted reason.
- It uses the engine port, so the person's own engine login pays for it. No API key, no new vendor.
- It runs in a new empty folder. A deadline ends the call even when the engine ignores the abort. It never throws.
- A context text can come from other people. Each `<` in it becomes `&lt;`, so the text can never close its block.
- The new type `TurnMode` adds a third value, `model-call`, to the two session modes. The adapters run it with no tools, no settings, no context files, no skills, no MCP servers and no saved session, and they deny every approval:
  - Claude Code: `tools: []`, `settingSources: []`, `persistSession: false`, `strictMcpConfig: true`, hooks and auto memory off, and the given system prompt.
  - pi: `--no-session`, `--no-tools`, `--no-extensions` (Eva's own extension still loads with `-e`), `--no-skills`, `--no-prompt-templates`, `--no-context-files`, and `--system-prompt`. The prompt file is named by its text, so calls share it.
- `SessionMode` stays as it is, because it is stored in session records.
- The engine check in `src/core/checks.ts` uses `ModelCalls` too, so the deadline logic has one home.

### 2. Chat names

- `.eva/chat-names.md` in the vault holds the person's naming rules as prose. Without the file, or with an empty file, Eva keeps today's first-line title.
- `src/core/sessions/chat-namer.ts` builds the call: the rules, the first message and the first answer, each cut to 2000 characters. It asks for one line. It strips a label, Markdown marks, quotes and a final period from the answer.
- An empty save writes no file into a vault that has none, so the autosave has nothing to commit.
- `SessionManager` takes an optional `nameChat` function. After the first turn gives a chat its first-line title, the manager calls it in the background. The turn never waits.
- The manager applies the answer only if the title is still the first-line title. It emits `session_renamed` with `automatic: true`.
- Telegram renames a topic for an automatic name only if Eva opened the topic (lesson 125).
- `automatic` is a new optional field on a sent event. Old front ends ignore it.

### 3. Phone

- The web settings page gets a text box for the rules. It reads and writes `.eva/chat-names.md` through `GET` and `PUT /api/chat-names`. The vault autosave commits the file.
- Save sends the rules only when the person changed them, and apart from the other settings, so a failed rules save blocks nothing else. The rules stop at 4000 characters. Without a vault, the page shows no text box.

## Known limits

- A fork or a retry made while the naming call runs keeps the first-line title. Only the original chat takes the model's name.
- A person who renames a chat to exactly its first-line text while the call runs loses to the model's name. A fix needs a new stored field, which this rare case does not justify.
- The person can also ask Eva in any chat to edit the file. The assistant prompt names the file.
