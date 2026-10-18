# Plan: let agents run the safe commands without a prompt (#89)

This is the working plan for #89. The last commit of the PR deletes it.

## Goal

An agent session in "Accept edits" mode implements an issue end to end with no permission prompt.

## Owner decisions

- Keep no `ask` rule. Allow `git push`, a PR merge and the GitHub write tools. The file keeps `"ask": []` to record this.
- Keep the default mode. Do not set `"defaultMode": "acceptEdits"`, because it would change local sessions too.
- Do not allow `python3 -`. A test showed that a script reads `.env` past every `Read` deny rule. Agents use the Edit and Write tools for multi-line edits.

## How Claude Code matches rules (tested on Claude Code 2.1.302)

- It splits a command at `&&`, `||`, `;`, `|`, `&` and newlines. Each part must match an allow rule. A deny rule matches when any part matches. Deny beats allow.
- It runs read-only commands with no rule: `cat`, `echo`, `grep`, `head`, `tail`, `wc`, `sort`, `uniq`, `sed -n`, `find` (no `-exec` or `-delete`), `ps`, `pgrep` and `git rev-parse`.
- It skips `2>&1`, `>/dev/null` and heredoc bodies. It checks a `> file` target like an Edit of that file.
- It strips `timeout`, `time`, `nice` and `nohup`, so the rule for the inner command applies.
- A `*` matches any text, spaces too, anywhere in the rule.
- No rule can lift these prompts. `AGENTS.md` tells agents how to avoid them:
  - `&&` before a heredoc, or text after `<<'EOF'` on the same line.
  - An unquoted heredoc delimiter (`<<EOF`).
  - A `$VAR` in a path or a redirect target.
  - `cd <folder> && git ...`.
- MCP rules name `mcp__<server>__<tool>`. A glob works only after the server name. A rule with parentheses is skipped.
- `.claude/settings.json` is a protected path. An agent gets a prompt before it edits it, and that is good.

## Decisions

1. Allow the commands from the issue with the narrowest rules that work. Use the space form (`Bash(git fetch *)`).
2. Allow `git push` only to `origin`. A push to a vault path or URL then prompts.
3. Allow the GitHub read and PR tools by name. Deny `push_files`, `create_or_update_file`, `delete_file`, `create_repository` and `fork_repository`: they commit past the pre-push check, and could write to a vault repository.
4. Allow the session tools by name: `Agent`, `ToolSearch`, `ScheduleWakeup`, `ReadNotifications`, `spawn_task`, `dismiss_task`, `subscribe_pr_activity`, `unsubscribe_pr_activity`, `send_later` and `delete_trigger`. Never allow `mcp__claude-code-remote__*`: it also creates and messages sessions. The effect of the `delete_trigger` rule is not verified.
5. Allow writes in the session folders with `Edit(//tmp/claude-*/**)`. Do not allow all of `/tmp`, which other processes share.
6. Deny force-push, history rewrites, discarded changes and hook skips (`--no-verify`).
7. Replace the secret rules with absolute patterns (`//**/`). The old `Read(**/secrets.json)` was relative to the clone, so it missed Eva's own `secrets.json`. Mirror the secret file names in `src/core/files/vault-files.ts`.
8. Test the file in `test/unit/agent-settings.test.ts`. The test checks the deny rules, the empty `ask` list and a set of banned allow rules. It has no `src/` twin, like `coverage-gaps.test.ts`.

## Known limits

- `grep -r` and any `bun run` script can still read a secret. Only the sandbox closes that.
- Deny rules do not see `git -c x=y push` or `sh -c`. They catch mistakes, not a hostile agent. The GitHub ruleset on `main` is the real guard against a force-push.
