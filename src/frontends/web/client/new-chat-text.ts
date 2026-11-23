/**
 * The text that waits in the message box of a chat that does not exist yet. The home page (#761) and the New chat
 * page of Chats (#1037) share it, so a text never gets lost between them. Eva puts a text there for the person to
 * send: a mention of a project (issues 657 and 668), or the text of a widget (#696). Eva never sends it, and she
 * keeps the text that the person typed before.
 */
import { goTo } from "./back-layers.ts";
import { unsentTexts } from "./Composer.tsx";
import { assistantChatAddressOf, newChatPageId } from "./navigation.ts";
import { noteFill } from "./text-sources.ts";

/** The key of the unsent text of a new chat, which has no chat yet. A chat id never takes it. */
export const newChatTextKey = "new-chat";

/**
 * Changes the unsent text of a new chat and opens the page at `address`: the New chat page by default. A widget
 * gives the home page, where it shows. `source` names who wrote the new text, such as a widget, and the box shows it.
 */
export function fillNewChat(
  change: (typed: string) => string,
  source?: string,
  address = assistantChatAddressOf(newChatPageId),
): void {
  unsentTexts.set(newChatTextKey, change(unsentTexts.get(newChatTextKey)));
  noteFill(newChatTextKey, source);
  goTo(address);
}
