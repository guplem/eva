/**
 * Eva's alerts as notifications on this device (#369). A person without Telegram learns about a
 * problem with the app closed. Each device turns them on for itself.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api } from "./api.ts";
import { describeDevice } from "./device-words.ts";
import { ProgressBar } from "./Loading.tsx";
import { keyBytes, pushSupport, type PushSupport } from "./push-support.ts";
import { Card, errorText, type SettingsContext } from "./SettingsParts.tsx";

function currentSupport(): PushSupport {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return pushSupport({
    userAgent: navigator.userAgent,
    touchScreen: navigator.maxTouchPoints > 1,
    standalone,
    secure: window.isSecureContext,
    hasPush: "serviceWorker" in navigator && "PushManager" in window,
    permission: "Notification" in window ? Notification.permission : null,
  });
}

/** A worker that failed to start never gets ready, so the card stops waiting after this long. */
const workerWaitMs = 10_000;

async function workerRegistration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("The browser did not start Eva's notification helper. Reload the page.")),
      workerWaitMs,
    );
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, late]);
  } finally {
    clearTimeout(timer);
  }
}

function deviceLabel(): string {
  const words = describeDevice(navigator.userAgent);
  return `${words.name}, ${words.browser}`;
}

/** True when two keys hold the same bytes. */
function sameKey(first: ArrayBuffer | null, second: Uint8Array): boolean {
  return first !== null && new Uint8Array(first).join() === second.join();
}

/**
 * This device's subscription, sent to Eva again, or null when it has none. Eva may have lost it:
 * a failed save, or an ended subscription. A subscription to another key never reaches this Eva,
 * so it ends.
 */
async function syncedSubscription(): Promise<PushSubscription | null> {
  const subscription = await (await workerRegistration()).pushManager.getSubscription();
  if (subscription === null) return null;
  const { publicKey } = await api.pushKey();
  if (!sameKey(subscription.options.applicationServerKey, keyBytes(publicKey))) {
    await subscription.unsubscribe();
    return null;
  }
  await api.addPushDevice(subscription.toJSON(), deviceLabel());
  return subscription;
}

const supportWords: Readonly<Record<Exclude<PushSupport, "ready">, string>> = {
  "needs-install":
    "On an iPhone or iPad, add Eva to the home screen first: tap Share, then Add to Home Screen. Then open Eva from the home screen and come back here.",
  blocked:
    "This browser blocks Eva's notifications. Allow them in the browser's settings for this site, then come back.",
  unsupported: "This browser cannot show Eva's notifications. Use Telegram, or open Eva in another browser.",
};

export function PushCard({ context }: { readonly context: SettingsContext }): ReactElement {
  // The person can say no in the browser's prompt, so the card reads the support again after each step.
  const [support, setSupport] = useState(currentSupport);
  /** False on a computer that is not the hub: only the hub sends the alerts. */
  const [isHub, setIsHub] = useState(true);
  /** Null until the page knows whether this device gets the alerts. */
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const { notify } = context;

  const load = useCallback((): void => {
    if (support !== "ready") return;
    api
      .pushKey()
      .then((key) => setIsHub(key.isHub))
      .catch(() => undefined);
    syncedSubscription()
      .then((subscription) => setSubscribed(subscription !== null))
      .catch((error: unknown) => notify(errorText(error)));
  }, [support, notify]);
  useEffect(load, [load]);

  const run = async (step: () => Promise<void>, done: string): Promise<void> => {
    setBusy(true);
    try {
      await step();
      notify(done);
    } catch (error) {
      notify(errorText(error));
    } finally {
      setBusy(false);
      setSupport(currentSupport());
      load();
    }
  };

  const turnOn = (): Promise<void> =>
    run(async () => {
      if ((await Notification.requestPermission()) !== "granted") {
        throw new Error("The browser did not allow notifications.");
      }
      const { publicKey } = await api.pushKey();
      const registration = await workerRegistration();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      });
      try {
        await api.addPushDevice(subscription.toJSON(), deviceLabel());
      } catch (error) {
        // Eva has no record of it, so a kept subscription would look on and never get a push.
        await subscription.unsubscribe();
        throw error;
      }
    }, "This device now gets Eva's alerts.");

  const turnOff = (): Promise<void> =>
    run(async () => {
      const subscription = await (await workerRegistration()).pushManager.getSubscription();
      if (subscription === null) return;
      await api.removePushDevice(subscription.endpoint);
      await subscription.unsubscribe();
    }, "This device no longer gets Eva's alerts.");

  const test = (): Promise<void> => run(() => api.testPush(), "Eva sent a test notification.");

  return (
    <Card
      item="notifications"
      title="Notifications on this device"
      description="Eva sends each alert to this device, also when the app is closed. Telegram, when you use it, gets them too."
    >
      {support !== "ready" ? (
        <div className="field-hint">{supportWords[support]}</div>
      ) : !isHub ? (
        <div className="field-hint">
          Only the hub computer sends the alerts. Open its page to turn on notifications.
        </div>
      ) : subscribed === null ? (
        <ProgressBar label="Eva checks this device…" />
      ) : (
        <div className="button-row">
          {subscribed ? (
            <>
              <button disabled={busy} onClick={() => void test()}>
                Send a test
              </button>
              <button className="ghost" disabled={busy} onClick={() => void turnOff()}>
                Turn off
              </button>
            </>
          ) : (
            <button className="primary" disabled={busy} onClick={() => void turnOn()}>
              Turn on notifications
            </button>
          )}
        </div>
      )}
      {busy && <ProgressBar label="Eva sets up the notifications…" />}
    </Card>
  );
}
