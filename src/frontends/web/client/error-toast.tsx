/**
 * One shared way to show a failed action (a send, a retry, a fork, a new chat, an approval answer):
 * a toast at the bottom of the screen. On a phone the network drops often, so no action may fail in silence.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { ApiError } from "./api.ts";
import { playCue } from "./cues.ts";
import { errorFix, type ErrorFix } from "./error-fixes.ts";
import { destinationOf } from "./navigation.ts";
import { Toast } from "./Toast.tsx";
import { goTo } from "./back-layers.ts";

interface ErrorMessage {
  readonly message: string;
  readonly fix: ErrorFix | null;
}

type ShowError = (caught: unknown) => void;

const ShowErrorContext = createContext<ShowError>(() => undefined);

/** The function that shows a failed action to the person. */
export function useShowError(): ShowError {
  return useContext(ShowErrorContext);
}

export function ErrorToastProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [toast, setToast] = useState<ErrorMessage | null>(null);
  // A new error restarts the ring, even with the same words as the last one.
  const [shown, setShown] = useState(0);
  // On the Settings page, a button to it would do nothing.
  const [settingsIsOpen, setSettingsIsOpen] = useState(() => destinationOf(window.location.hash) === "settings");
  useEffect(() => {
    const onHashChange = (): void => setSettingsIsOpen(destinationOf(window.location.hash) === "settings");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const showError = useCallback((caught: unknown): void => {
    playCue("problem");
    setToast(describeError(caught));
    setShown((count) => count + 1);
  }, []);

  const fix = toast?.fix ?? null;
  return (
    <ShowErrorContext.Provider value={showError}>
      {children}
      {toast !== null && (
        <Toast
          key={shown}
          message={toast.message}
          role="alert"
          onClose={() => setToast(null)}
          actions={
            fix !== null && !settingsIsOpen ? (
              <button
                className="primary"
                onClick={() => {
                  setToast(null);
                  goTo(fix.address);
                }}
              >
                {fix.label}
              </button>
            ) : undefined
          }
        />
      )}
    </ShowErrorContext.Provider>
  );
}

function describeError(caught: unknown): ErrorMessage {
  if (caught instanceof ApiError) {
    return {
      message: caught.message,
      fix: errorFix(caught.code),
    };
  }
  // fetch rejects with a TypeError when the request never reaches Eva.
  if (caught instanceof TypeError) {
    return {
      message: "Eva cannot be reached. Check the connection and try again.",
      fix: null,
    };
  }
  return { message: caught instanceof Error ? caught.message : String(caught), fix: null };
}
