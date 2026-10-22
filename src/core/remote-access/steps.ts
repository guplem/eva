/**
 * The words of "Use Eva from any device", for every front end: what to do on this machine
 * now, and the 3 steps for each new device. Pure, so the web page bundles it too.
 */
import type { RemoteAccess, RemoteAccessStep } from "./remote-access.ts";

export const installPage = "https://tailscale.com/download";

/** One thing the person does. A front end shows `action` as a button that Eva runs. */
export interface GuideStep {
  readonly text: string;
  readonly link: string | null;
  readonly action: "install" | "sign_in" | null;
}

/** The step, also for an older Eva that sends only the address or the problem. */
export function remoteAccessStep(access: RemoteAccess): RemoteAccessStep {
  return access.step ?? (access.url === null ? "failed" : "ready");
}

/** What to do on this machine now; empty once the address works. */
export function setupSteps(access: RemoteAccess): GuideStep[] {
  const step = remoteAccessStep(access);
  const problem: GuideStep[] = access.problem === null ? [] : [{ text: access.problem, link: null, action: null }];
  switch (step) {
    case "ready":
      return [];
    case "failed":
      return problem.length > 0
        ? problem
        : [{ text: "Eva cannot publish her page. See the warnings in her log.", link: null, action: null }];
    case "install":
      if (access.busy === "installing")
        return [
          {
            text: "Eva installs Tailscale now. On Windows, accept the prompt on this machine's screen.",
            link: null,
            action: null,
          },
        ];
      return [
        ...problem,
        access.canInstall === true
          ? { text: "Install Tailscale on this machine. Eva can install it for you.", link: null, action: "install" }
          : { text: "Install Tailscale on this machine, and open it once.", link: installPage, action: null },
      ];
    case "start":
      return [
        ...problem,
        {
          text: "Start Tailscale on this machine. On Windows or macOS, open the Tailscale app. On Linux, start the tailscaled service.",
          link: null,
          action: null,
        },
      ];
    case "sign_in":
      return [
        ...problem,
        access.link === null || access.link === undefined
          ? { text: "Sign in to Tailscale on this machine.", link: null, action: "sign_in" }
          : { text: "Sign in to Tailscale: open this link on any device.", link: access.link, action: "sign_in" },
      ];
    case "https":
      return [
        {
          text: "Turn on HTTPS for your tailnet once: open this page and turn on HTTPS Certificates.",
          link: access.link ?? null,
          action: null,
        },
      ];
  }
}

/** The 3 steps for each phone or computer. */
export function deviceSteps(access: RemoteAccess): GuideStep[] {
  const account = access.account ?? null;
  const url = remoteAccessStep(access) === "ready" ? access.url : null;
  return [
    { text: "Install Tailscale on the phone or computer.", link: installPage, action: null },
    {
      text:
        account === null
          ? "Sign in to Tailscale there with the same account as this machine."
          : `Sign in to Tailscale there with the same account as this machine: ${account}.`,
      link: null,
      action: null,
    },
    {
      text:
        url === null
          ? "Open Eva's address there, or scan its QR code. Eva shows both here once Tailscale is ready."
          : `Open ${url}, or scan its QR code. The first time, allow the device in Telegram, or log in with the token.`,
      link: null,
      action: null,
    },
  ];
}

/**
 * The lines for a terminal or a chat. `actionHint` follows a step that Eva can do, and
 * says where the person asks her to.
 */
export function describeAccess(input: {
  readonly remoteAccess: RemoteAccess | null;
  readonly actionHint?: string;
}): string[] {
  // The terminal makes a login link, so a person on this computer needs no token or code (#407).
  const local = "On Eva's computer, run `eva open`. It opens her page in that computer's browser, logged in.";
  const access = input.remoteAccess;
  if (access === null)
    return [
      "Use Eva from any device: off. Run `eva settings set remoteAccess.tailscaleServe true` to turn it on.",
      local,
    ];
  const devices = deviceSteps(access).map((step, index) => `${String(index + 1)}. ${stepLine(step)}`);
  if (access.url !== null && remoteAccessStep(access) === "ready")
    return [`Open Eva: ${access.url}`, "On each phone or computer:", ...devices, local];
  const here = setupSteps(access);
  const hint = input.actionHint !== undefined && here.some((step) => step.action !== null) ? [input.actionHint] : [];
  return [
    "Use Eva from any device: not ready yet. Next, on this machine:",
    ...here.map((step) => `- ${stepLine(step)}`),
    ...hint,
    "Then, on each phone or computer:",
    ...devices,
    "Eva finds each change by herself within a minute.",
    local,
  ];
}

/** One step as plain text, for a terminal or a chat. */
export function stepLine(step: GuideStep): string {
  return step.link === null ? step.text : `${step.text} ${step.link}`;
}

/** The label of the button that runs an action, the same in every front end. */
export function actionLabel(action: NonNullable<GuideStep["action"]>): string {
  return action === "install" ? "Install Tailscale" : "Sign in to Tailscale";
}
