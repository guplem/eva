/**
 * A test worker that blocks its thread stops no timer, so Bun's test timeout never ends it (#742).
 * The watchdog in `bunfig.toml` must end it instead, and name its file.
 */
import { expect, test } from "bun:test";
import { join } from "node:path";

const repository = join(import.meta.dir, "..", "..");
const fixtures = join("test", "fixtures", "file-watchdog");

test("a test file that blocks its worker fails by its name, and the other files still run", async () => {
  // The inner run sets its own worker ids. The ids of this outer worker do not belong to it.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(BUN_TEST|JEST|VITEST)_(WORKER|POOL)_ID$/.test(name)),
  );
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      "--parallel=2",
      "--parallel-delay=0",
      `./${join(fixtures, "blocks.test.ts")}`,
      `./${join(fixtures, "passes.test.ts")}`,
    ],
    {
      cwd: repository,
      // Long enough for the passing file on a busy runner. The blocked file waits a minute.
      env: { ...environment, EVA_TEST_FILE_LIMIT_MS: "10000" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 40_000,
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const output = stdout + stderr;
  expect(child.signalCode, output).toBeNull();
  expect(exitCode, output).toBe(1);
  expect(output).toMatch(/blocks\.test\.ts \(worker crashed/);
  expect(output).toMatch(/blocks\.test\.ts ran for more than 10000 ms/);
  expect(output).toContain(" 1 pass");
}, 60_000);
