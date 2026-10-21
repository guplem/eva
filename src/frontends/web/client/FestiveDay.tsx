/**
 * Today's special day for the whole page: one clock for every welcome place, and the tab icon.
 * The visor draws the eyes; this file only knows which day it is. The person's facts, such as
 * their birthday and where they live, change the day.
 */
import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { api } from "./api.ts";
import { festiveIconSvg } from "./festive-art.ts";
import { specialDayOn, type SpecialDay } from "./special-days.ts";

/** How often a page that stays open checks for a new day, and reads the person's facts again. */
const dayCheckMs = 60_000;

const FestiveContext = createContext<SpecialDay | null>(null);

export function SpecialDayProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [day, setDay] = useState(() => specialDayOn(new Date()));
  useEffect(() => {
    let current = true;
    const check = (): void => {
      // Before the login, and with no vault, the facts do not load: the days still show.
      void api
        .aboutMe()
        .then(
          (read) => read,
          () => null,
        )
        .then((read) => {
          if (!current) return;
          const next = specialDayOn(new Date(), read ?? undefined);
          setDay((last) => (JSON.stringify(last) === JSON.stringify(next) ? last : next));
        });
    };
    check();
    const timer = setInterval(check, dayCheckMs);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, []);
  useFestiveTabIcon(day);
  return <FestiveContext.Provider value={day}>{children}</FestiveContext.Provider>;
}

/** Today's special day, or null on an ordinary day. */
export function useSpecialDay(): SpecialDay | null {
  return useContext(FestiveContext);
}

/** Draws the day's festive eyes in the browser tab icon, and puts the usual icon back after. */
function useFestiveTabIcon(day: SpecialDay | null): void {
  const id = day?.id ?? null;
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link === null || id === null) return undefined;
    const usual = link.href;
    link.href = `data:image/svg+xml,${encodeURIComponent(festiveIconSvg(id))}`;
    return () => {
      link.href = usual;
    };
  }, [id]);
}
