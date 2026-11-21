/**
 * The text that waits in the message box of the New chat page, the home page (#761). Eva puts a
 * text there for the person to send: a mention of a project (issues 657 and 668), or the text of a
 * widget (#696). Eva never sends it, and she keeps the text that the person typed before.
 */
import { goTo } from "./back-layers.ts";
import { unsentTexts } from "./Composer.tsx";
import { assistantChatAddressOf, newChatPageId } from "./navigation.ts";
import { noteFill } from "./text-sources.ts";

/** The key of the unsent text of the New chat page, which has no chat yet. A chat id never takes it. */
export const newChatTextKey = "new-chat";

/**
 * Changes the unsent text of the New chat page and opens the page. `source` names who wrote the
 * new text, such as a widget, and the box shows it.
 */
export function fillNewChat(change: (typed: string) => string, source?: string): void {
  unsentTexts.set(newChatTextKey, change(unsentTexts.get(newChatTextKey)));
  noteFill(newChatTextKey, source);
  goTo(assistantChatAddressOf(newChatPageId));
}
