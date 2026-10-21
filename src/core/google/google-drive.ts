/**
 * A Drive folder for a new project, made by Eva herself with the person's Google login. The
 * form runs outside any chat, so the `workspace-mcp` tools cannot make it.
 */
import { EvaError } from "../../shared/errors.ts";
import { googleAccessToken, type GoogleCheckInputs } from "./google-check.ts";
import { googleUrls } from "./google-login.ts";

export type GoogleDriveInputs = Omit<GoogleCheckInputs, "readServices">;

const requestTimeoutMs = 30_000;
const folderType = "application/vnd.google-apps.folder";

/** Creates a folder at the top of the person's Drive and gives its link. Throws `google_failed`. */
export async function createDriveFolder(inputs: GoogleDriveInputs, name: string): Promise<string> {
  if (!inputs.config.services.includes("drive"))
    throw new EvaError("google_failed", "Turn on Google Drive in Settings > Connections > Google first.");
  // A lower level gives no scope that can write to Drive.
  if (inputs.config.access.drive !== "full")
    throw new EvaError("google_failed", "Give Google Drive full access in Settings > Connections > Google first.");
  const access = await googleAccessToken(inputs);
  if ("problem" in access) throw new EvaError("google_failed", access.problem);

  let response: Response;
  try {
    response = await fetch(`${googleUrls(inputs.baseUrl).api}/drive/v3/files?fields=webViewLink`, {
      method: "POST",
      headers: { authorization: `Bearer ${access.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: folderType }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    throw new EvaError("google_failed", "Eva could not reach Google. Check the machine's internet connection.", {
      cause: error,
    });
  }
  const body = (await response.json().catch(() => null)) as { webViewLink?: unknown } | null;
  if (!response.ok)
    throw new EvaError("google_failed", `Google refused to create the Drive folder (HTTP ${String(response.status)}).`);
  if (typeof body?.webViewLink === "string") return body.webViewLink;
  throw new EvaError("google_failed", "Google sent an answer that Eva cannot read.");
}
