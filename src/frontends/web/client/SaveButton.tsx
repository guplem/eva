/**
 * A button that confirms its own save: a check and "Saved" grow in the button for a moment.
 * A notice at the top of a page is out of sight on a phone, so the button that the person
 * pressed shows the result.
 */
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { Icon } from "./icons.tsx";

/** Long enough to see after the finger lifts, short enough to be ready for the next save. */
const doneMs = 2000;

interface SaveButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children"> {
  /** Does the save. True means that it worked, so the button shows its check. */
  readonly onSave: () => Promise<boolean>;
  readonly children: ReactNode;
  /** The word next to the check. */
  readonly doneLabel?: string;
}

export function SaveButton({
  onSave,
  children,
  doneLabel = "Saved",
  className,
  ...button
}: SaveButtonProps): ReactElement {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const press = async (): Promise<void> => {
    if (timer.current !== null) clearTimeout(timer.current);
    setDone(false);
    if (!(await onSave())) return;
    setDone(true);
    timer.current = setTimeout(() => setDone(false), doneMs);
  };

  const classes = ["save-button", className, done ? "done" : undefined].filter(Boolean).join(" ");
  return (
    <button {...button} className={classes} onClick={() => void press()}>
      <span className="save-button-label">{children}</span>
      {/* Hidden from a screen reader: the name of the button stays, and the page's notice talks. */}
      <span className="save-button-done" aria-hidden="true">
        <Icon name="check" />
        {doneLabel}
      </span>
    </button>
  );
}
