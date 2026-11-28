/**
 * An image, a sound, a film or a PDF of the vault on the Files page (issues 737 and 1064). The core
 * does not show a file that is not text, but a browser shows these formats by itself. So the page
 * reads the bytes through the download route, which keeps every check of the explorer, and shows them.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { api } from "./api.ts";
import { DownloadWait, saveBlob, useDownload } from "./DownloadButton.tsx";
import { FileBar } from "./FileBar.tsx";
import type { OpenFileItems } from "./file-actions.ts";
import type { Media } from "./file-kinds.ts";
import type { MenuItem } from "./Menu.tsx";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";

type Bytes =
  | { readonly state: "loading"; readonly share: number | null }
  | { readonly state: "shown"; readonly address: string; readonly blob: Blob }
  | { readonly state: "failed"; readonly reason: string };

export function MediaPreview({
  path,
  size,
  media,
  large,
  onLarge,
  menu,
}: {
  readonly path: string;
  readonly size: number;
  readonly media: Media;
  readonly large: boolean;
  readonly onLarge: (large: boolean) => void;
  /** Builds the whole menu of the file from its own Download item (#1117). */
  readonly menu: (open: OpenFileItems) => MenuItem[];
}): ReactElement {
  const [bytes, setBytes] = useState<Bytes>({ state: "loading", share: null });
  const [unplayable, setUnplayable] = useState(false);
  const download = useDownload(path);
  const picture = useRef<HTMLImageElement>(null);
  useEffect(() => {
    let current = true;
    let address: string | null = null;
    // A person who flicks through a folder of photos must not pull each one in full.
    const reading = new AbortController();
    api
      .downloadFile(path, (share) => current && setBytes({ state: "loading", share }), reading.signal)
      .then(({ blob }) => {
        if (!current) return;
        // The route sends every file as plain bytes, so the type comes from the name.
        const typed = new Blob([blob], { type: media.type });
        address = URL.createObjectURL(typed);
        setBytes({ state: "shown", address, blob: typed });
      })
      .catch((caught: unknown) => {
        if (current) setBytes({ state: "failed", reason: caught instanceof Error ? caught.message : String(caught) });
      });
    return () => {
      current = false;
      reading.abort();
      if (address !== null) URL.revokeObjectURL(address);
    };
  }, [path, media.type]);

  const name = path.split("/").pop() ?? path;
  // Chrome on Android has no PDF viewer inside a page, and says so here. An older browser has no answer.
  const [pdfInside] = useState<boolean>(() => navigator.pdfViewerEnabled);
  // A browser puts an image on the clipboard only on a secure page, and only as a PNG.
  const canCopy =
    media.kind === "image" &&
    bytes.state === "shown" &&
    !unplayable &&
    window.isSecureContext &&
    "ClipboardItem" in window;
  const copy = async (): Promise<void> => {
    const image = picture.current;
    if (image === null) return;
    // Safari keeps the copy only when the write starts in the tap itself, so the PNG comes as a promise.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngOf(image) })]);
  };
  return (
    <section className="files-pane files-preview files-file" aria-label="File preview">
      <FileBar
        size={size}
        large={large}
        onLarge={onLarge}
        items={menu({
          // The page holds the bytes already, so a phone does not read them twice.
          download: () => (bytes.state === "shown" ? saveBlob(name, bytes.blob) : void download.start()),
        })}
        copy={canCopy ? copy : null}
      >
        {/* Only a PDF: an SVG that opens as a page of Eva's address could run its scripts. */}
        {media.kind === "pdf" && (
          <button
            aria-disabled={bytes.state === "shown" ? undefined : true}
            onClick={() => {
              if (bytes.state === "shown") window.open(bytes.address, "_blank", "noopener");
            }}
          >
            <Icon name="external" />
            Open
          </button>
        )}
      </FileBar>
      <div className="files-wait">
        <DownloadWait download={download} folder={false} />
      </div>
      {bytes.state === "loading" && (
        <div className="files-media">
          <ProgressBar label={`Loading ${name}…`} share={bytes.share} />
        </div>
      )}
      {bytes.state === "failed" && (
        <div role="alert" className="callout danger files-problem">
          {bytes.reason}
        </div>
      )}
      {unplayable && (
        <div role="status" className="callout warning files-problem">
          This browser cannot show this file. Download it to open it in another app.
        </div>
      )}
      {bytes.state === "shown" && media.kind === "pdf" && !pdfInside && (
        <div role="status" className="callout files-problem">
          This browser cannot show a PDF inside the page. Tap Open to read it.
        </div>
      )}
      {bytes.state === "shown" && media.kind === "pdf" && pdfInside && (
        <div className="files-media files-pdf">
          <object data={bytes.address} type={media.type} aria-label={name}>
            <div role="status" className="callout files-problem">
              This browser cannot show this PDF inside the page. Tap Open to read it.
            </div>
          </object>
        </div>
      )}
      {bytes.state === "shown" && media.kind !== "pdf" && !unplayable && (
        <div className="files-media">
          {media.kind === "image" ? (
            <img ref={picture} src={bytes.address} alt={name} onError={() => setUnplayable(true)} />
          ) : media.kind === "audio" ? (
            <audio src={bytes.address} controls aria-label={name} onError={() => setUnplayable(true)} />
          ) : (
            <video src={bytes.address} controls playsInline aria-label={name} onError={() => setUnplayable(true)} />
          )}
        </div>
      )}
    </section>
  );
}

/** The image drawn again as a PNG, whatever its own format. */
function pngOf(image: HTMLImageElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d")?.drawImage(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error("Eva could not copy this image.")) : resolve(blob)),
      "image/png",
    );
  });
}
