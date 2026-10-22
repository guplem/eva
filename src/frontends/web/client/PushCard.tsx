/**
 * Eva's notifications on this device (#369, #360): her answers, the schedules, the approvals that
 * wait and her alerts, also with the app closed. Each device turns them on for itself, and picks
 * its own kinds.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { NotificationKind } from "../../../core/alerts/chat-notices.ts";
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

/** This device as Eva keeps it: its push address and the kinds that it gets. */
interface OwnDevice {
  readonly endpoint: string;
  readonly kinds: readonly NotificationKind[];
}

/**
 * This device's subscription, sent to Eva again, or null when it has none. Eva may have lost it:
 * a failed save, or an ended subscription. A subscription to another key never reaches this Eva,
 * so it ends.
 */
async function syncedDevice(): Promise<OwnDevice | null> {
  const subscription = await (await workerRegistration()).pushManager.getSubscription();
  if (subscription === null) return null;
  const { publicKey } = await api.pushKey();
  if (!sameKey(subscription.options.applicationServerKey, keyBytes(publicKey))) {
    await subscription.unsubscribe();
    return null;
  }
  const { devices } = await api.addPushDevice(subscription.toJSON(), deviceLabel());
  const own = devices.find((device) => device.endpoint === subscription.endpoint);
  return own === undefined ? null : { endpoint: own.endpoint, kinds: own.kinds };
}

const supportWords: Readonly<Record<Exclude<PushSupport, "ready">, string>> = {
  "needs-install":
    "On an iPhone or iPad, add Eva to the home screen first: tap Share, then Add to Home Screen. Then open Eva from the home screen and come back here.",
  blocked:
    "This browser blocks Eva's notifications. Allow them in the browser's settings for this site, then come back.",
  unsupported: "This browser cannot show Eva's notifications. Use Telegram, or open Eva in another browser.",
};

/** The kinds in the order that the card lists them. Only the hub sends the alerts. */
const kindWords: readonly { readonly kind: NotificationKind; readonly label: string; readonly hubOnly: boolean }[] = [
  { kind: "replies", label: "Eva answers, also at the end of a long task", hubOnly: false },
  { kind: "schedules", label: "A schedule finishes", hubOnly: false },
  { kind: "approvals", label: "Eva waits for your approval", hubOnly: false },
  { kind: "alerts", label: "Problems and their fixes", hubOnly: true },
];

export function PushCard({ context }: { readonly context: SettingsContext }): ReactElement {
  // The person can say no in the browser's prompt, so the card reads the support again after each step.
  const [support, setSupport] = useState(currentSupport);
  /** False on a computer that is not the hub: only the hub sends the alerts. */
  const [isHub, setIsHub] = useState(true);
  /** Undefined until the page knows whether this device gets notifications, and null when it gets none. */
  const [device, setDevice] = useState<OwnDevice | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const { notify } = context;

  const load = useCallback((): void => {
    if (support !== "ready") return;
    api
      .pushKey()
      .then((key) => setIsHub(key.isHub))
      .catch(() => undefined);
    syncedDevice()
      .then(setDevice)
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
    }, "This device now gets Eva's notifications.");

  const turnOff = (): Promise<void> =>
    run(async () => {
      const subscription = await (await workerRegistration()).pushManager.getSubscription();
      if (subscription === null) return;
      await api.removePushDevice(subscription.endpoint);
      await subscription.unsubscribe();
    }, "This device no longer gets Eva's notifications.");

  const test = (): Promise<void> => run(() => api.testPush(), "Eva sent a test notification.");

  const pick = (own: OwnDevice, kind: NotificationKind, on: boolean): Promise<void> => {
    const kinds = on ? [...own.kinds, kind] : own.kinds.filter((each) => each !== kind);
    // The box changes at once. A failed save shows its error, and the reload shows Eva's list again.
    setDevice({ ...own, kinds });
    return run(async () => {
      await api.setPushKinds(own.endpoint, kinds);
    }, "Eva saved the notifications of this device.");
  };

  return (
    <Card
      item="notifications"
      title="Notifications on this device"
      description="Eva tells this device when she answers, when a schedule finishes, when she waits for your approval and when something breaks. This works also when the app is closed. While this page is in view, she sends none."
    >
      {support !== "ready" ? (
        <div className="field-hint">{supportWords[support]}</div>
      ) : device === undefined ? (
        <ProgressBar label="Eva checks this device…" />
      ) : (
        <>
          {!isHub && (
            <div className="field-hint">
              This computer tells you about its own chats. Only the hub computer sends the problems. To get them too,
              turn on notifications on the hub's page.
            </div>
          )}
          {device !== null && (
            <div role="group" aria-labelledby="push-kinds-label">
              <div id="push-kinds-label" className="field-hint">
                Tell this device when:
              </div>
              {kindWords
                .filter((each) => isHub || !each.hubOnly)
                .map((each) => (
                  <label key={each.kind} className="check-row">
                    <input
                      type="checkbox"
                      checked={device.kinds.includes(each.kind)}
                      disabled={busy}
                      onChange={(event) => void pick(device, each.kind, event.target.checked)}
                    />
                    <span>{each.label}</span>
                  </label>
                ))}
            </div>
          )}
          <div className="button-row">
            {device !== null ? (
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
        </>
      )}
      {busy && <ProgressBar label="Eva sets up the notifications…" />}
    </Card>
  );
}
