/** The git sandbox copies one prepared template per test, so each test must still get its own repositories. */
import { afterEach, describe, expect, test } from "bun:test";
import { createGitSandbox, type GitSandbox, gitHookTimeoutMs } from "../support/git-sandbox.ts";

const made: GitSandbox[] = [];

function sandbox(): GitSandbox {
  const created = createGitSandbox();
  made.push(created);
  return created;
}

afterEach(() => {
  for (const created of made.splice(0)) created.dispose();
});

describe("git sandbox", () => {
  test(
    "a push to one sandbox never reaches another sandbox",
    () => {
      const first = sandbox();
      const vault = first.clone("vault");
      first.write(vault, "note.md", "only in the first sandbox\n");
      first.git(vault, "add", "-A");
      first.git(vault, "commit", "-q", "-m", "first only");
      first.git(vault, "push", "-q", "origin", "main");

      const second = sandbox();
      expect(second.root).not.toBe(first.root);
      expect(second.git(second.remote, "log", "-1", "--format=%s", "main")).toBe("seed");
      expect(second.git(second.clone("vault"), "ls-files")).toBe("AGENTS.md");
    },
    gitHookTimeoutMs,
  );

  test(
    "a clone pushes to the remote of its own sandbox",
    () => {
      const own = sandbox();
      const vault = own.clone("vault");
      expect(own.git(vault, "remote", "get-url", "origin")).toBe(own.remote);
      expect(own.git(vault, "config", "user.email")).toBe("eva-test@example.invalid");
      expect(own.git(vault, "config", "core.autocrlf")).toBe("false");
    },
    gitHookTimeoutMs,
  );
});
