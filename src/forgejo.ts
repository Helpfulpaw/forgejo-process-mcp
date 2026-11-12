import type { Config } from "./config.js";

export interface WorkflowRun {
  id: number;
  name: string;
  status: string; // running | success | failure | cancelled | ...
  conclusion?: string | null;
  head_sha?: string;
  head_branch?: string;
  html_url?: string;
}

export class ForgejoClient {
  constructor(private readonly cfg: Config) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.cfg.forgejoUrl}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `token ${this.cfg.forgejoToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Forgejo ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    }
    const ct = res.headers.get("content-type") ?? "";
    return (ct.includes("json") ? await res.json() : (await res.text())) as T;
  }

  createRepo(name: string, description = "", isPrivate = false) {
    return this.req("POST", "/user/repos", { name, description, private: isPrivate, auto_init: false });
  }

  listRepos(limit = 30) {
    return this.req("GET", `/user/repos?limit=${limit}`);
  }

  async listRuns(repo: string, limit = 10): Promise<WorkflowRun[]> {
    const d = (await this.req("GET", `/repos/${repo}/actions/tasks?limit=${limit}`)) as {
      workflow_runs?: WorkflowRun[];
    };
    return d.workflow_runs ?? [];
  }

  async latestRunForBranch(repo: string, branch: string): Promise<WorkflowRun | null> {
    const runs = await this.listRuns(repo, 20);
    return runs.find((r) => r.head_branch === branch) ?? runs[0] ?? null;
  }

  openPr(repo: string, head: string, base: string, title: string, body = "") {
    return this.req("POST", `/repos/${repo}/pulls`, { head, base, title, body });
  }

  getPr(repo: string, index: number) {
    return this.req("GET", `/repos/${repo}/pulls/${index}`);
  }

  mergePr(repo: string, index: number, style: "merge" | "rebase" | "squash" = "merge") {
    return this.req("POST", `/repos/${repo}/pulls/${index}/merge`, { Do: style });
  }
}
