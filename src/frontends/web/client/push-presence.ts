/**
 * Tells Eva while this page is in view, so she sends this device no notification then (#360). The
 * claim ends by itself after 90 seconds on Eva's side, so the page renews it each minute.
 */

/** Shorter than Eva's 90 seconds, so one late renewal does not end the claim. */
const renewMs = 60_000;

/** The browser's side of the claims. A test passes its own. */
export interface PresencePage {
  /** In view and in front: a window behind another app is not where the person looks. */
  readonly isInView: () => boolean;
  /** This device's push address, or null when it gets no notifications. */
  readonly readEndpoint: () => Promise<string | null>;
  readonly send: (endpoint: string, pageId: string, inView: boolean) => Promise<void>;
  readonly onViewChange: (listener: () => void) => () => void;
  /** The browser closes the page, or opens another address in its tab. */
  readonly onLeave: (listener: () => void) => () => void;
  /** The person turned the notifications of this device on or off. */
  readonly onDeviceChange: (listener: () => void) => () => void;
  readonly setInterval: (callback: () => void, ms: number) => () => void;
  /** The tabs of one browser share one push address, so each tab claims under its own id. */
  readonly pageId: string;
}

/** Starts the claims. Returns a function that stops them. */
export function startPushPresence(page: PresencePage): () => void {
  // Kept at hand: a page that hides may freeze before an await ends, so a claim goes out in the same tick.
  let endpoint: string | null = null;
  const report = (inView: boolean): void => {
    if (endpoint === null) return;
    // A missed claim only means one notification that the person did not need.
    page.send(endpoint, page.pageId, inView).catch(() => undefined);
  };
  const reportView = (): void => {
    report(page.isInView());
  };
  const refresh = (): void => {
    page
      .readEndpoint()
      .then((found) => {
        endpoint = found;
        reportView();
      })
      .catch(() => undefined);
  };
  refresh();
  const stops = [
    page.onViewChange(reportView),
    page.onLeave(() => {
      report(false);
    }),
    page.onDeviceChange(refresh),
    page.setInterval(() => {
      if (page.isInView()) report(true);
    }, renewMs),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
