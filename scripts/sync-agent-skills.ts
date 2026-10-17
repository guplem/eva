/**
 * Copies the skills from `.agents/skills/`, the open location that most coding tools read, to
 * `.claude/skills/`, the only location that Claude Code reads. Edit only `.agents/skills/`.
 *
 * `bun run agents:sync` writes the copy. `bun run agents:check` (part of `bun run check`) fails
 * when the copy differs, so the two never drift. Plain copies, not symlinks: git on Windows
 * checks a symlink out as a small text file.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const sourceRoot = ".agents/skills";
const copyRoot = ".claude/skills";
const readmeName = "README.md";
const readme = `# Generated copy

Claude Code reads skills only from this folder. The skills live in \`.agents/skills/\`: edit them there, then run \`bun run agents:sync\`.
`;

function filesUnder(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true, encoding: "utf-8" })
    .filter((entry) => statSync(join(folder, entry)).isFile())
    .map((entry) => entry.split("\\").join("/"))
    .sort();
}

/** Every file that the copy must hold, with its content. */
function expectedCopy(): Map<string, string> {
  const expected = new Map<string, string>([[readmeName, readme]]);
  for (const file of filesUnder(sourceRoot)) expected.set(file, readFileSync(join(sourceRoot, file), "utf-8"));
  return expected;
}

/** The files of the copy that are missing, changed, or left over. */
function differences(expected: ReadonlyMap<string, string>): string[] {
  const actual = filesUnder(copyRoot);
  const changed = [...expected].filter(([file, content]) => {
    const path = join(copyRoot, file);
    return !existsSync(path) || readFileSync(path, "utf-8") !== content;
  });
  const extra = actual.filter((file) => !expected.has(file));
  return [...changed.map(([file]) => file), ...extra].map((file) => relative(".", join(copyRoot, file)));
}

function write(expected: ReadonlyMap<string, string>): void {
  rmSync(copyRoot, { recursive: true, force: true });
  for (const [file, content] of expected) {
    const path = join(copyRoot, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
  }
}

const expected = expectedCopy();
if (process.argv.includes("--check")) {
  const drifted = differences(expected);
  if (drifted.length > 0) {
    console.error(`.claude/skills/ differs from .agents/skills/. Run: bun run agents:sync\n${drifted.join("\n")}`);
    process.exit(1);
  }
  console.log("The skills copy for Claude Code is up to date.");
} else {
  write(expected);
  console.log(`Copied ${String(expected.size - 1)} files from ${sourceRoot} to ${copyRoot}.`);
}
