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

1. Add the restart policy as a pure function (D4). Red-green: unit tests.
2. Add the `LongProcessStarter` seam (D2). Red-green: a test with a real short child.
3. Add the supervisor loop (D4, D5). Red-green: unit tests with a fake starter, sleep and clock.
4. Add `eva supervise`, wire it in `main.ts`, and make the Windows logon task run it. `restartMethod` reads `EVA_SUPERVISED`. Red-green: argument, `windowsTaskCommand` and `restartMethod` tests.
5. Let a self-update succeed while the old executable is still open (D6). Red-green: a test with an `.old` that cannot be removed.
6. Update `docs/guide/setup.md` and the comments in `service.ts`.
7. Delete this plan file.

## Gaps

- G1. The restart mechanism on Windows: a supervisor process that Eva ships, Task Scheduler's own "restart on failure" setting (task XML), or a task that repeats each minute.
- G2. How the supervisor starts the long-lived Eva child: the `ProcessRunner` seam runs a command to its end with a timeout, which does not fit a process that runs for days. Also: how to limit a crash loop.
- G3. How the supervisor and Eva agree on the update restart (exit code 4) and on `restartMethod`.

## Decisions

Nine reviewers (three per gap) agreed on each point below.

- D1 (G1). Eva ships her own supervisor: a new `eva supervise` command that the Windows logon task runs.
  Task Scheduler's "restart on failure" fires only when a task fails to launch, and it cannot skip exit codes 2 and 3.
  A task that repeats each minute restarts Eva after a clean stop, and it hits the lock (exit 3) each minute.
- D2 (G2). A new seam, `LongProcessStarter` in `src/shared/long-process.ts`, starts a child that runs for days.
  `ProcessRunner` buffers output and stops the child at a timeout, so it does not fit.
  The seam has no run timeout. Each wait around it is bounded instead: the restart delay and the stop (lesson 81).
- D3 (G2). The child is Eva herself, not an agent, so she gets the supervisor's whole environment, as `startNewCopy` does today (lesson 96 covers agents).
- D4 (G2). The pure policy and the loop live in `src/core/instance/supervisor.ts`, beside the lock and the run marker.
  Exit 0, 2 and 3 stop the supervisor with the same code. Exit 4 restarts at once.
  Any other exit restarts after 5 s, then 10 s, 20 s and 30 s at most, so a restart always comes within a minute.
  A run of 10 minutes or more resets the delay. The supervisor never gives up: the phone is the only way in.
  Each restarted Eva already reports the unclean exit to the phone through the run marker.
- D5 (G3). The supervisor sets `EVA_SUPERVISED=1` for the child. `restartMethod` then returns "supervisor", so an update exits 4 and the supervisor restarts the new code.
  Without it, Eva starts a detached copy and exits 0, and the supervisor stops.
- D6 (G3). The supervisor does not restart itself after an update. It stays small and rarely changes.
  On Windows, the running supervisor keeps `eva.exe.old` open, so the next update cannot delete that file.
  `replaceExecutable` then moves the old file aside under a unique name, and it removes the older leftovers that it can.
