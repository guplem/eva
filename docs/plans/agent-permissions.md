# Plan: let agents run the safe commands without a prompt (#89)

This is the working plan for #89. The last commit of the PR deletes it.

## Goal

An agent session in "Accept edits" mode implements an issue end to end with no permission prompt. The owner chose to keep no `ask` rule: `git push`, a PR merge and the GitHub write tools are allowed too.

## Steps

1. Find how Claude Code matches a `Bash(...)` rule against a chain: `&&`, `;`, `|`, redirects, heredocs, `cd`, `VAR=value` and `timeout`.
2. Add allow rules for the commands and tools that the issue lists, each as narrow as its use allows.
3. Remove the `ask` rules for `git push*` and `gh pr merge*`, as the owner decided.
4. Add `deny` rules for the dangerous forms: force-push, history rewrites, discarded changes and secrets.
5. Add a test that reads `.claude/settings.json` and checks the safety rules, so a later edit cannot drop them.
6. Record in the file, or in `AGENTS.md`, the owner's choice about `ask` rules.

## Gaps

1. How does a rule match a chain, a heredoc, a redirect, `cd`, a variable and `timeout`?
2. What is the rule syntax for MCP tools, the `Agent` tool and the session tools? Can an allow rule remove the prompt of `mcp__claude-code-remote__delete_trigger`?
3. How does a rule name the session's scratchpad folder and the temporary folder, when the path changes per session?
4. Which rules let an agent read a secret, push to a vault, force-push, rewrite history or discard changes? `python3 -`, `sed -i` and `cat` can run or read anything. How narrow can those rules be?
5. Does a test of `.claude/settings.json` fit the project, and where does it live?
