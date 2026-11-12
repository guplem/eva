/**
 * The computers that run Eva with this vault, for the Devices page. Each computer writes a report to
 * the vault, and the vault names the hub, so every computer shows the same list.
 */
import { readMachineReports } from "../alerts/machine-reports.ts";
import { readHubClaim, type MachineRole } from "./hub.ts";

export interface ComputerSummary {
  readonly name: string;
  readonly role: MachineRole;
  /** The Eva version of its last report, or null before it reports. */
  readonly version: string | null;
  /** True for the computer that answers this request. */
  readonly current: boolean;
}

/**
 * The hub comes first, then the others by name. `role` is this computer's role: it names the hub
 * when the vault has no readable claim, as `machineRole` does.
 */
export function listComputers(
  vaultPath: string | null,
  machine: string,
  version: string,
  role: MachineRole,
): ComputerSummary[] {
  const versions = new Map<string, string | null>();
  const add = (name: string, known: string | null): void => {
    // Report files are lower case, because Windows sees "Laptop" and "laptop" as one file.
    const same = [...versions.keys()].find((each) => each.toLowerCase() === name.toLowerCase());
    if (same === undefined) versions.set(name, known);
    else if (known !== null) versions.set(same, known);
  };
  const hub = (vaultPath === null ? null : readHubClaim(vaultPath)?.machine) ?? (role === "hub" ? machine : null);
  if (vaultPath !== null)
    for (const { report } of readMachineReports(vaultPath)) if (report !== null) add(report.machine, report.version);
  if (hub !== null) add(hub, null);
  add(machine, version);
  const isSame = (first: string, second: string | null): boolean =>
    second !== null && first.toLowerCase() === second.toLowerCase();
  return [...versions]
    .map(([name, known]) => ({
      name,
      role: isSame(name, hub) ? ("hub" as const) : ("satellite" as const),
      version: known,
      current: isSame(name, machine),
    }))
    .sort((first, second) =>
      first.role === second.role ? first.name.localeCompare(second.name) : first.role === "hub" ? -1 : 1,
    );
}
