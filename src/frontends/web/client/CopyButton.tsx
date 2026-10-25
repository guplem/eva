/** One Copy button for a chat answer and for a code block. */
import { useEffect, useState, type ReactElement } from "react";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";

/** How long a Copy button says "Copied". */
const copiedMs = 2_000;

/** `name` tells a screen reader what the button copies; "Copied" names itself. */
export function CopyButton({ text, name }: { readonly text: string; readonly name?: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const showError = useShowError();
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), copiedMs);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      className="ghost"
      {...(name === undefined || copied ? {} : { "aria-label": name })}
      onClick={() => {
        copyText(text)
          .then(() => setCopied(true))
          .catch((caught: unknown) => showError(caught));
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** The Clipboard API needs a secure page. A page over plain HTTP uses a hidden text box instead. */
async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && "clipboard" in navigator) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // A fixed box at the top does not scroll the page. iOS zooms into a box with text under 16 px.
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.fontSize = "16px";
  area.style.opacity = "0";
  // The text box takes the focus, so give it back: a keyboard user keeps their place.
  const focused = document.activeElement;
  document.body.append(area);
  area.select();
  // iOS Safari often ignores select() on a read-only box.
  area.setSelectionRange(0, text.length);
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only way to copy on a page that is not secure.
  const copied = document.execCommand("copy");
  area.remove();
  if (focused instanceof HTMLElement) focused.focus();
  if (!copied) throw new Error("This browser cannot copy here. Select the text and copy it.");
}
