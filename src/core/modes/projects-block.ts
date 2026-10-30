/**
 * The block of the assistant prompt that lists the projects that the person develops and uses (#690).
 * Eva builds it at the start of each chat, and the chat keeps it, so the prompt cache holds (lesson 40).
 */
import type { ProjectStatus } from "../../shared/project-statuses.ts";
import type { Project } from "../projects/project-catalog.ts";

interface BlockPart {
  readonly heading: string;
  readonly intro: string;
  readonly lines: readonly string[];
}

const blockIntro =
  "Eva lists these projects of the person at the start of this chat, from the `status` in the front matter of each project's `AGENTS.md`. A change shows in the next chat. Each line gives the title, the project id and the description. A project outside `Projects/` also gives its folder.";

/** The block, or null when no project is active or in use. Each empty part is left out. */
export function projectsBlock(projects: readonly Project[]): string | null {
  const parts: BlockPart[] = [
    {
      heading: "Projects that the person develops",
      intro: "Their status is `active`.",
      lines: lines(projects, "active"),
    },
    {
      heading: "Projects that the person uses",
      intro: "Their status is `in-use`. When a request fits one of them, use it, such as a recipes project for a menu.",
      lines: lines(projects, "in-use"),
    },
  ].filter((part) => part.lines.length > 0);
  if (parts.length === 0) return null;
  const sections = parts.map((part) => `## ${part.heading}\n\n${part.intro}\n\n${part.lines.join("\n")}\n`);
  return `# The person's projects\n\n${blockIntro}\n\n${sections.join("\n")}`;
}

/** One line for each project with this status, the newest first, as the Projects page lists them. */
function lines(projects: readonly Project[], status: ProjectStatus): string[] {
  return projects
    .filter((project) => project.frontMatter.status === status)
    .sort((first, second) => second.id.localeCompare(first.id))
    .map((project) => {
      // The agent finds a project of an extra root only by its folder: it is not in `Projects/`.
      const folder = project.vaultFolder === null ? `, in \`${project.path}\`` : "";
      const name = `- ${project.title} (\`${project.id}\`${folder})`;
      return project.description === null ? name : `${name}: ${project.description}`;
    });
}
