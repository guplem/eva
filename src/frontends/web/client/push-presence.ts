/**
 * Tells Eva while this page is in view, so she sends this device no notification then (#360). The
 * claim ends by itself after 90 seconds on Eva's side, so the page renews it each minute.
 */

/** Shorter than Eva's 90 seconds, so one late renewal does not end the claim. */
const renewMs = 60_000;

export interface PresencePage {
  readonly isInView: () => boolean;
  /** This device's push address, or null when it gets no notifications. */
  readonly endpoint: () => Promise<string | null>;
  readonly send: (endpoint: string, inView: boolean) => Promise<void>;
  readonly onViewChange: (listener: () => void) => () => void;
  /** The browser closes the page, or opens another address in its tab. */
  readonly onLeave: (listener: () => void) => () => void;
  readonly setInterval: (callback: () => void, ms: number) => () => void;
}

/** Starts the claims. Returns a function that stops them. */
export function startPushPresence(page: PresencePage): () => void {
  const report = (inView: boolean): void => {
    page
      .endpoint()
      .then((endpoint) => (endpoint === null ? undefined : page.send(endpoint, inView)))
      // A missed claim only means one notification that the person did not need.
      .catch(() => undefined);
  };
  const reportView = (): void => {
    report(page.isInView());
  };
  reportView();
  const stopViewChange = page.onViewChange(reportView);
  const stopLeave = page.onLeave(() => {
    report(false);
  });
  const stopTimer = page.setInterval(() => {
    if (page.isInView()) report(true);
  }, renewMs);
  return () => {
    stopViewChange();
    stopLeave();
    stopTimer();
  };
}

/** The browser's side of the claims. */
export function browserPresencePage(): PresencePage {
  return {
    isInView: () => document.visibilityState === "visible",
    endpoint: async () => {
      if (!("serviceWorker" in navigator)) return null;
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      return subscription?.endpoint ?? null;
    },
    send: async (endpoint, inView) => {
      // keepalive: the "out of view" claim must still go out while the browser hides or closes the page.
      await fetch("/api/push/in-view", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint, inView }),
        keepalive: true,
      });
    },
    onViewChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    onLeave: (listener) => {
      window.addEventListener("pagehide", listener);
      return () => window.removeEventListener("pagehide", listener);
    },
    setInterval: (callback, ms) => {
      const timer = window.setInterval(callback, ms);
      return () => window.clearInterval(timer);
    },
  };
}
