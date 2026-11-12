#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { EventStore } from "./events.js";
import { ForgejoClient } from "./forgejo.js";
import { Watcher } from "./watcher.js";
import { startWebhook } from "./webhook.js";
import {
  gitBranch,
  gitClone,
  gitCommitAll,
  gitCurrentBranch,
  gitHeadSha,
  gitPush,
} from "./gitops.js";

const cfg = loadConfig();
const api = new ForgejoClient(cfg);
const store = new EventStore(cfg.stateDir);
const watcher = new Watcher(api, store, cfg.pollIntervalMs);
watcher.start();
startWebhook(cfg.webhookPort, store);

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }] });

const server = new McpServer(
  { name: "forgejo-process-mcp", version: "0.1.0" },
  { instructions: "Forgejo delivery process: git ops, PRs, and ASYNC CI/CD. cicd_start returns immediately — continue development; poll cicd_events for failure/deploy notifications." },
);

// ---------- repos ----------
server.tool(
  "repo_create",
  "Create a Forgejo repository",
  { name: z.string(), description: z.string().optional(), private: z.boolean().optional() },
  async ({ name, description, private: priv }) => text(await api.createRepo(name, description ?? "", priv ?? false)),
);

server.tool("repo_list", "List repositories of the authenticated user", {}, async () =>
  text(await api.listRepos()),
);

// ---------- git ----------
server.tool(
  "git_clone",
  "Clone a repository into a local directory",
  { url: z.string(), dir: z.string() },
  async ({ url, dir }) => text(await gitClone(url, dir)),
);

server.tool(
  "git_branch",
  "Checkout or create a branch in a local repo",
  { dir: z.string(), name: z.string(), create: z.boolean().default(false) },
  async ({ dir, name, create }) => text(await gitBranch(dir, name, create)),
);

server.tool(
  "git_commit",
  "Stage all changes and commit in a local repo",
  { dir: z.string(), message: z.string() },
  async ({ dir, message }) => text(await gitCommitAll(dir, message)),
);

server.tool(
  "git_push",
  "Push the current (or given) branch to a remote",
  { dir: z.string(), remote: z.string().default("origin"), branch: z.string().optional() },
  async ({ dir, remote, branch }) => text(await gitPush(dir, remote, branch)),
);

// ---------- pull requests ----------
server.tool(
  "pr_open",
  "Open a pull request",
  { repo: z.string().describe("owner/name"), head: z.string(), base: z.string().default("main"), title: z.string(), body: z.string().optional() },
  async ({ repo, head, base, title, body }) => text(await api.openPr(repo, head, base, title, body ?? "")),
);

server.tool(
  "pr_status",
  "Get pull request state (mergeable, CI linkage)",
  { repo: z.string(), index: z.number() },
  async ({ repo, index }) => text(await api.getPr(repo, index)),
);

server.tool(
  "pr_merge",
  "Merge a pull request",
  { repo: z.string(), index: z.number(), style: z.enum(["merge", "rebase", "squash"]).default("merge") },
  async ({ repo, index, style }) => text(await api.mergePr(repo, index, style)),
);

// ---------- CI/CD (async) ----------
server.tool(
  "ci_runs",
  "List recent Forgejo Actions runs for a repo",
  { repo: z.string(), limit: z.number().default(10) },
  async ({ repo, limit }) => text(await api.listRuns(repo, limit)),
);

server.tool(
  "cicd_start",
  "Commit+push the working dir, register a CI/CD watch, and RETURN IMMEDIATELY. Do not block on the run — continue development; completion/failure arrives via cicd_events.",
  {
    dir: z.string().describe("local repo working directory"),
    repo: z.string().describe("owner/name"),
    message: z.string().describe("commit message"),
    kind: z.enum(["ci", "deploy"]).default("ci"),
    deadline_minutes: z.number().default(30),
  },
  async ({ dir, repo, message, kind, deadline_minutes }) => {
    const branch = await gitCurrentBranch(dir);
    const committed = await gitCommitAll(dir, message);
    const pushed = await gitPush(dir);
    const headSha = await gitHeadSha(dir);
    const watch = {
      id: `watch-${Date.now().toString(36)}`,
      repo,
      runId: null,
      headSha,
      branch,
      kind,
      createdAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + deadline_minutes * 60_000).toISOString(),
    };
    store.addWatch(watch);
    return text({
      accepted: true,
      branch,
      headSha,
      watchId: watch.id,
      git: { committed, pushed },
      message:
        `CI/CD accepted on ${repo} (${branch}@${headSha.slice(0, 8)}). ` +
        `You can continue development now — do NOT poll ci_runs in a loop. ` +
        `A ci_run_failed / ci_run_succeeded / deploy_finished event will be waiting in cicd_events.`,
    });
  },
);

server.tool(
  "cicd_events",
  "Drain pending CI/CD events (failures, greens, deploy completions). Call between development steps.",
  {},
  async () => {
    const events = store.drain();
    return text(
      events.length
        ? { pending: events.length, events }
        : "no pending events — watches still open or nothing happened yet",
    );
  },
);

server.tool("watch_list", "List active CI/CD watches", {}, async () => text(store.listWatches()));

await server.connect(new StdioServerTransport());
console.error(`[forgejo-process-mcp] up — ${cfg.forgejoUrl}, state: ${cfg.stateDir}, poll ${cfg.pollIntervalMs}ms`);
