/**
 * The setup report of each repository of a project: one mark per item, and a Fix button that
 * opens a new chat with Eva, with the fix request of the item in the message box.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, type SetupItem, type SetupReport, type SetupSection } from "./api.ts";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import { BackButton } from "./MainNav.tsx";
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
  onFix,
}: {
  readonly projectId: string;
  readonly title: string;
  /** Goes back to the project page. */
  readonly onBack: () => void;
  /** Opens a new chat with Eva that holds the fix request, unsent (issue 668). */
  readonly onFix: (request: string) => void;
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
              <ReportCard key={`${String(index)}-${report.repositoryUrl}`} report={report} onFix={onFix} />
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

function ReportCard({ report, onFix }: { report: SetupReport; onFix: (request: string) => void }): ReactElement {
  const summary = reportSummary(report);
  return (
    <Card
      icon="branch"
      title={report.slug ?? report.repositoryUrl}
      description={summary === "" ? undefined : summary}
      aside={
        report.allFixes !== null && (
          <FixButton
            request={report.allFixes}
            label="Fix all"
            name={`Fix all of ${report.slug ?? ""} in a new chat`}
            onFix={onFix}
            className="primary"
          />
        )
      }
    >
      {report.problem !== null && <div className="callout warning">{report.problem}</div>}
      {report.sections.map((section) => (
        <SectionView key={section.title} section={section} onFix={onFix} />
      ))}
    </Card>
  );
}

function SectionView({ section, onFix }: { section: SetupSection; onFix: (request: string) => void }): ReactElement {
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
            <FixButton request={item.fixRequest} label="Fix" name={`Fix ${item.label} in a new chat`} onFix={onFix} />
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

interface FixButtonProps {
  readonly request: string;
  readonly label: string;
  readonly name: string;
  readonly onFix: (request: string) => void;
  readonly className?: string;
}

/** The arrow says that the button opens another page: a new chat with the fix in its box. */
function FixButton({ request, label, name, onFix, className }: FixButtonProps): ReactElement {
  return (
    <button className={`fix-button ${className ?? ""}`} aria-label={name} onClick={() => onFix(request)}>
      {label}
      <Icon name="forward" />
    </button>
  );
}
