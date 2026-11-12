import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  forgejoUrl: string;
  forgejoToken: string;
  stateDir: string;
  pollIntervalMs: number;
  webhookPort: number;
}

export function loadConfig(): Config {
  const token = process.env.FORGEJO_TOKEN ?? "";
  if (!token) {
    console.error("[config] FORGEJO_TOKEN is not set — API calls will fail");
  }
  return {
    forgejoUrl: (process.env.FORGEJO_URL ?? "http://127.0.0.1:3310").replace(/\/$/, ""),
    forgejoToken: token,
    stateDir: process.env.FORGEJO_MCP_STATE_DIR ?? join(homedir(), ".forgejo-process-mcp"),
    pollIntervalMs: Number(process.env.FORGEJO_MCP_POLL_MS ?? "15000"),
    webhookPort: Number(process.env.FORGEJO_MCP_WEBHOOK_PORT ?? "0"),
  };
}
