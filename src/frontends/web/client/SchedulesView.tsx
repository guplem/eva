/** The Schedules page. It has its own page so that Settings keeps only the settings. */
import type { ReactElement } from "react";
import { SchedulesPanel } from "./SchedulesPanel.tsx";

export function SchedulesView(): ReactElement {
  return (
    <div className="main">
      <div className="settings">
        <h1>Schedules</h1>
        <SchedulesPanel />
      </div>
    </div>
  );
}
