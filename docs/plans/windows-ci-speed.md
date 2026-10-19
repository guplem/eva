# Plan: make the Windows CI job fast again (#203)

## Motivation

The `checks (windows-latest)` job takes about 11 minutes, and every pull request waits for it. The Ubuntu job takes under 2 minutes. #104 and #110 made it faster before, but the suite grew. It now starts about 6,800 git processes, and each one is slow on a Windows runner. Windows stays first-class (`AGENTS.md`), so the job must keep its coverage.

## Measurements

- Four files take 84% of the 668 s on Windows: `telegram-bot` (241 s), `local-api` (114 s), `eva` (103 s), `vault-sync` (102 s).
- The Assistant turn sync (a pull before each turn, a save and push after it) starts most of the git processes. Without it, `telegram-bot` starts 657 git processes instead of 2,508, and all of its tests pass.
- `bun test --parallel=4` runs the suite in 38 s instead of 127 s on a 4-core Linux machine. It passes with `--randomize` and three seeds. Coverage works with it.
- With `idleTimeout: 1`, Bun closes an idle request after about 4 s.

## Steps

1. **Run the tests in parallel.** The `test` and `test:coverage` scripts pass `--parallel`. Windows and Linux both run the whole suite. Nothing is skipped.
2. **`sync.enabled: false` stops the turn sync.** `VaultUpkeep.pull` and `VaultUpkeep.save` skip the vault when the setting is off. Today only the idle sweep and the timed pull read it, but the guide says that `false` stops the sync.
3. **The tests that do not check the sync turn it off.** This cuts the git processes of the slow files.
4. **The 14 s test gets a seam.** `startLocalApi` takes an idle timeout. The test sets 1 s and waits 6 s, so it still proves that a check outlives Bun's idle timeout.

The owner agreed to skip the front-end tests on Windows only if the job is still slow after these steps. The owner prefers what is safe, keeps errors from piling up, and is easy to maintain.

## Gaps

1. With `sync.enabled: false`, does "Sync now" still sync? Do the conflict list and a conflict pick still work?
2. Which tests turn the sync off, and how: a shared test config, or each slow file?
3. `--parallel` with no number (one worker for each core), or a fixed number?
4. The shape of the idle timeout seam in `LocalApiOptions`.
5. Can a test file depend on running alone (a fixed port, `process.env`, the working folder, a shared temporary path)?

## Decisions

(Filled in after the gap research.)
