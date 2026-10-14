---
name: debug
description: Root-cause a bug or a failed fix with evidence, not guesses - brainstorm causes, research them in parallel, confirm one with logs before changing code. Use when a reported behavior needs root-causing or a fix attempt has failed.
---

# Debug with evidence, not guesses

A plausible-looking cause is not enough. Turning a symptom into a fix by pattern-matching wastes a commit and loses trust. Confirm the real cause with evidence before you edit code.

1. **Brainstorm causes.** List several plausible root causes (more for a hard bug, fewer for an obvious one). Do not commit to the first idea.
2. **Research in parallel.** When the causes sit in different areas, spawn one subagent per area (a subagent is a separate agent you launch with the Agent tool) to trace that suspected code path and report whether it can actually produce the reported behavior. This keeps the files they read out of your own context. Give each subagent one focused question.
3. **Rank the causes, most likely first.** Order the surviving causes by how well they fit the evidence so far.
4. **Confirm one with targeted logs, in that order.** For the top cause, add a log line (or a breakpoint, or a small test) that would prove or disprove it, run the failing path, and read the output. Move to the next cause only after the current one is disproven. Never change logic on a theory you have not confirmed.
5. **Match the fix to the confirmed cause.** Fix exactly what the evidence points to. If the change you want to make does not address the confirmed symptom, say so and ask first; do not slip a "nice-to-have" in as a bug fix.
6. **Broaden if every theory fails.** The same symptom can come from outside the obvious code: a Bun version that differs from CI (CI pins 1.4.2), a stale `node_modules` after a `bun.lock` change (run `bun install`), `GIT_*` variables that a git hook exports into a test run (lesson 104), Windows-only behaviour (path separators, a bare `bash` that starts WSL, process tree stops, the 16 ms timer resolution: lessons 76 to 83), the instance home that `--home` or `EVA_HOME` selects, a second path to a seam that escapes the fake (lesson 102), an engine that changed its output format since the fixture was captured, and less-obvious code paths. Keep investigating; do not stop at the first dead end.

Remove the logs you added once the cause is confirmed.
