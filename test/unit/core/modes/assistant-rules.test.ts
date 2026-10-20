import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantRules } from "../../../../src/core/modes/assistant-rules.ts";
import { defaultAssistantRules } from "../../../../src/core/vault/vault-template.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let vault: string;
let rulesFile: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-assistant-rules-"));
  rulesFile = join(vault, ".eva", "assistant.md");
  mkdirSync(join(vault, ".eva"), { recursive: true });
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

function rules(): AssistantRules {
  return new AssistantRules({
    vaultPath: vault,
    basePrompt: "# Built in\n",
    // 08:05 UTC is 10:05 in Madrid in October.
    now: () => new Date("2026-10-20T08:05:00.000Z"),
    timeZone: "Europe/Madrid",
  });
}

describe("AssistantRules", () => {
  test("reads the rules with the built-in prompt and the default, and an empty text without a file", () => {
    expect(rules().read().text).toBe("");
    writeFileSync(rulesFile, "# Mine\n");
    const view = rules().read();
    expect(view.text).toBe("# Mine\n");
    expect(view.builtIn).toBe("# Built in\n");
    expect(view.defaultText).toBe(defaultAssistantRules);
  });

  test("saves a new text, with the line endings of the file on disk", () => {
    writeFileSync(rulesFile, "# Mine\r\n");
    const saved = rules().save(rules().read().version, "# New\nSecond line\n");
    expect(readFileSync(rulesFile, "utf-8")).toBe("# New\r\nSecond line\r\n");
    expect(saved.text).toBe("# New\r\nSecond line\r\n");
  });

  test("refuses a save when the rules changed since the page read them", () => {
    writeFileSync(rulesFile, "# Mine\n");
    const { version } = rules().read();
    writeFileSync(rulesFile, "# Changed in a chat\n");
    let caught: unknown;
    try {
      rules().save(version, "# Page\n");
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "rules_changed")).toBe(true);
    expect(readFileSync(rulesFile, "utf-8")).toBe("# Changed in a chat\n");
  });

  test("restores the default after a backup named with the local time, and never overwrites a backup", () => {
    writeFileSync(rulesFile, "# Mine\n");
    const first = rules().restoreDefault(rules().read().version, true);
    expect(first.backup).toBe(".eva/assistant.backup-2026-10-20-1005.md");
    expect(readFileSync(join(vault, ".eva", "assistant.backup-2026-10-20-1005.md"), "utf-8")).toBe("# Mine\n");
    expect(readFileSync(rulesFile, "utf-8")).toBe(defaultAssistantRules);

    writeFileSync(rulesFile, "# Mine again\n");
    const second = rules().restoreDefault(rules().read().version, true);
    expect(second.backup).toBe(".eva/assistant.backup-2026-10-20-1005-2.md");
  });

  test("restores the default without a backup when the person asks for none", () => {
    writeFileSync(rulesFile, "# Mine\n");
    expect(rules().restoreDefault(rules().read().version, false).backup).toBeNull();
    expect(existsSync(join(vault, ".eva", "assistant.backup-2026-10-20-1005.md"))).toBe(false);
  });
});
