import { describe, expect, test } from "bun:test";
import { plainLine } from "../../../src/shared/plain-line.ts";

describe("plainLine", () => {
  test("removes the Markdown marks and keeps the words on one line", () => {
    expect(plainLine("# Title\n- **bold** and *it* with [a link](https://example.com)", 500)).toBe(
      "Title bold and it with a link",
    );
  });

  test("keeps marks that are not emphasis", () => {
    expect(plainLine("2 * 3 * 4 in __init__.py", 500)).toBe("2 * 3 * 4 in __init__.py");
  });

  test("drops a code block", () => {
    expect(plainLine("Run this:\n```bash\nbun run check\n```", 500)).toBe("Run this:");
  });

  test("gives an empty line for a text of marks only", () => {
    expect(plainLine("---\n***", 500)).toBe("");
  });

  test("reads only the first characters", () => {
    expect(plainLine("abcdef", 3)).toBe("abc");
  });
});
