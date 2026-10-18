# Plan: send a satellite's alerts to Telegram through the hub (#126)

This is the working plan for #126. The last commit of the PR deletes it.

## Goal

Only the hub runs the Telegram bot. A satellite's open problems must still reach the phone. Each machine writes its open problems to the vault. The hub reads the files of the other machines and raises one alert for each problem.

## Steps

1. Add `src/core/alerts/machine-reports.ts`.
   - The file is `.eva/machines/<machine>.json`: `{ machine, version, problems: [{ key, level, message, resolvedMessage }] }`.
   - `writeMachineReport` writes the file atomically, and only when its content changes. The file has no time stamp, so an unchanged report makes no commit.
   - `readMachineReports` reads each file tolerantly, and skips a broken one.
   - The file name keeps only safe characters of the machine name.
2. Let `AlertCenter` list its open problems with their keys and levels.
3. Wire `src/core/eva.ts`: after each sync step, write this machine's report. On the hub, read the reports of the other machines and report each problem under the key `machine:<machine>:<key>`. Clear the keys that are gone. A satellite clears all of them.
4. Add the words of a relayed alert to `problem-rules.ts`: the machine name, the problem, and how to stop the alert of a machine that is gone.
5. Update `docs/guide/reference.md`.

## Gaps and decisions

1. **Which problems go in the report?** Each open problem, except two kinds:
   - `vault_sync`: a sync problem cannot travel through the sync that it breaks. A report written while the sync fails reaches the hub only after the sync works again, so it would raise a false alert.
   - `machine:*`: the relayed problems of other machines.
2. **When does a machine write its report?** After each sync step. The next save commits and pushes it. Every machine writes, the hub too, so a hub move needs no special step: the new hub reads the old hub's report.
3. **The #119 gate.** The report is outside the gated stores, so a machine that is behind the vault still writes it. That is the main case: the `vault_ahead` alert.
4. **A stale file from a machine that is gone.** The hub cannot tell a gone machine from a quiet one without a heartbeat, and a heartbeat makes a commit for each beat. The relayed alert names the file instead: delete it (ask the Assistant) when the machine is gone.
5. **Two machines with the same name.** They already share one hub identity in `hub.json`, so the name must be unique. This PR does not handle it.
