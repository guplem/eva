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

(Filled in after the gap research.)
