/**
 * Tells Eva while this page is in view, and which chats it shows (#360, #614). Eva then sends this
 * device no notification of those chats, and no problem alert. The claim ends by itself after 90
 * seconds on Eva's side, so the page renews it each minute.
 *
 * The claim also says whether the person is active on the page (#1136). While they are, Eva sends
 * no device a notification of the chats that the page shows. A page of a device with no
 * notifications claims too, with no push address, so its reader silences the other devices.
 */

/** Shorter than Eva's 90 seconds, so one late renewal does not end the claim. */
const renewMs = 60_000;

/**
 * How long after the last input the person still counts as active. Someone who reads a long answer
 * moves nothing for a while. Someone who left the computer must get the answer on the phone.
 */
export const activeMs = 5 * 60_000;

/** The browser's side of the claims. A test passes its own. */
export interface PresencePage {
  /** In view and in front: a window behind another app is not where the person looks. */
  readonly isInView: () => boolean;
  /** This device's push address, or null when it gets no notifications. */
  readonly readEndpoint: () => Promise<string | null>;
  /** The sessions of the chat on screen. */
  readonly shownChats: () => readonly string[];
  readonly send: (
    endpoint: string | null,
    pageId: string,
    inView: boolean,
    chats: readonly string[],
    active: boolean,
  ) => Promise<void>;
  readonly onViewChange: (listener: () => void) => () => void;
  readonly onChatsChange: (listener: () => void) => () => void;
  /** The browser closes the page, or opens another address in its tab. */
  readonly onLeave: (listener: () => void) => () => void;
  /** The person turned the notifications of this device on or off. */
  readonly onDeviceChange: (listener: () => void) => () => void;
  /** The person pressed a key, or moved or touched the page. A scroll that the page makes does not count. */
  readonly onInput: (listener: () => void) => () => void;
  readonly setInterval: (callback: () => void, ms: number) => () => void;
  readonly now: () => number;
  /** The tabs of one browser share one push address, so each tab claims under its own id. */
  readonly pageId: string;
}

/** Starts the claims. Returns a function that stops them. */
export function startPushPresence(page: PresencePage): () => void {
  // Kept at hand: a page that hides may freeze before an await ends, so a claim goes out in the same tick.
  let endpoint: string | null = null;
  /** False until the first read of the push address ends: a claim under the wrong address would stay for 90 seconds. */
  let ready = false;
  // The person just opened the page.
  let lastInput = page.now();
  /**
   * The last claim that went out. A blur and a hide often come together, and two requests can
   * arrive in either order, so the page sends only a change. Only the timer renews a claim.
   */
  let lastSent: string | null = null;
  /** Whether the last claim said that the person is active. An input then has no news for Eva. */
  let sentActive = false;
  const claim = (inView: boolean): [boolean, readonly string[], boolean] => [
    inView,
    page.shownChats(),
    inView && page.now() - lastInput < activeMs,
  ];
  /** The claims stopped: a read of the push address that ends later must not start one more. */
  let stopped = false;
  /** Counts the reads of the push address, so an older read that ends last changes nothing. */
  let reads = 0;
  const report = (inView: boolean): void => {
    if (!ready) return;
    const [, chats, active] = claim(inView);
    lastSent = JSON.stringify([inView, chats, active]);
    sentActive = active;
    // A missed claim only means one notification that the person did not need.
    page.send(endpoint, page.pageId, inView, chats, active).catch(() => undefined);
  };
  const reportChange = (inView: boolean): void => {
    if (JSON.stringify(claim(inView)) !== lastSent) report(inView);
  };
  const reportView = (): void => {
    reportChange(page.isInView());
  };
  const use = (found: string | null): void => {
    // The claim under the old address would hold for 90 seconds more.
    if (ready && found !== endpoint) reportChange(false);
    endpoint = found;
    ready = true;
    lastSent = null;
    reportView();
  };
  const refresh = (): void => {
    reads += 1;
    const read = reads;
    page
      .readEndpoint()
      // A browser with no service worker still shows the chat to the person.
      .catch(() => null)
      .then((found) => {
        if (!stopped && read === reads) use(found);
      })
      .catch(() => undefined);
  };
  refresh();
  const stops = [
    page.onViewChange(reportView),
    page.onChatsChange(reportView),
    page.onLeave(() => {
      reportChange(false);
    }),
    page.onDeviceChange(refresh),
    page.onInput(() => {
      lastInput = page.now();
      // An input comes many times each second, so only the first one after a quiet time reaches Eva.
      if (!sentActive) reportView();
    }),
    page.setInterval(() => {
      if (page.isInView()) report(true);
    }, renewMs),
  ];
  return () => {
    for (const stop of stops) stop();
    stopped = true;
    // After a logout, an old claim would hold back the pushes for up to 90 seconds.
    reportChange(false);
  };
}
