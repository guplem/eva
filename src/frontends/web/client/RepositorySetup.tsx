/**
 * The setup report of each repository of a project: its type, one mark per item, and a Fix button
 * that opens a new chat with Eva, with the fix request of the item in the message box. A repository
 * with no known type shows only the type choice (#681).
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { repositoryTypes } from "../../../core/projects/repository-types.ts";
import { api, type SetupItem, type SetupReport, type SetupSection } from "./api.ts";
import { Icon } from "./icons.tsx";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";
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
              <ReportCard
                key={`${String(index)}-${report.repositoryUrl}`}
                projectId={projectId}
                report={report}
                onFix={onFix}
                onTypeChanged={() => void load()}
              />
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

interface ReportCardProps {
  readonly projectId: string;
  readonly report: SetupReport;
  readonly onFix: (request: string) => void;
  /** Reads the reports again, for the new type. */
  readonly onTypeChanged: () => void;
}

function ReportCard({ projectId, report, onFix, onTypeChanged }: ReportCardProps): ReactElement {
  const summary = reportSummary(report);
  // The item whose direct fix runs, "all" for Fix all, or null.
  const [running, setRunning] = useState<string | null>(null);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const canFixDirectly = report.sections.some((section) => section.items.some(hasDirectFix));

  /** Runs the direct fixes, then opens one chat for the rest, or reads the report again. */
  const fix = async (key: string, items: readonly string[] | null): Promise<void> => {
    setRunning(key);
    setProblems([]);
    try {
      const result = await api.fixRepository(projectId, report.repositoryUrl, items);
      if (result.chatRequest !== null) onFix(result.chatRequest);
      else {
        setProblems(result.problems);
        onTypeChanged();
      }
    } catch (caught) {
      setProblems([caught instanceof Error ? caught.message : String(caught)]);
    } finally {
      setRunning(null);
    }
  };

  const fixAll =
    canFixDirectly || report.allFixes === null ? (
      canFixDirectly && (
        <button
          className="fix-button primary"
          aria-label={`Fix all of ${report.slug ?? ""}`}
          aria-busy={running === "all"}
          disabled={running !== null}
          onClick={() => void fix("all", null)}
        >
          {running === "all" && <ButtonSpinner />}
          {running === "all" ? "Fixing…" : "Fix all"}
        </button>
      )
    ) : (
      <FixButton
        request={report.allFixes}
        label="Fix all"
        name={`Fix all of ${report.slug ?? ""} in a new chat`}
        onFix={onFix}
        className="primary"
      />
    );
  return (
    <Card
      icon="branch"
      title={report.slug ?? report.repositoryUrl}
      description={summary === "" ? undefined : summary}
      aside={fixAll}
    >
      {report.slug !== null && <TypeChoice projectId={projectId} report={report} onChanged={onTypeChanged} />}
      {report.problem !== null && <div className="callout warning">{report.problem}</div>}
      {running !== null && <ProgressBar label="Eva fixes the repository on GitHub…" />}
      {problems.length > 0 && (
        <div className="callout danger" role="status">
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </div>
      )}
      {report.sections.map((section) => (
        <SectionView
          key={section.title}
          section={section}
          onFix={onFix}
          running={running}
          onDirectFix={(label) => void fix(label, [label])}
        />
      ))}
    </Card>
  );
}

/** True for a red or yellow item that Eva fixes herself, with no chat. */
function hasDirectFix(item: SetupItem): boolean {
  return item.directFix !== undefined && item.light !== "grey" && item.light !== "green";
}

/** The type of the repository. The person picks one for a repository that has none. */
function TypeChoice({
  projectId,
  report,
  onChanged,
}: {
  readonly projectId: string;
  readonly report: SetupReport;
  readonly onChanged: () => void;
}): ReactElement {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = repositoryTypes.find((type) => type.name === report.type);
  const choose = async (type: string): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await api.setRepositoryType(projectId, report.repositoryUrl, type);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      {report.type === null && (
        <div className="callout">Pick the type of this repository. Eva then shows the report for that type.</div>
      )}
      <label className="field">
        <span className="field-label">Repository type</span>
        <select
          value={report.type ?? ""}
          disabled={saving}
          aria-busy={saving}
          onChange={(event) => void choose(event.target.value)}
        >
          {report.type === null && (
            <option value="" disabled>
              Pick a type
            </option>
          )}
          {repositoryTypes.map((type) => (
            <option key={type.name} value={type.name}>
              {type.label}
            </option>
          ))}
        </select>
        {current !== undefined && <span className="field-hint">{current.description}</span>}
      </label>
      {saving && <ProgressBar label="Eva saves the type…" />}
      {error !== null && (
        <div className="callout danger" role="status">
          {error}
        </div>
      )}
    </>
  );
}

interface SectionViewProps {
  readonly section: SetupSection;
  readonly onFix: (request: string) => void;
  /** The item whose direct fix runs, "all", or null. */
  readonly running: string | null;
  readonly onDirectFix: (label: string) => void;
}

function SectionView({ section, onFix, running, onDirectFix }: SectionViewProps): ReactElement {
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
          {hasDirectFix(item) ? (
            // Eva runs this fix herself, so the button opens no other page and has no arrow.
            <button
              className="fix-button"
              aria-label={`Fix ${item.label} now`}
              aria-busy={running === item.label}
              disabled={running !== null}
              onClick={() => onDirectFix(item.label)}
            >
              {running === item.label && <ButtonSpinner />}
              Fix
            </button>
          ) : (
            item.fixRequest !== null && (
              <FixButton request={item.fixRequest} label="Fix" name={`Fix ${item.label} in a new chat`} onFix={onFix} />
            )
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
