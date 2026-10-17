/**
 * The setup report of each repository of a project: one light per item, and a Copy button
 * that copies the fix request for a coding agent that runs on that repository.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type SetupItem, type SetupReport } from "./api.ts";

const lightNames: Readonly<Record<SetupItem["light"], string>> = {
  green: "Done",
  yellow: "Partly done",
  red: "Missing",
  grey: "Not checked",
};

type Loading = { readonly state: "loading" } | { readonly state: "failed"; readonly reason: string };

export function RepositorySetup({ projectId, title }: { projectId: string; title: string }): ReactElement {
  const [reports, setReports] = useState<SetupReport[] | Loading>({ state: "loading" });

  const load = useCallback(async (): Promise<void> => {
    setReports({ state: "loading" });
    try {
      setReports(await api.repositorySetup(projectId));
    } catch (caught) {
      setReports({ state: "failed", reason: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loading = !Array.isArray(reports) && reports.state === "loading";
  return (
    <>
      <div className="main-header">
        <h1>{title} · Repository setup</h1>
        <button onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>
      <div className="settings">
        {Array.isArray(reports) ? (
          <>
            {reports.length === 0 && <div className="muted">This project lists no repository.</div>}
            {reports.map((report, index) => (
              <ReportView key={`${String(index)}-${report.repositoryUrl}`} report={report} />
            ))}
          </>
        ) : (
          <div className="muted" role="status">
            {reports.state === "loading"
              ? "Reading GitHub…"
              : `Eva could not read the setup: ${reports.reason} Press Refresh to try again.`}
          </div>
        )}
      </div>
    </>
  );
}

function ReportView({ report }: { report: SetupReport }): ReactElement {
  return (
    <fieldset>
      <legend>{report.slug ?? report.repositoryUrl}</legend>
      {report.problem !== null && <div className="muted">{report.problem}</div>}
      {report.allFixes !== null && (
        <CopyButton
          text={report.allFixes}
          label="Copy all fixes"
          name={`Copy all fixes for ${report.slug ?? ""}`}
          className="copy-all"
        />
      )}
      {report.sections.map((section) => (
        <section key={section.title} className="setup-section">
          <h2>
            {section.title}
            {section.score !== null && <span className="badge">{section.score}%</span>}
          </h2>
          {section.items.map((item) => (
            <div key={item.label} className="setup-item">
              <span className={`light ${item.light}`} role="img" aria-label={lightNames[item.light]} />
              <div className="setup-text">
                <div>{item.label}</div>
                <div className="muted">{item.detail}</div>
              </div>
              {item.fixRequest !== null && (
                <CopyButton text={item.fixRequest} label="Copy" name={`Copy the fix for ${item.label}`} />
              )}
            </div>
          ))}
        </section>
      ))}
    </fieldset>
  );
}

interface CopyButtonProps {
  readonly text: string;
  readonly label: string;
  readonly name: string;
  readonly className?: string;
}

function CopyButton({ text, label, name, className }: CopyButtonProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const [showText, setShowText] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // The clipboard needs HTTPS or localhost. Elsewhere the person selects the text by hand.
      setShowText(true);
    }
  };
  return (
    <>
      <button className={className} aria-label={copied ? "Copied" : name} onClick={() => void copy()}>
        {copied ? "Copied" : label}
      </button>
      {showText && (
        <textarea
          className="copy-text"
          readOnly
          aria-label={`Text to copy: ${name}`}
          value={text}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </>
  );
}
