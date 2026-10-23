/**
 * The development page: a link that reports a problem on GitHub, and the way into the design
 * reference. Anyone who uses Eva can report; the reference helps to plan a change of the page.
 */
import type { ReactElement } from "react";
import { Icon } from "./icons.tsx";
import { accessFrom, deviceKind, problemReportUrl, type ReportKind } from "./report-problem.ts";
import { designReferenceItem } from "./settings-routes.ts";
import { Card, type SettingsContext } from "./SettingsParts.tsx";

export function DeveloperSection({ context }: { readonly context: SettingsContext }): ReactElement {
  const reportUrl = (kind: ReportKind): string =>
    problemReportUrl(kind, {
      version: context.status?.version ?? null,
      install: context.status?.update?.kind ?? null,
      role: context.status?.role ?? null,
      browser: navigator.userAgent,
      device: deviceKind(navigator.userAgent, navigator.maxTouchPoints),
      screen: `${String(screen.width)}x${String(screen.height)} at ${String(devicePixelRatio)}x`,
      window: `${String(innerWidth)}x${String(innerHeight)}`,
      access: accessFrom(location.hostname),
    });
  return (
    <>
      <Card
        item="report-problem"
        icon="alert"
        title="Report a problem"
        description="Open a new issue on GitHub. It holds this Eva's version, so you only write what happened. The issue is public: write no token, path or private name."
      >
        <div className="button-row">
          <a className="button-link" href={reportUrl("bug")} target="_blank" rel="noreferrer">
            <Icon name="alert" />
            Report a bug
          </a>
          <a className="button-link plain" href={reportUrl("change")} target="_blank" rel="noreferrer">
            <Icon name="bolt" />
            Suggest a change
          </a>
        </div>
      </Card>
      <Card
        icon="pen"
        title="Design reference"
        description="See every colour, the shared parts of this page and a map of how Eva works. Use their names when you plan a change with an agent or write an issue."
      >
        <div className="button-row">
          <button onClick={() => context.navigate({ section: "developer", item: designReferenceItem })}>
            Open the design reference
            <Icon name="back" className="flip" />
          </button>
        </div>
      </Card>
    </>
  );
}
