# Plan: change the model of a chat between turns (#545)

## Motivation

A person cannot change the model after the first message. They must start a new chat and lose its context.
Lesson 41 says: "A model belongs to a conversation. A switch throws the cache away, so the UI warns."
v1 allowed the switch with a warning. Eva v2 turned the warning into a lock.
Each turn already sends the model to the engine, so the lock is a choice, not a limit.

## Changes

1. `SessionManager.setModel` accepts a change after the first turn. It refuses only while a turn runs.
2. The web app chip offers the model group in a chat with turns, with a cache warning. The engine stays locked.
3. Telegram: a press on a model button of a started chat changes the model and says so.

## Gaps

1. **Fact:** do both engines take a new model on a continued session?
2. **Decision:** may a fork change its model?
3. **Decision:** the chip names the model that answered the newest turn. After a switch, that name is old. What does the chip show?
4. **Decision:** what does Telegram say after a press?
5. **Decision:** the words and the place of the cache warning.
6. **Decision:** the error code and text when a turn runs.

## Decisions

1. **Yes.** The core reads the record at each turn start and sends `model` every turn. Claude Code sets `options.model` next to `resume`. pi gets `--model` next to `--session`. Known gap: on pi, an alias that maps to no pi model sends no `--model`, so a continued pi session can keep its last model. Eva never sends RPC `set_model`, because it writes the person's global pi settings.
2. **Yes.** `setModel` never checked `parentId`. Only the engine ties a fork to its parent's engine session.
3. **Each turn stores the alias it ran with** (`turns[].modelAlias`, optional, read tolerantly, so no migration). The chip names the answered model only when the newest answered turn ran with the chat's current alias. A turn from before the field counts as a match.
4. **A message in the topic.** `answerCallbackQuery` goes out before the action, and a toast goes away in seconds. A refusal while a turn runs also gets a message.
5. **A muted `<p>` under the Model group**, the existing `.chip-menu p` pattern. It shows only when the chat has history: turns, or a fork.
6. **`session_busy`,** with a new text. Refuse only while `isBusy`: a change during the 1-second gather goes to the gathered turn.
