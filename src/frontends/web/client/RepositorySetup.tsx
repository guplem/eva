/**
 * The setup report of each repository of a project: one light per item, and a Copy button
 * that copies the fix request for a coding agent that runs on that repository.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type SetupItem, type SetupReport } from "./api.ts";
import { useShowError } from "./error-toast.tsx";

const lightNames: Readonly<Record<SetupItem["light"], string>> = {
  green: "Done",
  yellow: "Partly done",
  red: "Missing",
  grey: "Not checked",
};

export function RepositorySetup({ projectId, title }: { projectId: string; title: string }): ReactElement {
  const [reports, setReports] = useState<SetupReport[] | null>(null);
  const showError = useShowError();

  const load = useCallback(async (): Promise<void> => {
    setReports(null);
    try {
      setReports(await api.repositorySetup(projectId));
    } catch (caught) {
      setReports([]);
      showError(caught);
    }
  }, [projectId, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="main-header">
        <h1>{title} · Repository setup</h1>
        <button onClick={() => void load()} disabled={reports === null}>
          Refresh
        </button>
      </div>
      <div className="settings">
        {reports === null && <div className="muted">Reading GitHub…</div>}
        {reports?.length === 0 && <div className="muted">This project lists no repository.</div>}
        {reports?.map((report) => (
          <ReportView key={report.repositoryUrl} report={report} />
        ))}
      </div>
    </>
  );
}

function ReportView({ report }: { report: SetupReport }): ReactElement {
  const fixes = report.sections.flatMap((section) => section.items.flatMap((item) => item.fixRequest ?? []));
  return (
    <fieldset>
      <legend>{report.slug ?? report.repositoryUrl}</legend>
      {report.problem !== null && <div className="muted">{report.problem}</div>}
      {fixes.length > 0 && (
        <CopyButton text={fixes.join("\n\n")} label="Copy all fixes" name={`Copy all fixes for ${report.slug ?? ""}`} />
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

function CopyButton({ text, label, name }: { text: string; label: string; name: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // The clipboard needs HTTPS or localhost; elsewhere the person copies the text by hand.
      window.prompt("Copy this text:", text);
    }
  };
  return (
    <button aria-label={name} onClick={() => void copy()}>
      {copied ? "Copied" : label}
    </button>
  );
}
