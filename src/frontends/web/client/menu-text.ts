/** The items of the message box menu, and where a saved prompt goes in the typed text (issue 661). */
import type { ComposerMenuItems } from "./api.ts";
import type { MenuItem } from "./Menu.tsx";

export interface Selection {
  readonly start: number;
  readonly end: number;
}

/** The text with `inserted` in place of the selection, and the cursor just after it. */
export function insertedText(
  text: string,
  selection: Selection,
  inserted: string,
): { readonly text: string; readonly cursor: number } {
  const end = Math.min(selection.end, text.length);
  const start = Math.min(selection.start, end);
  return { text: text.slice(0, start) + inserted + text.slice(end), cursor: start + inserted.length };
}

export interface ComposerMenuChoices {
  /** False for an empty box: a text action has nothing to rewrite. */
  readonly canRewrite: boolean;
  readonly onAction: (name: string) => void;
  readonly onPrompt: (text: string) => void;
}

export function composerMenuItems(items: ComposerMenuItems, choices: ComposerMenuChoices): MenuItem[] {
  return [
    ...items.textActions.map((action) => ({
      group: "Text actions",
      label: action.name,
      icon: "pen" as const,
      disabled: !choices.canRewrite,
      onChoose: () => choices.onAction(action.name),
    })),
    ...items.savedPrompts.map((prompt) => ({
      group: "Saved prompts",
      label: prompt.name,
      icon: "chat" as const,
      onChoose: () => choices.onPrompt(prompt.text),
    })),
  ];
}
