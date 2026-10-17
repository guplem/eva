# Plan: restart Eva after a crash on Windows (issue #12)

This file is a working plan. The last commit of the PR deletes it; the PR body keeps the final plan.

## Goal

On Windows, Eva starts again within a minute after a crash.
She does not start again after a clean stop (exit code 0), bad settings (2), or a second instance (3).
These exit codes are a contract with the supervisor (lesson 89, `src/shared/exit-codes.ts`).

## State today

- Linux: done in PR #28. `eva service install` writes a systemd user unit with `Restart=on-failure` and `RestartPreventExitStatus=2 3`, and runs `loginctl enable-linger` (lesson 85).
- Windows: `eva service install` creates a logon task (`schtasks /Create /SC ONLOGON`) and starts it now (`schtasks /Run`).
  Nothing restarts Eva when she crashes.
- `restartMethod` in `src/frontends/cli/service.ts` decides how Eva restarts after an update: exit code 4 under systemd, or a new copy of herself anywhere else.

## Steps

1. Add the restart policy as a pure function: given an exit code, return "stop" or "restart after N ms". Red-green: unit tests.
2. Add the supervisor loop behind a seam, so tests drive it with a fake child. Red-green: unit tests.
3. Make the Windows logon task run the supervisor instead of Eva herself. Red-green: update the `windowsTaskCommand` test.
4. Let the supervisor own the update restart too (exit code 4), so `restartMethod` returns "supervisor" under it.
5. Update `docs/guide/setup.md` and the comments in `service.ts`.
6. Delete this plan file.

## Gaps

- G1. The restart mechanism on Windows: a supervisor process that Eva ships, Task Scheduler's own "restart on failure" setting (task XML), or a task that repeats each minute.
- G2. How the supervisor starts the long-lived Eva child: the `ProcessRunner` seam runs a command to its end with a timeout, which does not fit a process that runs for days. Also: how to limit a crash loop.
- G3. How the supervisor and Eva agree on the update restart (exit code 4) and on `restartMethod`.

## Decisions

(Filled in after the gap review.)
