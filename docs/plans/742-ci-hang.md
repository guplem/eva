# Plan: the Ubuntu checks job hangs in local-api.test.ts (#742)

## Findings

- Eight Ubuntu runs hung from 2026-10-22 to 2026-10-31. Each ran Bun 1.4.2 with `--parallel` and `--coverage`.
- In each run, `test/unit/frontends/api/local-api.test.ts` is the only file with no output. It printed no result at all, not even for its first test. Every other file finished.
- `bun test --parallel` sorts the files by path and gives each worker a contiguous chunk. In each of these runs, `test/unit/engines/pi/pi-process.test.ts` came just before `local-api.test.ts` in the same chunk. So the worker ran `local-api.test.ts` right after `pi-process.test.ts`.
- `pi-process.test.ts` leaves child pipes in flight when it ends: a stdin write of 400 KB that nobody reads, and the stderr readers of three killed children.
- The first `beforeEach` of `local-api.test.ts` runs git with `Bun.spawnSync`. `spawnSync` blocks the event loop, so neither Bun's test timeout nor any other timer can stop it. Its own 20-second timeout did not stop it either.
- Bun 1.4.3 fixed this bug: "spawnSync or execFileSync could spin at 100% CPU and never return after a garbage collection during an earlier Bun.spawnSync freed a stream such as a previous test file's process.stderr. Users hit this in large bun test --isolate suites." The same release fixed "a promise or callback that a finished test file left in flight could run during the next file".

## Changes

1. Run the CI jobs and the release build on Bun 1.4.4, the version that developers already use.
2. Add a per-file watchdog to the test workers. A blocked worker then fails in minutes, with the name of its file, instead of at the job limit.
3. Add one line about the trap to `test/AGENTS.md`.

## Gaps

- **Which Bun version?** 1.4.3 has the fix. 1.4.4 is the local version, and the full suite passes on it. Decision: 1.4.4, also in `release.yml`, so that the tests run on the runtime that ships.
- **The watchdog limit.** The slowest file takes about 75 seconds on Linux. Decision: 10 minutes per file, well under the 35-minute job limit.
- **A reproduction.** The hang depends on when a garbage collection runs. It did not happen in 5 full local runs with Bun 1.4.2, nor in targeted runs. The watchdog gets a red-green test instead.
