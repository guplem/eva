/** The download of a vault file, or of a folder as one zip, for the file explorer and the chat. */
import { useState, type ReactElement } from "react";
import { api } from "./api.ts";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";

interface Download {
  readonly start: () => Promise<void>;
  readonly busy: boolean;
  /** The share of the bytes that arrived, or null when the size is not known yet. */
  readonly share: number | null;
  readonly problem: string | null;
}

/** Gets the bytes to save. An encrypted file comes from its own route, with this tab's unlock (#707). */
export type FetchFile = (onShare: (share: number) => void) => Promise<{ name: string; blob: Blob }>;

/**
 * Saves a file, or a folder as one zip, on the person's device. A browser saves one file per
 * link, so a folder needs the zip. The zip has no compression, so Eva builds it fast. A menu
 * closes as the download starts, so the state lives here and the caller shows `DownloadWait`.
 */
export function useDownload(
  path: string,
  fetchFile: FetchFile = (onShare) => api.downloadFile(path, onShare),
): Download {
  const [share, setShare] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const start = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setShare(null);
    setProblem(null);
    try {
      const { name, blob } = await fetchFile(setShare);
      saveBlob(name, blob);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  return { start, busy, share, problem };
}

/** Saves bytes that the page holds already on the person's device. */
export function saveBlob(name: string, blob: Blob): void {
  const address = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = address;
  link.download = name;
  link.click();
  // Safari starts the save after the click returns, so the address must live a while.
  setTimeout(() => URL.revokeObjectURL(address), 60_000);
}

export function DownloadWait({
  download,
  folder,
}: {
  readonly download: Download;
  readonly folder: boolean;
}): ReactElement {
  return (
    <>
      {download.busy && <ProgressBar label={folder ? "Packing the folder…" : "Downloading…"} share={download.share} />}
      {download.problem !== null && (
        <div role="alert" className="callout danger">
          {download.problem}
        </div>
      )}
    </>
  );
}

/** With a `label`, the button shows a file name, as in the chat, and keeps it on a phone. */
export function DownloadButton({
  path,
  folder,
  label,
  fetchFile,
}: {
  readonly path: string;
  readonly folder: boolean;
  readonly label?: string;
  readonly fetchFile?: FetchFile;
}): ReactElement {
  const download = useDownload(path, fetchFile);
  const named = label !== undefined;
  return (
    <div className={named ? "files-download named-download" : "files-download"}>
      <button
        className="ghost"
        onClick={() => void download.start()}
        disabled={download.busy}
        aria-label={named ? `Download ${label}` : folder ? "Download this folder as a zip file" : "Download this file"}
      >
        <Icon name="download" />
        {named ? (
          <span className="download-name">{label}</span>
        ) : (
          <span className="files-download-label">{folder ? "Download as zip" : "Download"}</span>
        )}
      </button>
      <DownloadWait download={download} folder={folder} />
    </div>
  );
}
