// End-to-end test: real MCP client over stdio against forgejo-process-mcp.
// Scenario: clone source_code_hub, add a FAILING ci workflow, cicd_start ->
// expect immediate "continue" + later ci_run_failed event; then fix the job,
// cicd_start again -> expect ci_run_succeeded.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";

const token = readFileSync(process.env.HOME + "/.config/forgejo/pas-token", "utf8").trim();
const REPO = "Helpfulpaw/source_code_hub";
const DIR = process.argv[2] ?? "/tmp/fpm-e2e/source_code_hub";
const STATE = "/tmp/fpm-e2e/state";
rmSync("/tmp/fpm-e2e", { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: {
    ...process.env,
    FORGEJO_TOKEN: token,
    FORGEJO_URL: "http://127.0.0.1:3310",
    FORGEJO_MCP_STATE_DIR: STATE,
    FORGEJO_MCP_POLL_MS: "8000",
  },
});
const client = new Client({ name: "e2e", version: "0.1.0" });
await client.connect(transport);

const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content[0].text;
  console.log(`\n>>> ${name}(${JSON.stringify(args).slice(0, 120)})`);
  console.log(t.slice(0, 500));
  return t;
};

async function waitEvent(kindWanted, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const t = await client.callTool({ name: "cicd_events", arguments: {} });
    const s = t.content[0].text;
    try {
      const parsed = JSON.parse(s);
      const hit = parsed.events?.find((e) => e.kind === kindWanted);
      if (hit) return hit;
    } catch { /* "no pending events" string */ }
    await new Promise((r) => setTimeout(r, 8000));
  }
  throw new Error(`timeout waiting for ${kindWanted}`);
}

// 1. clone + branch
await call("git_clone", { url: `http://127.0.0.1:3310/${REPO}.git`, dir: DIR });
await call("git_branch", { dir: DIR, name: "mcp-e2e", create: true });

// 2. add a FAILING workflow
mkdirSync(`${DIR}/.forgejo/workflows`, { recursive: true });
writeFileSync(`${DIR}/.forgejo/workflows/e2e.yml`, `name: e2e
on: [push]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - run: echo "failing on purpose" && exit 1
`);
const t1 = await call("cicd_start", { dir: DIR, repo: REPO, message: "e2e: failing gate (expect failure event)" });
const accepted = JSON.parse(t1);
console.log("\nACCEPTED immediately:", accepted.accepted, "| branch:", accepted.branch, "| msg:", accepted.message.slice(0, 120));

// 3. expect failure event
const failEvt = await waitEvent("ci_run_failed", 5 * 60_000);
console.log("\nFAILURE EVENT RECEIVED:", JSON.stringify(failEvt, null, 1).slice(0, 400));

// 4. fix the workflow, push again
writeFileSync(`${DIR}/.forgejo/workflows/e2e.yml`, `name: e2e
on: [push]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - run: echo "green now"
`);
await call("cicd_start", { dir: DIR, repo: REPO, message: "e2e: green gate (expect success event)" });
const okEvt = await waitEvent("ci_run_succeeded", 5 * 60_000);
console.log("\nSUCCESS EVENT RECEIVED:", JSON.stringify(okEvt, null, 1).slice(0, 400));

console.log("\nE2E PASS: async accept + failure event + success event");
await client.close();
process.exit(0);
