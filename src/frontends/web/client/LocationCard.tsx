/**
 * The person's location for scripts such as a weather forecast (#371): what Eva knows, how to share
 * a live location in Telegram, and this device's choice to send its location while Eva is open.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type CurrentPlaceView } from "./api.ts";
import { ProgressBar } from "./Loading.tsx";
import { placeWords, readShareChoice, shareEveryMs, shareLocationKey } from "./location-words.ts";
import { Card, errorText, Steps, type SettingsContext } from "./SettingsParts.tsx";

/** The event that tells the page that this device's choice changed. */
const choiceChanged = "eva-share-location-changed";

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

/**
 * While the person is logged in and this device said yes, sends its location to Eva at most every
 * 15 minutes. A web page gets the location only while it is open, so a phone that is put away
 * sends nothing: Telegram's live location covers that.
 */
export function useLocationSharing(loggedIn: boolean): void {
  const [on, setOn] = useState(() => readShareChoice(browserStorage()));
  useEffect(() => {
    const update = (): void => setOn(readShareChoice(browserStorage()));
    window.addEventListener(choiceChanged, update);
    return () => window.removeEventListener(choiceChanged, update);
  }, []);
  useEffect(() => {
    if (!loggedIn || !on || !("geolocation" in navigator)) return undefined;
    let lastSent = 0;
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        if (Date.now() - lastSent < shareEveryMs) return;
        lastSent = Date.now();
        const { latitude, longitude, accuracy } = position.coords;
        api.sendLocation(latitude, longitude, accuracy).catch(() => {
          // A failed send tries again with the next point.
          lastSent = 0;
        });
      },
      () => undefined,
      { maximumAge: shareEveryMs },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [loggedIn, on]);
}

export function LocationCard({ context }: { readonly context: SettingsContext }): ReactElement {
  /** Undefined until it loads; null when Eva knows no place. */
  const [place, setPlace] = useState<CurrentPlaceView | null | undefined>(undefined);
  const [sharing, setSharing] = useState(() => readShareChoice(browserStorage()));
  const { notify } = context;

  const load = useCallback((): void => {
    api
      .currentPlace()
      .then((answer) => setPlace(answer.place))
      .catch((error: unknown) => notify(errorText(error)));
  }, [notify]);
  useEffect(load, [load]);

  const toggle = (): void => {
    const next = !sharing;
    if (next && !("geolocation" in navigator)) {
      notify("This browser cannot give its location.");
      return;
    }
    saveChoice(next);
    setSharing(next);
    // The browser asks the person once; the first point comes a moment later.
    if (next) setTimeout(load, 5_000);
  };

  return (
    <Card
      item="location"
      title="Your location"
      description="Scripts such as a weather forecast use your last location. Eva keeps it on this computer, never in the vault."
    >
      {place === undefined ? (
        <ProgressBar label="Eva reads your location…" />
      ) : (
        <div>{placeWords(place, new Date())}</div>
      )}
      <Steps>
        <li>In Telegram, open your chat with Eva&apos;s bot.</li>
        <li>Tap the clip, then Location, then Share My Live Location.</li>
        <li>Choose &quot;Until I turn it off&quot;. Eva keeps a new point every 15 minutes at most.</li>
      </Steps>
      <div className="button-row">
        <button className={sharing ? "ghost" : ""} onClick={toggle}>
          {sharing ? "Stop sending from this device" : "Send this device's location while Eva is open"}
        </button>
      </div>
    </Card>
  );
}
