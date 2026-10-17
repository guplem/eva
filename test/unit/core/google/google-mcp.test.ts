import { describe, expect, test } from "bun:test";
import { googleMcpServer, workspaceMcpVersion } from "../../../../src/core/google/google-mcp.ts";
import { defaultConfig } from "../../../../src/core/instance/home.ts";

const secrets = { googleOauthClientId: "client-id", googleOauthClientSecret: "client-secret" };
const inputs = {
  config: { ...defaultConfig.google, email: "person@example.com" },
  secrets,
  credentialsFolder: "/eva-home/engines/google",
  environment: { PATH: "/bin" },
};

describe("googleMcpServer", () => {
  test("runs the pinned workspace-mcp read-only, for the configured account (lesson 117)", () => {
    expect(googleMcpServer(inputs)).toEqual({
      command: "uvx",
      args: [
        `workspace-mcp==${workspaceMcpVersion}`,
        "--single-user",
        "--tools",
        "calendar",
        "drive",
        "contacts",
        "tasks",
        "--read-only",
      ],
      environment: {
        PATH: "/bin",
        GOOGLE_OAUTH_CLIENT_ID: "client-id",
        GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
        USER_GOOGLE_EMAIL: "person@example.com",
        WORKSPACE_MCP_CREDENTIALS_DIR: "/eva-home/engines/google",
      },
    });
    expect(workspaceMcpVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("write access drops the read-only flag", () => {
    const server = googleMcpServer({
      ...inputs,
      config: { ...inputs.config, readOnly: false, services: ["calendar"] },
    });
    expect(server?.args).toEqual([`workspace-mcp==${workspaceMcpVersion}`, "--single-user", "--tools", "calendar"]);
  });

  test("Google stays off without an account, a service, or an OAuth client", () => {
    expect(googleMcpServer({ ...inputs, config: { ...inputs.config, email: null } })).toBeNull();
    expect(googleMcpServer({ ...inputs, config: { ...inputs.config, services: [] } })).toBeNull();
    expect(googleMcpServer({ ...inputs, secrets: { googleOauthClientId: "client-id" } })).toBeNull();
  });
});
