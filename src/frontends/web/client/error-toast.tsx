/**
 * One shared way to show a failed action (a send, a retry, a fork, a new chat, an approval answer):
 * a toast at the bottom of the screen. On a phone the network drops often, so no action may fail in silence.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { ApiError } from "./api.ts";
import type { EvaErrorCode } from "../../../shared/errors.ts";
import { errorFix, type ErrorFix } from "./error-fixes.ts";
import { Icon, type IconName } from "./icons.tsx";
import { destinationOf } from "./navigation.ts";

/** A toast hides itself after this time; the person can close it sooner. */
const toastVisibleMs = 8_000;

/** A failed login shows a key, as the guide does for an expired login. */
const loginCodes: ReadonlySet<EvaErrorCode> = new Set(["github_failed", "google_failed"]);

interface Toast {
  readonly message: string;
  readonly icon: IconName;
  readonly fix: ErrorFix | null;
}

type ShowError = (caught: unknown) => void;

const ShowErrorContext = createContext<ShowError>(() => undefined);

/** The function that shows a failed action to the person. */
export function useShowError(): ShowError {
  return useContext(ShowErrorContext);
}

export function ErrorToastProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [toast, setToast] = useState<Toast | null>(null);
  // On the Settings page, a button to it would do nothing.
  const [settingsIsOpen, setSettingsIsOpen] = useState(() => destinationOf(window.location.hash) === "settings");
  useEffect(() => {
    const onHashChange = (): void => setSettingsIsOpen(destinationOf(window.location.hash) === "settings");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const showError = useCallback((caught: unknown): void => {
    setToast(describeError(caught));
  }, []);

  useEffect(() => {
    if (toast === null) return undefined;
    const timer = setTimeout(() => setToast(null), toastVisibleMs);
    return () => clearTimeout(timer);
  }, [toast]);

  const fix = toast?.fix ?? null;
  return (
    <ShowErrorContext.Provider value={showError}>
      {children}
      {toast !== null && (
        <div className="toast" role="alert">
          <Icon name={toast.icon} />
          <span>{toast.message}</span>
          {fix !== null && !settingsIsOpen && (
            <button
              className="primary"
              onClick={() => {
                setToast(null);
                window.location.hash = fix.address;
              }}
            >
              {fix.label}
            </button>
          )}
          <button className="toast-close" aria-label="Close the message" onClick={() => setToast(null)}>
            <Icon name="x" />
          </button>
        </div>
      )}
    </ShowErrorContext.Provider>
  );
}

function describeError(caught: unknown): Toast {
  if (caught instanceof ApiError) {
    const code = caught.code;
    return {
      message: caught.message,
      icon: code !== null && loginCodes.has(code) ? "key" : "alert",
      fix: errorFix(code),
    };
  }
  // fetch rejects with a TypeError when the request never reaches Eva.
  if (caught instanceof TypeError) {
    return {
      message: "Eva cannot be reached. Check the connection and try again.",
      icon: "wifi-off",
      fix: null,
    };
  }
  return { message: caught instanceof Error ? caught.message : String(caught), icon: "alert", fix: null };
}
