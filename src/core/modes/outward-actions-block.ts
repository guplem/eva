/**
 * The levels of the outward actions (#914). Eva puts the categories on Ask and on Deny in the
 * prompt of each new Assistant chat, so the model does not ask a second time in text, and does not
 * look for another way to do an action that the person turned off. A category on Allow needs no
 * line: the model may do it.
 */
import {
  outwardActionCategories,
  outwardActionWords,
  type OutwardActionCategory,
  type OutwardActionLevel,
  type OutwardActionLevels,
} from "../../shared/outward-actions.ts";

function lines(levels: OutwardActionLevels, level: OutwardActionLevel): string[] {
  return outwardActionCategories
    .filter((category: OutwardActionCategory) => levels[category] === level)
    .map((category) => `- ${outwardActionWords[category].title}: ${outwardActionWords[category].covers}`);
}

/**
 * The block of the prompt, built once for each chat so the prompt cache holds (lesson 40). It is
 * null when no category is on Ask or Deny. A change in the middle of a chat reaches the model
 * through the message of a denied call, not through this block.
 */
export function outwardActionsBlock(levels: OutwardActionLevels): string | null {
  const ask = lines(levels, "ask");
  const deny = lines(levels, "deny");
  if (ask.length === 0 && deny.length === 0) return null;
  const parts = ["# Actions that reach other people", ""];
  if (ask.length > 0)
    parts.push(
      "The person wants to say yes before each of these actions. Eva shows the person a button when you try one. Do not ask a second time in text.",
      "",
      ...ask,
      "",
    );
  if (deny.length > 0)
    parts.push(
      "The person turned these actions off. Do not do them, and do not try another way to do the same thing. Tell the person that you did not do it.",
      "",
      ...deny,
      "",
    );
  return parts.join("\n");
}
