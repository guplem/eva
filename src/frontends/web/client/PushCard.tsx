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
    standalone,
    secure: window.isSecureContext,
    hasPush: "serviceWorker" in navigator && "PushManager" in window,
    permission: "Notification" in window ? Notification.permission : null,
  });
}

/** This device's subscription, or null when it has none. */
async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

const supportWords: Readonly<Record<Exclude<PushSupport, "ready">, string>> = {
  "needs-install":
    "On an iPhone or iPad, add Eva to the home screen first: tap Share, then Add to Home Screen. Then open Eva from the home screen and come back here.",
  blocked:
    "This browser blocks Eva's notifications. Allow them in the browser's settings for this site, then come back.",
  unsupported: "This browser cannot show Eva's notifications. Use Telegram, or open Eva in another browser.",
};

export function PushCard({ context }: { readonly context: SettingsContext }): ReactElement {
  const [support] = useState(currentSupport);
  /** Null until the page knows whether this device gets the alerts. */
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const { notify } = context;

  const load = useCallback((): void => {
    if (support !== "ready") return;
    currentSubscription()
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
      load();
    }
  };

  const turnOn = (): Promise<void> =>
    run(async () => {
      if ((await Notification.requestPermission()) !== "granted") {
        throw new Error("The browser did not allow notifications.");
      }
      const { publicKey } = await api.pushKey();
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      });
      const words = describeDevice(navigator.userAgent);
      await api.addPushDevice(subscription.toJSON(), `${words.name}, ${words.browser}`);
    }, "This device now gets Eva's alerts.");

  const turnOff = (): Promise<void> =>
    run(async () => {
      const subscription = await currentSubscription();
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
