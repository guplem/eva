# Plan: Telegram replies on failure, and Markdown fixes

Issue: #504.

## Motivation

Eva works from a phone, so every problem must reach the phone. Today a failed Telegram update ends in silence. Two Markdown bugs also make answers hard to read, on Telegram and on the web.

## Changes

1. **Reply when an update fails.** In `pollOnce` (`src/frontends/telegram/telegram-bot.ts`), after the log, send "The message failed: <reason>" to the chat and topic of the update. Use `describeError`, so the reason is redacted. Use a send that cannot throw.
2. **Share the opening fence rule.** Move the CommonMark opening fence rule into `src/frontends/markdown-fence.ts`. A backtick fence has no backtick after it on its line. Telegram and the web both use the shared rule.
3. **Keep the main chat when /new fails.** In `openChat`, call `createForumTopic` through `callWithRetry`. Treat only a `TelegramError` with code 400 as "no topics", as `openTopicFor` does (lesson 61). For any other error, reply "Telegram did not open the topic: <reason> Send /new again." and stop.
4. **Allow parentheses in a link.** In `src/frontends/markdown-inline.ts`, let the URL hold one level of balanced parentheses.
5. **Honour a long 429 wait.** In `src/frontends/telegram/telegram-sender.ts`, wait the full `retry_after` up to 120 seconds. When Telegram asks for more, give up at once: an early retry only fails again.

## Gaps and decisions

- **Which chats get the failure reply?** Only the allowed chat, from an allowed sender. The bot is private (lessons 63, 127): a stranger gets only their chat id. A failure before pairing gets no reply, as now.
- **Which update kinds?** A message and a button press. An edited message only updates a live location and sends nothing, so it stays silent.
- **Where does the shared fence rule live?** In `markdown-fence.ts`, which already holds the closing rule for both front ends. One function returns the indent, the fence and the info string.
- **What cap for a 429 wait?** 120 seconds. Telegram's flood waits are often under a minute. A longer wait blocks the poll loop too long. Decision for the owner: a poll-loop send can now wait up to 120 seconds before a retry, not 30.
- **Sub-agents.** This session cannot start sub-agents. The author filled each gap from `AGENTS.md`, the lessons and the code, and did the reviews alone.
