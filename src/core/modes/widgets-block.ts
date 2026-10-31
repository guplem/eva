/**
 * The block of the assistant prompt that says where each widget keeps its data (#692). Eva builds
 * it at the start of each chat with the projects block, and the chat keeps it (lesson 40).
 */

export const widgetsIntro =
  "Eva's home page shows these widgets. Each line says where a widget keeps its data, with the person's real folder. When the person tells you something that a widget keeps, such as a training, save it there. Before you write a data file, read the `DATA_FORMAT.md` of its folder, and write every required field.";

/** The block, or null when no widget is on. */
export function widgetsBlock(lines: readonly string[]): string | null {
  return lines.length === 0 ? null : `# The person's widgets\n\n${widgetsIntro}\n\n${lines.join("\n")}\n`;
}
