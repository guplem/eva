/**
 * The person's location for scripts such as a weather forecast (#371): what Eva knows, how to share
 * a live location in Telegram, and this device's choice to send its location while Eva is open.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type CurrentPlaceView } from "./api.ts";
import { ProgressBar } from "./Loading.tsx";
import { placeWords, readShareChoice, shareEveryMs, shareLocationKey } from "./location-words.ts";
import { Card, errorText, Steps, type SettingsContext } from "./SettingsParts.tsx";

/** The events between the page's sender and the card, in this tab. */
const choiceChanged = "eva-share-location-changed";
const locationSent = "eva-location-sent";
const locationBlocked = "eva-location-blocked";

/** A point may come from the phone's cache when it is this young, so the GPS wakes up less often. */
const cachedPointMs = 2 * 60_000;

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function saveChoice(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(shareLocationKey, "on");
    else window.localStorage.removeItem(shareLocationKey);
  } catch {
    // A browser that blocks storage forgets the choice at the next load. The page still works.
  }
  window.dispatchEvent(new Event(choiceChanged));
}

/** This device's choice, which follows a change in this tab or in another tab. */
function useShareChoice(): boolean {
  const [on, setOn] = useState(() => readShareChoice(browserStorage()));
  useEffect(() => {
    const update = (): void => setOn(readShareChoice(browserStorage()));
    window.addEventListener(choiceChanged, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(choiceChanged, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return on;
}

/**
 * While the person is logged in and this device said yes, asks the browser for its location every
 * 15 minutes and sends it to Eva. A web page gets the location only while it is open, so a phone
 * that is put away sends nothing: Telegram's live location covers that. A refusal turns the choice off.
 */
export function useLocationSharing(loggedIn: boolean): void {
  const on = useShareChoice();
  useEffect(() => {
    if (!loggedIn || !on || !("geolocation" in navigator)) return undefined;
    const ask = (): void => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          api
            .sendLocation(latitude, longitude, accuracy, position.timestamp)
            .then(() => window.dispatchEvent(new Event(locationSent)))
            .catch(() => undefined);
        },
        (error) => {
          if (error.code !== error.PERMISSION_DENIED) return;
          saveChoice(false);
          window.dispatchEvent(new Event(locationBlocked));
        },
        { maximumAge: cachedPointMs },
      );
    };
    ask();
    const timer = setInterval(ask, shareEveryMs);
    return () => clearInterval(timer);
  }, [loggedIn, on]);
}

export function LocationCard({ context }: { readonly context: SettingsContext }): ReactElement {
  /** Undefined until it loads; a null place when Eva knows none. */
  const [state, setState] = useState<{ place: CurrentPlaceView | null; isHub: boolean } | undefined>(undefined);
  const sharing = useShareChoice();
  /** True from a yes until the first point arrives. */
  const [waiting, setWaiting] = useState(false);
  const { notify } = context;

  const load = useCallback((): void => {
    api
      .currentPlace()
      .then(setState)
      .catch((error: unknown) => notify(errorText(error)));
  }, [notify]);
  useEffect(load, [load]);

  useEffect(() => {
    const sent = (): void => {
      setWaiting(false);
      load();
    };
    const blocked = (): void => {
      setWaiting(false);
      notify("This browser blocks its location. Allow it in the browser's settings for this site, then try again.");
    };
    window.addEventListener(locationSent, sent);
    window.addEventListener(locationBlocked, blocked);
    return () => {
      window.removeEventListener(locationSent, sent);
      window.removeEventListener(locationBlocked, blocked);
    };
  }, [load, notify]);

  const toggle = (): void => {
    if (!sharing && !("geolocation" in navigator)) {
      notify("This browser cannot give its location.");
      return;
    }
    setWaiting(!sharing);
    saveChoice(!sharing);
  };

  return (
    <Card
      item="location"
      title="Your location"
      description="Scripts such as a weather forecast use your last location. Eva keeps it on this computer, never in the vault."
    >
      {state === undefined ? (
        <ProgressBar label="Eva reads your location…" />
      ) : (
        <div>{placeWords(state.place, new Date())}</div>
      )}
      <Steps>
        <li>In Telegram, open your chat with Eva&apos;s bot.</li>
        <li>Tap the clip or the plus button, then Location, then Share My Live Location.</li>
        <li>Choose the time with no end, such as &quot;Until I Turn It Off&quot;.</li>
        <li>Let Telegram use your location always, also in the background, so the sharing goes on.</li>
      </Steps>
      {state?.isHub === false ? (
        <div className="field-hint">Only the hub computer keeps your location. Open its page to send it.</div>
      ) : (
        <div className="button-row">
          <button className={sharing ? "ghost" : undefined} onClick={toggle}>
            {sharing ? "Stop sending from this device" : "Send this device's location while Eva is open"}
          </button>
        </div>
      )}
      {waiting && sharing && <ProgressBar label="Waiting for the first location…" />}
    </Card>
  );
}
