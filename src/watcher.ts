import type { ForgejoClient } from "./forgejo.js";
import type { EventStore, Watch } from "./events.js";

const TERMINAL_OK = new Set(["success"]);
const TERMINAL_BAD = new Set(["failure", "failed", "cancelled", "timed_out", "action_required"]);

/**
 * Background poller: watches Forgejo Actions runs and emits agent events on
 * terminal states. Watches survive restarts (persisted in the state dir).
 */
export class Watcher {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly api: ForgejoClient,
    private readonly store: EventStore,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    const now = Date.now();
    for (const w of this.store.listWatches()) {
      try {
        await this.check(w, now);
      } catch (e) {
        console.error(`[watcher] ${w.id}: ${String(e).slice(0, 200)}`);
      }
    }
  }

  private async check(w: Watch, now: number): Promise<void> {
    if (now > Date.parse(w.deadlineAt)) {
      this.store.append({
        kind: "watch_expired",
        repo: w.repo,
        summary: `Watch on ${w.repo} (${w.kind}) expired without a terminal state`,
        detail: { watchId: w.id },
      });
      this.store.removeWatch(w.id);
      return;
    }

    if (!w.headSha) {
      // Legacy branch-bound watch: bind to the first visible run for the branch.
      const runs = await this.api.listRuns(w.repo, 20);
      const run = runs.find((r) => (w.branch ? r.head_branch === w.branch : true));
      if (!run) return;
      this.store.removeWatch(w.id);
      this.store.addWatch({ ...w, runId: run.id });
      return;
    }

    // Commit-status based evaluation (durable on Forgejo 11; task entries vanish).
    const statuses = await this.api.commitStatuses(w.repo, w.headSha);
    if (statuses.size === 0) return; // run not planned yet — keep waiting

    const values = [...statuses.values()];
    const failed = values.filter((v) => TERMINAL_BAD.has(v));
    const pending = values.filter((v) => !TERMINAL_OK.has(v) && !TERMINAL_BAD.has(v));
    if (failed.length === 0 && pending.length > 0) return; // still running

    const isDeploy = w.kind === "deploy";
    const anyFail = failed.length > 0;

    if (!anyFail) {
      // Success requires a stable context set: on this instance job contexts
      // appear minutes apart during planning, so "all green" must survive two
      // consecutive identical polls before we declare green.
      const sig = [...statuses.entries()].sort().map(([k, v]) => `${k}=${v}`).join("|");
      if (w.lastSig !== sig) {
        this.store.removeWatch(w.id);
        this.store.addWatch({ ...w, lastSig: sig });
        return;
      }
    }
    this.store.append({
      kind: anyFail ? "ci_run_failed" : isDeploy ? "deploy_finished" : "ci_run_succeeded",
      repo: w.repo,
      summary: anyFail
        ? `CI/CD FAILED on ${w.repo} @${w.headSha.slice(0, 8)}: ${failed.length} job context(s) failed — investigate before continuing this line of work`
        : isDeploy
          ? `Deploy finished on ${w.repo} @${w.headSha.slice(0, 8)} — production Playwright testing can start`
          : `CI green on ${w.repo} @${w.headSha.slice(0, 8)}`,
      detail: {
        watchId: w.id,
        headSha: w.headSha,
        contexts: Object.fromEntries(statuses),
      },
    });
    this.store.removeWatch(w.id);
  }
}
