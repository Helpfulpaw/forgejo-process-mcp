import { createServer } from "node:http";
import type { EventStore } from "./events.js";

/**
 * Optional Forgejo webhook receiver. Configure a repo webhook pointing at
 * http://<host>:<port>/webhook — events are queued for the agent alongside
 * poller events. Pointing a dockerized Forgejo at the host: use
 * http://host.docker.internal:<port>/webhook
 */
export function startWebhook(port: number, store: EventStore): void {
  if (!port) return;
  const srv = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/webhook") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const event = req.headers["x-forgejo-event"] ?? req.headers["x-gitea-event"] ?? "unknown";
      let repo = "unknown";
      try {
        const parsed = JSON.parse(body);
        repo = parsed?.repository?.full_name ?? "unknown";
      } catch {
        /* keep unknown */
      }
      store.append({
        kind: "webhook",
        repo,
        summary: `Forgejo webhook: ${String(event)} on ${repo}`,
        detail: { event: String(event), bytes: body.length },
      });
      res.writeHead(202).end("accepted");
    });
  });
  srv.listen(port, () => console.error(`[webhook] listening on :${port}/webhook`));
}
