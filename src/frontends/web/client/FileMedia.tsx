/**
 * An image, a sound or a film of the vault on the Files page (issue 737). The core does not show a
 * file that is not text, but a browser shows these formats by itself. So the page reads the bytes
 * through the download route, which keeps every check of the explorer, and shows them.
 */
import { useEffect, useState, type ReactElement } from "react";
import { api } from "./api.ts";
import { DownloadWait, saveBlob, useDownload } from "./DownloadButton.tsx";
import { FileBar } from "./FileBar.tsx";
import type { Media } from "./file-kinds.ts";
import { ProgressBar } from "./Loading.tsx";

/** The browser holds the whole file in memory, so a larger file keeps its Download button only. */
export const maxMediaBytes = 50 * 1024 * 1024;

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
}: {
  readonly path: string;
  readonly size: number;
  readonly media: Media;
  readonly large: boolean;
  readonly onLarge: (large: boolean) => void;
}): ReactElement {
  const [bytes, setBytes] = useState<Bytes>({ state: "loading", share: null });
  const [unplayable, setUnplayable] = useState(false);
  const download = useDownload(path);
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
  return (
    <section className="files-pane files-preview files-file" aria-label="File preview">
      <FileBar
        size={size}
        large={large}
        onLarge={onLarge}
        items={[
          {
            label: "Download",
            icon: "download",
            onChoose: () =>
              // The page holds the bytes already, so a phone does not read them twice.
              bytes.state === "shown" ? saveBlob(name, bytes.blob) : void download.start(),
          },
        ]}
      />
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
      {bytes.state === "shown" && !unplayable && (
        <div className="files-media">
          {media.kind === "image" ? (
            <img src={bytes.address} alt={name} onError={() => setUnplayable(true)} />
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
