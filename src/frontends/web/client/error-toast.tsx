/**
 * One shared way to show a failed action (a send, a retry, a fork, a new chat, an approval answer):
 * a toast at the bottom of the screen. On a phone the network drops often, so no action may fail in silence.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { ApiError } from "./api.ts";
import { Icon } from "./icons.tsx";

/** A toast hides itself after this time; the person can close it sooner. */
const toastVisibleMs = 8_000;

type ShowError = (caught: unknown) => void;

const ShowErrorContext = createContext<ShowError>(() => undefined);

/** The function that shows a failed action to the person. */
export function useShowError(): ShowError {
  return useContext(ShowErrorContext);
}

export function ErrorToastProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [message, setMessage] = useState<string | null>(null);
  const showError = useCallback((caught: unknown): void => {
    setMessage(describeError(caught));
  }, []);

  useEffect(() => {
    if (message === null) return undefined;
    const timer = setTimeout(() => setMessage(null), toastVisibleMs);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <ShowErrorContext.Provider value={showError}>
      {children}
      {message !== null && (
        <div className="toast" role="alert">
          <span>{message}</span>
          <button aria-label="Close the message" onClick={() => setMessage(null)}>
            <Icon name="x" />
          </button>
        </div>
      )}
    </ShowErrorContext.Provider>
  );
}

function describeError(caught: unknown): string {
  if (caught instanceof ApiError) return caught.message;
  // fetch rejects with a TypeError when the request never reaches Eva.
  if (caught instanceof TypeError) return "Eva cannot be reached. Check the connection and try again.";
  return caught instanceof Error ? caught.message : String(caught);
}
