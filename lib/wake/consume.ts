// Queue consumer and push (WAKE.md § Behaviour, consume). A push is its own queue job: each
// attempt writes a row before anything else, "notified" only on a 2xx (ADR 0008).
import type { BatchLike, Bindings, Handler, Job, MessageLike, Push, Tools } from "./types.ts";
import { isoAt, writeRow } from "./log.ts";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export const delayFor = (attempt: number) => Math.min(15 * 2 ** (attempt - 1), 300);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function consume(batch: BatchLike<Job>, b: Bindings, handlers: Record<string, Handler>, o: {
  maxTries?: number; fetch?: Fetch; now?: () => number;
} = {}): Promise<void> {
  const max = o.maxTries ?? 30;
  const now = o.now ?? Date.now;
  const doFetch: Fetch = o.fetch ?? ((url, init) => fetch(url, init));
  const row = (r: Parameters<Tools["log"]>[0]) => writeRow(b.kv, r, now());

  for (const msg of batch.messages) {
    const job = msg.body;
    const n = msg.attempts;
    const again = (m: MessageLike<Job>) => m.retry({ delaySeconds: delayFor(n) });

    if ("push" in job) {
      const p = job.push;
      let status = -1;
      try {
        status = (await doFetch(p.url, { method: "POST", headers: p.headers, body: p.body })).status;
      } catch { /* status stays -1 */ }
      await row({ event: "push_attempt", kind: "push", id: job.id, attempt: n, status, about: p.about });
      if (status >= 200 && status < 300) {
        await row({ event: "notified", kind: "push", id: job.id, attempt: n, status, about: p.about });
        msg.ack();
      } else if (n < max) again(msg);
      else { await row({ event: "push_failed", kind: "push", id: job.id, attempt: n, status, about: p.about }); msg.ack(); }
      continue;
    }

    const handler = handlers[job.kind];
    if (!handler) {
      await row({ event: "job_failed", kind: job.kind, id: job.id, attempt: n, about: `no handler for kind "${job.kind}"` });
      msg.ack();
      continue;
    }
    let pushes = 0;
    const tools: Tools = {
      push: async (p: Push) => {
        await b.queue.send({ kind: "push", id: `${job.id}.push.${++pushes}`, push: p, at: isoAt(now()) });
      },
      log: async (r) => { await row(r); },
    };
    try {
      await handler(job, tools);
      await row({ event: "handled", kind: job.kind, id: job.id, attempt: n });
      msg.ack();
    } catch (e) {
      const last = n >= max;
      await row({ event: last ? "job_failed" : "handler_failed", kind: job.kind, id: job.id, attempt: n, about: errText(e) });
      if (last) msg.ack(); else again(msg);
    }
  }
}
