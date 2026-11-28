/**
 * A harmless program for tests of Eva's own git (#1131): it only adds a line to a marker file in
 * the test's own temporary folder. A test names it in a git setting and checks that the marker
 * file never appears. Git for Windows runs it through its own `sh`, so it works on both systems.
 */
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface MarkerProgram {
  /** The program's path, with `/` separators, as a git setting takes it on both systems. */
  readonly path: string;
  /** True when the program ran at least once. */
  ran(): boolean;
}

export function markerProgram(folder: string, name = "marker"): MarkerProgram {
  const marker = join(folder, `${name}.ran`).replaceAll("\\", "/");
  const path = join(folder, `${name}.sh`).replaceAll("\\", "/");
  writeFileSync(path, `#!/bin/sh\necho ran >> "${marker}"\nexit 1\n`);
  chmodSync(path, 0o755);
  return { path, ran: () => existsSync(marker) };
}
