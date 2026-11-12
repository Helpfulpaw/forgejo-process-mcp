import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

export interface Config {
  forgejoUrl: string;
  forgejoToken: string;
  stateDir: string;
  pollIntervalMs: number;
  webhookPort: number;
}

function loadToken(): string {
  if (process.env.FORGEJO_TOKEN) return process.env.FORGEJO_TOKEN;
  const file = process.env.FORGEJO_TOKEN_FILE;
  if (file) {
    try {
      return readFileSync(file, "utf8").trim();
    } catch {
      console.error(`[config] cannot read FORGEJO_TOKEN_FILE=${file}`);
    }
  }
  return "";
}

export function loadConfig(): Config {
  const token = loadToken();
  if (!token) {
    console.error("[config] neither FORGEJO_TOKEN nor FORGEJO_TOKEN_FILE set — API calls will fail");
  }
  return {
    forgejoUrl: (process.env.FORGEJO_URL ?? "http://127.0.0.1:3310").replace(/\/$/, ""),
    forgejoToken: token,
    stateDir: process.env.FORGEJO_MCP_STATE_DIR ?? join(homedir(), ".forgejo-process-mcp"),
    pollIntervalMs: Number(process.env.FORGEJO_MCP_POLL_MS ?? "15000"),
    webhookPort: Number(process.env.FORGEJO_MCP_WEBHOOK_PORT ?? "0"),
  };
}
