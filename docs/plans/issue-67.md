# Plan: show the subscription usage limit on the phone (#67)

Each turn on a subscription token runs inside a 5-hour and a 7-day usage window. The SDK reports the window state as a `rate_limit_event` message. Eva drops it today, so a person learns about the limit only from a failed turn.

## Decisions

- Add the engine event `usage_limit`. Its fields: `status` (`warning` or `rejected`), `window`, `usedPercent` and `resetsAt`.
- Map only the structured fields of `rate_limit_info` (lesson 36). The adapter sends no event for `allowed`: the captured fixtures show one `allowed` event at the start of each turn, and it needs no line.
- Convert `utilization` (a fraction, 0.06 in the captured fixtures) to a whole percent. Convert `resetsAt` (Unix seconds) to an ISO time.
- Map an unknown window name to `other`, so a new SDK value never breaks the event.
- Put the line text in one shared function, `describeUsageLimit`, so every front end says the same thing.
- Telegram: send the line in the chat's order. Use the `timeZone` setting, because a server clock is often UTC. Send a warning once for each window and reset time. Always send a refusal, because it explains a failed turn.
- Web: keep the last line of each chat in the live state, and show it above the message box. Clear it when the next turn of the chat starts. Format the time in the phone's own time zone.
- Terminal: print the line, as for the other notices.
- The session manager keeps the event as it is: it holds no text to redact.

## Steps

1. Event type and adapter map, with a parser test on the captured `rate_limit_event` fixture.
2. The shared line text, with tests.
3. Telegram line, with a test.
4. Web live state and line, with a test.
5. Terminal line.
