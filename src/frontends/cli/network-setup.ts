/**
 * The network step of `eva setup`: it installs Tailscale where Eva can, brings the machine into
 * the person's tailnet, turns HTTPS on, and ends with the address that opens Eva on every other
 * device. Each step that needs the person shows a link and waits; nothing here needs root.
 */
import { renderUnicodeCompact } from "uqr";
import type { RemoteAccess, RemoteAccessStep } from "../../core/remote-access/remote-access.ts";
import { describeAccess, remoteAccessStep, setupSteps } from "../../core/remote-access/steps.ts";

export interface NetworkSetupOptions {
  readonly access: {
    refresh(): Promise<RemoteAccess>;
    install(): Promise<RemoteAccess>;
    signIn(): Promise<RemoteAccess>;
  };
  readonly localUrl: string;
  readonly write: (line: string) => void;
  /** Answers a yes or no question; an empty answer means the default. */
  readonly ask: (question: string) => Promise<string>;
  /** False: no question and no wait, only the state and what to do. */
  readonly interactive: boolean;
  readonly sleep: (ms: number) => Promise<void>;
  /** How long a wait for the person lasts. */
  readonly waitLimitMs?: number;
}

const pollMs = 5_000;
const defaultWaitLimitMs = 10 * 60_000;

/** The lines of `describeAccess`, and a QR code to scan once the address works. */
export function accessLines(input: {
  readonly remoteAccess: RemoteAccess | null;
  readonly localUrl: string;
  readonly actionHint?: string;
}): string[] {
  const lines = describeAccess(input);
  const url = input.remoteAccess?.url ?? null;
  if (url === null || input.remoteAccess === null || remoteAccessStep(input.remoteAccess) !== "ready") return lines;
  // Some terminals cannot draw the blocks, so the plain address stays in the first line.
  return [
    ...lines.slice(0, 1),
    "Scan this code on a phone that has Tailscale:",
    renderUnicodeCompact(url),
    ...lines.slice(1),
  ];
}

/** Walks the person through Tailscale. Returns the address that opens Eva, or null. */
export async function runNetworkSetup(options: NetworkSetupOptions): Promise<string | null> {
  options.write("");
  options.write(
    "Use Eva from any device: Tailscale (a free private network of your own devices) opens Eva on your phone and other computers.",
  );
  let access = await options.access.refresh();
  const handled = new Set<RemoteAccessStep>();
  while (options.interactive) {
    const step = remoteAccessStep(access);
    if (step === "ready" || step === "failed" || handled.has(step)) break;
    handled.add(step);
    access = await handleStep(options, access, step);
  }
  for (const line of accessLines({
    remoteAccess: access,
    localUrl: options.localUrl,
    actionHint: "Run `eva setup` to let Eva do these steps.",
  }))
    options.write(line);
  return remoteAccessStep(access) === "ready" ? access.url : null;
}

/** Does one step with the person. Returns the state after it. */
async function handleStep(
  options: NetworkSetupOptions,
  access: RemoteAccess,
  step: RemoteAccessStep,
): Promise<RemoteAccess> {
  if (step === "install" && access.canInstall === true) {
    if (/^n/i.test((await options.ask("Install Tailscale on this machine now? [Y/n]: ")).trim())) return access;
    options.write("Installing Tailscale… On Windows, accept the prompt that asks for administrator rights.");
    const installed = await options.access.install();
    if (remoteAccessStep(installed) === "install") writeSteps(options, installed);
    return installed;
  }
  if (step === "sign_in") {
    if (/^n/i.test((await options.ask("Sign this machine in to Tailscale now? [Y/n]: ")).trim())) return access;
    const signedIn = await options.access.signIn();
    if (remoteAccessStep(signedIn) !== "sign_in" || signedIn.problem !== null) return signedIn;
    writeSteps(options, signedIn);
    return waitForChange(options, step);
  }
  writeSteps(options, access);
  return waitForChange(options, step);
}

function writeSteps(options: NetworkSetupOptions, access: RemoteAccess): void {
  for (const step of setupSteps(access)) options.write(step.link === null ? step.text : `${step.text} ${step.link}`);
}

async function waitForChange(options: NetworkSetupOptions, step: RemoteAccessStep): Promise<RemoteAccess> {
  options.write("Waiting…");
  const limit = options.waitLimitMs ?? defaultWaitLimitMs;
  let access: RemoteAccess | null = null;
  for (let waited = 0; waited < limit; waited += pollMs) {
    await options.sleep(pollMs);
    access = await options.access.refresh();
    if (remoteAccessStep(access) !== step) return access;
  }
  options.write("Stopped waiting. Finish the step later: the running Eva finds it by herself within a minute.");
  return access ?? options.access.refresh();
}
