import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface AgentEvent {
  id: string;
  time: string;
  kind: string; // ci_run_failed | ci_run_succeeded | deploy_finished | watch_expired | webhook
  repo: string;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface Watch {
  id: string;
  repo: string; // owner/name
  runId: number | null;
  headSha?: string;
  branch?: string;
  kind: string; // ci | deploy
  createdAt: string;
  deadlineAt: string;
  lastSig?: string; // commit-status context signature for stability check
}

export class EventStore {
  private readonly eventsPath: string;
  private readonly watchesPath: string;

  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true });
    this.eventsPath = join(stateDir, "events.jsonl");
    this.watchesPath = join(stateDir, "watches.json");
    if (!existsSync(this.watchesPath)) writeFileSync(this.watchesPath, "[]");
  }

  append(evt: Omit<AgentEvent, "id" | "time">): AgentEvent {
    const full: AgentEvent = {
      ...evt,
      id: `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      time: new Date().toISOString(),
    };
    appendFileSync(this.eventsPath, JSON.stringify(full) + "\n");
    return full;
  }

  /** Read all pending events and clear the queue. */
  drain(): AgentEvent[] {
    if (!existsSync(this.eventsPath)) return [];
    const raw = readFileSync(this.eventsPath, "utf8").trim();
    writeFileSync(this.eventsPath, "");
    if (!raw) return [];
    return raw.split("\n").map((l) => JSON.parse(l) as AgentEvent);
  }

  peek(): AgentEvent[] {
    if (!existsSync(this.eventsPath)) return [];
    const raw = readFileSync(this.eventsPath, "utf8").trim();
    if (!raw) return [];
    return raw.split("\n").map((l) => JSON.parse(l) as AgentEvent);
  }

  listWatches(): Watch[] {
    return JSON.parse(readFileSync(this.watchesPath, "utf8")) as Watch[];
  }

  addWatch(w: Watch): void {
    const all = this.listWatches();
    all.push(w);
    writeFileSync(this.watchesPath, JSON.stringify(all, null, 1));
  }

  removeWatch(id: string): void {
    writeFileSync(
      this.watchesPath,
      JSON.stringify(this.listWatches().filter((w) => w.id !== id), null, 1),
    );
  }
}
