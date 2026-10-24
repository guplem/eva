// A temporary probe for #457: how Windows PowerShell treats an input pipe that stays open.
// It prints what each way to start PowerShell does, and never fails. Remove it with the fix.
import { afterAll, describe, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trayCommand } from "../../../../src/frontends/cli/tray.ts";
import { baseEnvironmentAllowlist, buildChildEnvironment } from "../../../../src/shared/environment.ts";
import { systemLineProcessStarter } from "../../../../src/shared/line-process.ts";

const folder = mkdtempSync(join(tmpdir(), "eva-tray-probe-"));
afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

const script =
  "[Console]::Error.WriteLine('started'); $r = New-Object System.IO.StreamReader([Console]::OpenStandardInput()); [Console]::Error.WriteLine('got ' + $r.ReadLine()); [Console]::Error.WriteLine('got ' + $r.ReadLine())";

async function probe(name: string, command: string[]): Promise<void> {
  const began = Date.now();
  const at = (): string => `${String(Date.now() - began)} ms`;
  const child = systemLineProcessStarter(command, {
    cwd: folder,
    environment: {
      ...buildChildEnvironment(process.env, baseEnvironmentAllowlist),
      EVA_TRAY_TRACE: "1",
    },
  });
  const notes: string[] = [];
  let seen = "";
  const watch = setInterval(() => {
    const now = child.stderrTail();
    if (now !== seen) {
      notes.push(`${at()}: ${now.slice(seen.length).trim().slice(0, 300)}`);
      seen = now;
    }
  }, 100);
  await Bun.sleep(8_000);
  child.send(JSON.stringify({ face: "neutral", tooltip: "Eva (probe)\nhello", title: "Eva (probe)", canOpen: true }));
  notes.push(`${at()}: sent a line`);
  await Bun.sleep(8_000);
  notes.push(`${at()}: closing the input`);
  await child.close(15_000);
  const code = await child.exited;
  await Bun.sleep(200);
  clearInterval(watch);
  if (child.stderrTail() !== seen) notes.push(`${at()}: ${child.stderrTail().slice(seen.length).trim().slice(0, 300)}`);
  console.log(`PROBE ${name}: exit ${String(code)} at ${at()}\n  ${notes.join("\n  ")}`);
}

describe.if(process.platform === "win32")("PowerShell input probe", () => {
  const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
  const powershell = trayCommand(systemRoot)[0] ?? "powershell.exe";
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const file = join(folder, "probe.ps1");
  writeFileSync(file, script);

  test("each way to start PowerShell", async () => {
    await Promise.all([
      probe("command", [powershell, "-NoProfile", "-NonInteractive", "-Command", script]),
      probe("command-none", [powershell, "-NoProfile", "-NonInteractive", "-InputFormat", "None", "-Command", script]),
      probe("encoded-none", [
        powershell,
        "-NoProfile",
        "-NonInteractive",
        "-InputFormat",
        "None",
        "-EncodedCommand",
        encoded,
      ]),
      probe("file", [powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file]),
      probe("file-none", [
        powershell,
        "-NoProfile",
        "-NonInteractive",
        "-InputFormat",
        "None",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        file,
      ]),
      probe("tray", trayCommand(systemRoot)),
    ]);
  }, 90_000);
});
