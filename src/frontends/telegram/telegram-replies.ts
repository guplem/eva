/**
 * The replies that Eva suggests (#1127), as buttons under her answer (#1128). A press sends the
 * reply as the person's message. The offers live in memory on purpose: an old suggestion has no
 * value, so after a restart a press only says that the reply is gone.
 */
import { randomUUID } from "node:crypto";
import type { TelegramSender } from "./telegram-sender.ts";

export const repliesText = "Suggested replies:";
export const goneReplyText = "This reply is no longer available.";

interface ReplyOffer {
  readonly sessionId: string;
  readonly chatId: number;
  readonly topicId: number | null;
  /** The reply of each button, by its id. */
  readonly replies: ReadonlyMap<string, string>;
  /** Null until Telegram took the message. */
  messageId: number | null;
}

/** A press that may send its reply. */
export interface PressedReply {
  readonly text: string;
  /** The button message, or null when Telegram has not yet given its id. */
  readonly messageId: number | null;
}

export class TelegramReplies {
  private readonly sender: TelegramSender;
  /** The one live offer of each chat: only the newest answer offers replies, as in the web app. */
  private readonly offers = new Map<string, ReplyOffer>();
  private readonly byButton = new Map<string, ReplyOffer>();

  constructor(sender: TelegramSender) {
    this.sender = sender;
  }

  /**
   * Registers the offer of an answer at once, so a turn that starts before the send ends it. The
   * returned work sends the buttons, and runs in the chat's order. It replaces an older offer.
   */
  offer(sessionId: string, chatId: number, topicId: number | null, replies: readonly string[]): () => Promise<void> {
    const older = this.take(sessionId);
    const offer: ReplyOffer = {
      sessionId,
      chatId,
      topicId,
      replies: new Map(replies.map((reply) => [randomUUID().replaceAll("-", ""), reply])),
      messageId: null,
    };
    if (replies.length > 0) {
      this.offers.set(sessionId, offer);
      for (const id of offer.replies.keys()) this.byButton.set(id, offer);
    }
    return async () => {
      await this.removeMessage(older);
      if (this.offers.get(sessionId) !== offer) return;
      const keyboard = [...offer.replies].map(([id, text]) => [{ text, callback_data: `p:${id}` }]);
      offer.messageId = await this.sender.send(chatId, topicId, repliesText, { inline_keyboard: keyboard }, true);
    };
  }

  /**
   * Ends the offer of a chat whose next turn starts: a typed message, a message from another front
   * end, or a follow-up. The returned work deletes the buttons, in the chat's order.
   */
  withdraw(sessionId: string): () => Promise<void> {
    const offer = this.take(sessionId);
    return () => this.removeMessage(offer);
  }

  /**
   * Takes the reply of a press, or null when its offer is gone or lives in another place. The offer
   * ends at once, so a second fast press finds nothing.
   */
  press(
    buttonId: string,
    place: { readonly chatId: number; readonly topicId: number | null; readonly sessionId: string | undefined },
  ): PressedReply | null {
    const offer = this.byButton.get(buttonId);
    if (offer?.chatId !== place.chatId || offer.topicId !== place.topicId) return null;
    this.take(offer.sessionId);
    // A /new without topics gives the main chat another chat: the reply belongs to the earlier one.
    if (offer.sessionId !== place.sessionId) return null;
    return { text: offer.replies.get(buttonId) ?? "", messageId: offer.messageId };
  }

  /**
   * Shows the chosen reply in place of the buttons: Telegram does not show a message that a press
   * sends. A reply that Eva refused says so, and the next message in the topic says why.
   */
  async showChosen(chatId: number, messageId: number, text: string, sent: boolean): Promise<void> {
    await this.sender.quietCall("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: `${sent ? "You replied" : "Not sent"}: ${text}`,
    });
  }

  private take(sessionId: string): ReplyOffer | null {
    const offer = this.offers.get(sessionId);
    if (offer === undefined) return null;
    this.offers.delete(sessionId);
    for (const id of offer.replies.keys()) this.byButton.delete(id);
    return offer;
  }

  private async removeMessage(offer: ReplyOffer | null): Promise<void> {
    const messageId = offer?.messageId ?? null;
    if (offer === null || messageId === null) return;
    await this.sender.quietCall("deleteMessage", { chat_id: offer.chatId, message_id: messageId });
  }
}
