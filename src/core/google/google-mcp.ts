/**
 * The Google tools of Assistant mode (docs/plan.md §9): the `workspace-mcp` server for
 * Calendar, Drive, Contacts and Tasks, run with `uvx` and pinned to an exact version
 * (lesson 117). Google stays off until the person sets an account and an OAuth client.
 */
import type { McpServerSpec } from "../../shared/engine-port.ts";
import type { EvaConfig, EvaSecrets } from "../instance/home.ts";

/** Change it on purpose only, after a check of the new tool names (the approval rule reads them). */
export const workspaceMcpVersion = "2.1.0";

export interface GoogleMcpInputs {
  readonly config: EvaConfig["google"];
  readonly secrets: EvaSecrets;
  /** Where the server keeps the person's Google login, in the instance home. */
  readonly credentialsFolder: string;
  /** The allowlisted base environment (lesson 96). */
  readonly environment: Readonly<Record<string, string>>;
}

export function googleMcpServer(inputs: GoogleMcpInputs): McpServerSpec | null {
  const { config, secrets } = inputs;
  if (
    config.email === null ||
    config.services.length === 0 ||
    secrets.googleOauthClientId === undefined ||
    secrets.googleOauthClientSecret === undefined
  ) {
    return null;
  }
  return {
    command: "uvx",
    args: [
      `workspace-mcp==${workspaceMcpVersion}`,
      "--single-user",
      "--tools",
      ...config.services,
      ...(config.readOnly ? ["--read-only"] : []),
    ],
    environment: {
      ...inputs.environment,
      GOOGLE_OAUTH_CLIENT_ID: secrets.googleOauthClientId,
      GOOGLE_OAUTH_CLIENT_SECRET: secrets.googleOauthClientSecret,
      USER_GOOGLE_EMAIL: config.email,
      WORKSPACE_MCP_CREDENTIALS_DIR: inputs.credentialsFolder,
    },
  };
}
