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
3. Allow the GitHub read tools by glob (`get_*`, `list_*`, `search_*`), because they only read. Allow the PR and issue write tools by name. Deny `push_files`, `create_or_update_file`, `delete_file`, `create_repository` and `fork_repository`: they commit past the pre-push check, and could write to a vault repository.
4. Allow the session tools by name: `Agent`, `ToolSearch`, `ScheduleWakeup`, `ReadNotifications`, `spawn_task`, `dismiss_task`, `subscribe_pr_activity`, `unsubscribe_pr_activity`, `send_later` and `delete_trigger`. Never allow `mcp__claude-code-remote__*`: it also creates and messages sessions. The effect of the `delete_trigger` rule is not verified.
5. Allow writes in the session folders with `Edit(//tmp/claude-*/**)`. Do not allow all of `/tmp`, which other processes share.
6. Deny force-push, history rewrites, discarded changes and hook skips (`--no-verify`).
7. Replace the secret rules with absolute patterns (`//**/`). The old `Read(**/secrets.json)` was relative to the clone, so it missed Eva's own `secrets.json`. Mirror the secret file names in `src/core/files/vault-files.ts`.
8. Test the file in `test/unit/agent-settings.test.ts`. The test checks the deny rules, the empty `ask` list and a set of banned allow rules. It has no `src/` twin, like `coverage-gaps.test.ts`.
9. Add no rule for `find`, `sort`, `uniq` or `sed`. Claude Code already runs their read-only forms. A `*` rule would also allow `find -delete`, `sort -o`, and the GNU sed `e` command, which runs a shell command.
10. Add no rule for `cp` or `mv`. A rule such as `cp * /tmp/claude-*` also allows `cp .env /tmp/claude-0/x`, which copies a secret where no deny rule reads it.
11. Deny the common grouped short flags, such as `-qf`, `-pf`, `-rf`, `-Af`, `-qd` and `-SW`. Deny `--upload-pack`, `--receive-pack` and `--exec`, which run a command. Deny `--output` on `git log`, `git diff` and `git show`, which overwrites a file.
12. Write each long option in a deny rule as a short prefix, such as `--am*` for `--amend`. Git accepts any unique prefix of a long option (tested: `--wor` and `--am` worked).
13. Deny the engine logins in Eva's instance home: `.credentials.json`, `auth.json`, `gh/hosts.yml` and `engines/google/`.
14. Write each commit message with a heredoc. A deny rule matches text in `-m "..."`, so a message that names `--amend` fails. A heredoc body is not checked (tested).

## Tested answers to the issue's questions

- Line breaks inside a quoted `-m` message do not stop a rule from matching.
- `git commit -q -F - <<'EOF'` runs with no prompt once `git commit *` is allowed. The old prompts came from `git add` and `git commit`, which had no rule.
- A `Read` deny rule also stops `cat`, `head`, `tail`, `grep` and `sed` when they name the file. `cat sub/.env` was refused.

## Known limits

- `rm -rf <scratchpad>/test-results` still prompts. A `*` in the rule also spans extra arguments: a test showed that such a rule deleted a folder in the clone.
- `sed -i` still prompts. Use the Edit tool.
- `mkdir` and `mktemp` run in any folder. Neither one deletes data.
- Deny rules list known flag groups only. A rare group, such as `git commit -anm`, gets past them.
- The GitHub write tools take any repository. An agent could merge a PR in a vault repository. The owner allowed these tools.
- `grep -r` and any `bun run` script can still read a secret. Only the sandbox closes that.
- Deny rules do not see `git -c x=y push` or `sh -c`. They catch mistakes, not a hostile agent. The GitHub ruleset on `main` is the real guard against a force-push.
