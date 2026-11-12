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
 * when the vault has no readable claim, as `machineRole` does. Names compare exactly, as there.
 */
export function listComputers(
  vaultPath: string | null,
  machine: string,
  version: string,
  role: MachineRole,
): ComputerSummary[] {
  const versions = new Map<string, string | null>();
  const hub = (vaultPath === null ? null : readHubClaim(vaultPath)?.machine) ?? (role === "hub" ? machine : null);
  if (vaultPath !== null)
    for (const { report } of readMachineReports(vaultPath))
      // An older report can lack its version, which reads as "".
      if (report !== null) versions.set(report.machine, report.version === "" ? null : report.version);
  if (hub !== null && !versions.has(hub)) versions.set(hub, null);
  versions.set(machine, version);
  return [...versions]
    .map(([name, known]) => ({
      name,
      role: name === hub ? ("hub" as const) : ("satellite" as const),
      version: known,
      current: name === machine,
    }))
    .sort((first, second) =>
      first.role === second.role ? first.name.localeCompare(second.name) : first.role === "hub" ? -1 : 1,
    );
}
