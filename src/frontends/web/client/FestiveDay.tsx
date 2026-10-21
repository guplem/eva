/**
 * Today's special day for the whole page: one clock for every welcome place, and the tab icon.
 * The visor draws the eyes; this file only knows which day it is.
 */
import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { festiveIconSvg } from "./festive-art.ts";
import { specialDayOn, type SpecialDay } from "./special-days.ts";

/** How often a page that stays open checks for a new day. */
const dayCheckMs = 60_000;

const SpecialDayContext = createContext<SpecialDay | null>(null);

/** Finds today's special day, changes it at midnight on a page that stays open, and draws it in the tab icon. */
export function SpecialDayProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [day, setDay] = useState(() => specialDayOn(new Date()));
  useEffect(() => {
    const timer = setInterval(() => {
      const next = specialDayOn(new Date());
      setDay((last) => (JSON.stringify(last) === JSON.stringify(next) ? last : next));
    }, dayCheckMs);
    return () => clearInterval(timer);
  }, []);
  useFestiveTabIcon(day);
  return <SpecialDayContext.Provider value={day}>{children}</SpecialDayContext.Provider>;
}

/** Today's special day, or null on an ordinary day. */
export function useSpecialDay(): SpecialDay | null {
  return useContext(SpecialDayContext);
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
