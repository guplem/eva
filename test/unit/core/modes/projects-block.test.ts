import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectsBlock } from "../../../../src/core/modes/projects-block.ts";
import { discoverProjects, type Project } from "../../../../src/core/projects/project-catalog.ts";

let root: string;

function addProject(folder: string, id: string, status: string | null, body: string): void {
  mkdirSync(join(folder, id), { recursive: true });
  const statusLine = status === null ? "" : `status: ${status}\n`;
  writeFileSync(join(folder, id, "AGENTS.md"), `---\ncreated: 2025-01-01T09:00\n${statusLine}---\n${body}`);
}

function projects(): Project[] {
  return discoverProjects({ vaultPath: join(root, "vault"), extraRoots: [join(root, "extra")] });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-projects-block-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("projectsBlock", () => {
  test("lists the projects that the person develops and uses, the newest first, with the title, the id and the description", () => {
    const vaultProjects = join(root, "vault", "Projects");
    addProject(vaultProjects, "2025-01-01-0900-website", "active", "# Website\n\nThe person's own website.\n");
    addProject(vaultProjects, "2025-02-01-0900-recipes", "in-use", "# Recipes\n\nThe recipes and the menus.\n");
    // A project with no description shows its title and id only. One outside the vault also shows its folder.
    addProject(join(root, "extra"), "2025-03-01-0900-tool", "active", "# Tool\n");

    expect(projectsBlock(projects())).toBe(
      [
        "# The person's projects",
        "",
        "Eva picks these projects by the `status` in each project's `AGENTS.md`. Each line gives the title, the project id and the description. A project outside `Projects/` also gives its folder.",
        "",
        "## Projects that the person develops",
        "",
        "Their status is `active`.",
        "",
        `- Tool (\`2025-03-01-0900-tool\`, in \`${join(root, "extra", "2025-03-01-0900-tool")}\`)`,
        "- Website (`2025-01-01-0900-website`): The person's own website.",
        "",
        "## Projects that the person uses",
        "",
        "Their status is `in-use`. When a request fits one of them, use it, such as a recipes project for a menu.",
        "",
        "- Recipes (`2025-02-01-0900-recipes`): The recipes and the menus.",
        "",
      ].join("\n"),
    );
  });

  test("leaves out each empty part, and every project with another status or none (#690)", () => {
    const vaultProjects = join(root, "vault", "Projects");
    addProject(vaultProjects, "2025-01-01-0900-recipes", "in-use", "# Recipes\n");
    for (const status of ["idea", "paused", "closed", "dreaming", null]) {
      addProject(vaultProjects, `2025-01-01-0900-${status ?? "none"}`, status, `# Project ${String(status)}\n`);
    }

    const block = projectsBlock(projects()) ?? "";
    expect(block).not.toContain("## Projects that the person develops");
    expect(block).toContain("- Recipes (`2025-01-01-0900-recipes`)\n");
    expect(block).not.toContain("Project ");
  });

  test("is null when no project is active or in use", () => {
    addProject(join(root, "vault", "Projects"), "2025-01-01-0900-paused", "paused", "# Paused\n");
    expect(projectsBlock(projects())).toBeNull();
    expect(projectsBlock([])).toBeNull();
  });
});
