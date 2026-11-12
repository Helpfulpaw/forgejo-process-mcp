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

    const runs = await this.api.listRuns(w.repo, 20);
    const run = w.runId
      ? runs.find((r) => r.id === w.runId)
      : runs.find((r) => (w.branch ? r.head_branch === w.branch : true));

    if (!run) return; // run not visible yet — keep waiting
    if (!w.runId) {
      // Bind the watch to the concrete run once it appears.
      this.store.removeWatch(w.id);
      this.store.addWatch({ ...w, runId: run.id });
      return;
    }

    const status = String(run.status).toLowerCase();
    const conclusion = String(run.conclusion ?? "").toLowerCase();
    const failed = TERMINAL_BAD.has(status) || TERMINAL_BAD.has(conclusion);
    const ok = TERMINAL_OK.has(status) || TERMINAL_OK.has(conclusion);
    if (!failed && !ok) return;

    const isDeploy = w.kind === "deploy";
    this.store.append({
      kind: failed ? "ci_run_failed" : isDeploy ? "deploy_finished" : "ci_run_succeeded",
      repo: w.repo,
      summary: failed
        ? `CI/CD FAILED on ${w.repo}: ${run.name} (${run.status}) — investigate before continuing this line of work`
        : isDeploy
          ? `Deploy finished on ${w.repo}: ${run.name} succeeded — production Playwright testing can start`
          : `CI green on ${w.repo}: ${run.name} succeeded`,
      detail: {
        watchId: w.id,
        runId: run.id,
        runName: run.name,
        status: run.status,
        conclusion: run.conclusion ?? null,
        url: run.html_url ?? null,
      },
    });
    this.store.removeWatch(w.id);
  }
}
