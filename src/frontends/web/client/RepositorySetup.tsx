/**
 * The setup report of each repository of a project: one mark per item, and a Copy button
 * that copies the fix request for a coding agent that runs on that repository.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type SetupItem, type SetupReport, type SetupSection } from "./api.ts";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import { BackButton } from "./ProjectPage.tsx";
import { Card, StatusIcon } from "./SettingsParts.tsx";
import { lightMark, reportSummary, scoreMark } from "./setup-report.ts";

const lightNames: Readonly<Record<SetupItem["light"], string>> = {
  green: "Done",
  yellow: "Partly done",
  red: "Missing",
  grey: "Not checked",
};

type Loading = { readonly state: "loading" } | { readonly state: "failed"; readonly reason: string };

export function RepositorySetup({
  projectId,
  title,
  onBack,
}: {
  readonly projectId: string;
  readonly title: string;
  /** Goes back to the project page. */
  readonly onBack: () => void;
}): ReactElement {
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
        <BackButton label="Back" onClick={onBack} />
        <h1>{title} · Repository setup</h1>
        <button className="outline" onClick={() => void load()} disabled={loading}>
          <Icon name="restart" />
          Refresh
        </button>
      </div>
      <div className="settings-page">
        {Array.isArray(reports) ? (
          <>
            {reports.length === 0 && <div className="callout">This project lists no repository.</div>}
            {reports.map((report, index) => (
              <ReportCard key={`${String(index)}-${report.repositoryUrl}`} report={report} />
            ))}
          </>
        ) : reports.state === "loading" ? (
          <section className="card">
            <ProgressBar label="Reading GitHub…" />
          </section>
        ) : (
          <div className="callout danger" role="status">
            Eva could not read the setup: {reports.reason} Press Refresh to try again.
          </div>
        )}
      </div>
    </>
  );
}

function ReportCard({ report }: { report: SetupReport }): ReactElement {
  const summary = reportSummary(report);
  return (
    <Card
      icon="branch"
      title={report.slug ?? report.repositoryUrl}
      description={summary === "" ? undefined : summary}
      aside={
        report.allFixes !== null && (
          <CopyButton
            text={report.allFixes}
            label="Copy all fixes"
            name={`Copy all fixes for ${report.slug ?? ""}`}
            className="primary"
          />
        )
      }
    >
      {report.problem !== null && <div className="callout warning">{report.problem}</div>}
      {report.sections.map((section) => (
        <SectionView key={section.title} section={section} />
      ))}
    </Card>
  );
}

function SectionView({ section }: { section: SetupSection }): ReactElement {
  return (
    <section className="setup-section" aria-label={section.title}>
      <h3>
        {section.title}
        {section.score !== null && <span className={`pill ${scoreMark(section.score)}`}>{section.score}%</span>}
      </h3>
      {section.items.map((item) => (
        <div key={item.label} className="access-step setup-item">
          <ItemMark light={item.light} />
          <div className="access-step-text">
            <b>{item.label}</b>
            <small>{item.detail}</small>
          </div>
          {item.fixRequest !== null && (
            <CopyButton text={item.fixRequest} label="Copy" name={`Copy the fix for ${item.label}`} />
          )}
        </div>
      ))}
    </section>
  );
}

function ItemMark({ light }: { light: SetupItem["light"] }): ReactElement {
  const mark = lightMark(light);
  if (mark !== null) return <StatusIcon state={mark} label={lightNames[light]} />;
  return (
    <span className="access-mark" role="img" aria-label={lightNames[light]}>
      <Icon name="info" />
    </span>
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
      <button
        className={`copy-button ${className ?? ""}`}
        aria-label={copied ? "Copied" : name}
        onClick={() => void copy()}
      >
        <Icon name={copied ? "check" : "copy"} />
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
