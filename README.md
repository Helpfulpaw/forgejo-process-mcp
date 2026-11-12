# forgejo-process-mcp

MCP server that turns Forgejo CI/CD into an **async, agent-native** process:
git mechanics, PRs, and CI/CD runs as tools — with `cicd_start` returning
immediately so the agent keeps developing, and run outcomes delivered later
as events (`ci_run_failed` / `ci_run_succeeded` / `deploy_finished`) via
`cicd_events`.

Built for the pattern: *"when Forgejo accepts the CI/CD start, tell the agent
it can continue development — and notify it when something fails or a deploy
finishes, so production Playwright testing can start."*

Pairs with the `delivery-loop` skill (`skills/delivery-loop/SKILL.md`):
the skill owns judgment and sequencing, this server owns mechanics.

## Tools

| tool | what it does |
| --- | --- |
| `repo_create` / `repo_list` | Forgejo repository management |
| `git_clone` / `git_branch` / `git_commit` / `git_push` | local git mechanics |
| `pr_open` / `pr_status` / `pr_merge` | pull request lifecycle |
| `ci_runs` | list recent Actions runs (inspection only — not for polling loops) |
| `cicd_start` | commit + push + register a run watch; **returns immediately** with `accepted: true` and a watch id |
| `cicd_events` | drain pending events — call between development steps |
| `watch_list` | list open watches |

## How the async flow works

```
agent ──cicd_start──▶ MCP: commit+push, register watch ──▶ returns at once:
                      "accepted — you can continue development"
                      │
background watcher (polls Forgejo Actions, default 15 s)
                      │
        run reaches terminal state ──▶ event queued
                      │
agent ──cicd_events──▶ {ci_run_failed | ci_run_succeeded | deploy_finished}
```

Watches persist on disk (`$STATE_DIR/watches.json`), so a restarted server
resumes watching. An optional webhook listener
(`FORGEJO_MCP_WEBHOOK_PORT`) accepts Forgejo webhooks for instant events —
from a dockerized Forgejo use `http://host.docker.internal:<port>/webhook`.

## Setup

```bash
npm install
npm run build
```

Configuration via environment:

| var | default | purpose |
| --- | --- | --- |
| `FORGEJO_URL` | `http://127.0.0.1:3310` | Forgejo base URL |
| `FORGEJO_TOKEN` | — (required) | API token |
| `FORGEJO_MCP_STATE_DIR` | `~/.forgejo-process-mcp` | events/watches state |
| `FORGEJO_MCP_POLL_MS` | `15000` | watcher poll interval |
| `FORGEJO_MCP_WEBHOOK_PORT` | `0` (off) | webhook listener port |

### Register with an MCP host (example: kimi-code `config.toml`)

```toml
[mcp.servers.forgejo-process]
command = "node"
args = ["/abs/path/forgejo-process-mcp/dist/index.js"]
env = { FORGEJO_URL = "http://127.0.0.1:3310", FORGEJO_TOKEN = "..." }
```

## Forgejo instance notes (found during bring-up, Forgejo 11.0.16)

1. **Runner capacity starves CI.** With `capacity: 1` in the runner's
   `config.yml`, one chatty repo floods the FIFO queue and other repos' runs
   wait for hours. Raise `capacity` (this instance: 4).
2. **Webhooks need an allowlist.** Default `webhook.ALLOWED_HOST_LIST`
   blocks `host.docker.internal`, so a dockerized Forgejo cannot call a
   webhook listener on the host. Add it to `app.ini`:
   `[webhook] ALLOWED_HOST_LIST = host.docker.internal,...`
3. **Run planning lag is minutes, not seconds.** New runs sit in an initial
   state before jobs are planned and contexts appear. This server therefore
   watches **commit statuses** (durable) rather than `/actions/tasks`
   (entries vanish after completion), and declares green only after the
   context set is stable across two polls.
4. **No run-level REST API** in Forgejo 11 (`/actions/runs` is 404) — commit
   statuses per pushed SHA are the reliable read.

## End-to-end test

Drives a real failure-then-success cycle against a live Forgejo
(clone → failing CI → `ci_run_failed` event → fix → `ci_run_succeeded`):

```bash
node scripts/e2e.mjs
```

## License

MIT
