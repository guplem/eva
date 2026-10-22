/**
 * Today's special day for the whole page: one clock for every welcome place, and the tab icon.
 * The visor draws the eyes; this file only knows which day it is. The person's facts, such as
 * their birthday and where they live, change the day, so this file also keeps them for the page.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { api, type PersonalFactsView } from "./api.ts";
import { festiveIconSvg } from "./festive-art.ts";
import { specialDayOn, type SpecialDay } from "./special-days.ts";

/** How often a page that stays open checks for a new day, and reads the person's facts again. */
const dayCheckMs = 60_000;

interface Festive {
  readonly day: SpecialDay | null;
  /** Null until the facts load: before the login, and with no vault, they never do. */
  readonly facts: PersonalFactsView | null;
  /** Reads the facts again now, such as when a page that needs them opens. */
  readonly refresh: () => void;
}

const FestiveContext = createContext<Festive>({ day: null, facts: null, refresh: () => undefined });

export function SpecialDayProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [facts, setFacts] = useState<PersonalFactsView | null>(null);
  const [day, setDay] = useState(() => specialDayOn(new Date()));
  // A failed read keeps the last good facts: a short network loss must not hide a birthday.
  const lastFacts = useRef<PersonalFactsView | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback((): void => {
    void api
      .aboutMe()
      .then(
        (read) => read,
        () => lastFacts.current,
      )
      .then((read) => {
        if (!mounted.current) return;
        lastFacts.current = read;
        setFacts((last) => (JSON.stringify(last) === JSON.stringify(read) ? last : read));
        const next = specialDayOn(new Date(), read ?? undefined);
        setDay((last) => (JSON.stringify(last) === JSON.stringify(next) ? last : next));
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const timer = setInterval(refresh, dayCheckMs);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  useFestiveTabIcon(day);
  const value = useMemo(() => ({ day, facts, refresh }), [day, facts, refresh]);
  return <FestiveContext.Provider value={value}>{children}</FestiveContext.Provider>;
}

/** Today's special day, or null on an ordinary day. */
export function useSpecialDay(): SpecialDay | null {
  return useContext(FestiveContext).day;
}

/**
 * What Eva knows about the person, or null until it loads. The facts load again when a page that
 * uses them opens, such as the new chat page right after the login.
 */
export function usePersonalFacts(): PersonalFactsView | null {
  const { facts, refresh } = useContext(FestiveContext);
  useEffect(refresh, [refresh]);
  return facts;
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
