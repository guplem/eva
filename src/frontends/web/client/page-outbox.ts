/** The one outbox of the page (#945). A message keeps going when the person opens another chat, or reloads the page (#946). */
import { useSyncExternalStore } from "react";
import { api } from "./api.ts";
import { Outbox, type OutboxEntry } from "./outbox.ts";

export const outbox = new Outbox({
  send: async (sessionId, text, id) => ({ repeat: (await api.send(sessionId, text, id)).repeat === true }),
  // The tab's storage, as the unsent text of the box: a reload of the page keeps the messages (#946).
  storage: () => window.sessionStorage,
  timers: {
    set: (run, ms) => window.setTimeout(run, ms),
    clear: (timer) => window.clearTimeout(timer as number),
  },
});

const subscribe = (listener: () => void): (() => void) => outbox.subscribe(listener);

/** The outbox messages of one chat, oldest first. */
export function useOutbox(sessionId: string): readonly OutboxEntry[] {
  return useSyncExternalStore(subscribe, () => outbox.list(sessionId));
}
