import { describe, expect, test } from "bun:test";
import { googleMcpServer, workspaceMcpVersion } from "../../../../src/core/google/google-mcp.ts";
import { defaultConfig } from "../../../../src/core/settings/home.ts";

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
        "--permissions",
        "calendar:readonly",
        "drive:readonly",
        "contacts:readonly",
        "tasks:readonly",
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

  test("gives each service that is on its own level", () => {
    const server = googleMcpServer({
      ...inputs,
      config: {
        ...inputs.config,
        access: { ...inputs.config.access, contacts: "full", gmail: "drafts" },
        services: ["contacts", "gmail"],
      },
    });
    expect(server?.args).toEqual([
      `workspace-mcp==${workspaceMcpVersion}`,
      "--single-user",
      "--permissions",
      "contacts:full",
      "gmail:drafts",
    ]);
  });

  test("names each service once: workspace-mcp stops at a repeated one", () => {
    const server = googleMcpServer({ ...inputs, config: { ...inputs.config, services: ["calendar", "calendar"] } });
    expect(server?.args).toEqual([
      `workspace-mcp==${workspaceMcpVersion}`,
      "--single-user",
      "--permissions",
      "calendar:readonly",
    ]);
  });

  test("Google stays off without an account, a service, or an OAuth client", () => {
    expect(googleMcpServer({ ...inputs, config: { ...inputs.config, email: null } })).toBeNull();
    expect(googleMcpServer({ ...inputs, config: { ...inputs.config, services: [] } })).toBeNull();
    expect(googleMcpServer({ ...inputs, secrets: { googleOauthClientId: "client-id" } })).toBeNull();
  });
});
