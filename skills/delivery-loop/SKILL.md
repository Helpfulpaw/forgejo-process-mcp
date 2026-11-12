---
name: delivery-loop
description: >-
  Deliver code changes through Forgejo with ASYNC CI/CD: branch, commit, then
  cicd_start and KEEP WORKING — failure/deploy events arrive via cicd_events.
  Use whenever pushing to a Forgejo repo with Actions CI, opening PRs, or
  running deploy-gated production Playwright tests. Requires the
  forgejo-process-mcp server (git + Forgejo tools); this skill owns judgment
  and sequencing only, never raw git/API calls.
metadata:
  base: false
  version: "0.1.0"
---

# delivery-loop

Split of responsibilities (do not cross the line):

- **This skill** — judgment: what to commit, when a line of work is done,
  what an event means, when to merge.
- **forgejo-process-mcp** — mechanics: git branch/commit/push, PR open/merge,
  run watching, event delivery. Never re-implement these with Bash/curl.

## The loop

1. `git_branch` (create) — one line of work per branch.
2. Make the change. Keep commits small enough to describe in one line.
3. `cicd_start` — this is **fire-and-continue**. The tool returns
   `accepted: true` immediately with a watch id. Do NOT poll `ci_runs`;
   that is the waste pattern this design exists to remove.
4. Continue the next independent development step.
5. Between steps, call `cicd_events` and handle what arrived:

   | event | action |
   | --- | --- |
   | `ci_run_failed` | Stop that line of work. Get the run, read the failing job, fix, `cicd_start` again. Do not start dependent work on a red base. |
   | `ci_run_succeeded` | The branch is mergeable. If the line is complete: `pr_open` (if not yet open) → `pr_merge`. |
   | `deploy_finished` | Deploy succeeded — start **production Playwright testing** now; that is the acceptance gate for closing the task. |
   | `watch_expired` | The run never reached a terminal state — check runner health, then re-register with `cicd_start` or a fresh watch. |

6. Task closes only when: PR merged green **and** (for deploys) production
   Playwright tests passed.

## Hard rules

- One `cicd_start` per meaningful push. No push-per-keystroke.
- Never block on CI. If you catch yourself sleeping to wait for a run, call
  `cicd_events` once and do something else instead.
- A red event for branch X forbids merging X or branching dependent work
  from X until green.
- Events are drained once — act on them when read; they are not re-delivered.

## Definition of done

- [ ] Branch green (`ci_run_succeeded` received, not assumed)
- [ ] PR merged via `pr_merge`
- [ ] Deploys: `deploy_finished` received AND production Playwright tests green
- [ ] No open watches left (`watch_list` empty) at task close
