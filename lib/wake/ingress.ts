// Ingress (WAKE.md § Behaviour, ingress): verify, dedupe, parse, queue, mark seen, then 202.
import type { Bindings } from "./types.ts";
import type { Verifier } from "./verify.ts";
import { isoAt, writeRow } from "./log.ts";

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function ingress(req: Request, b: Bindings, o: {
  verify: Verifier; kind: string; dedupeTtlS?: number; parse?: (raw: string) => unknown; nowMs?: number;
}): Promise<Response> {
  const now = o.nowMs ?? Date.now();
  const raw = await req.text();
  const v = await o.verify(req, raw, now);
  if (!v.ok) {
    await writeRow(b.kv, { event: "refused", kind: o.kind, id: "-", attempt: 0, about: v.reason }, now);
    return text(401, v.reason);
  }
  const seenKey = `seen:${o.kind}:${v.id}`;
  if (await b.kv.get(seenKey)) {
    await writeRow(b.kv, { event: "duplicate", kind: o.kind, id: v.id, attempt: 0 }, now);
    return text(200, "duplicate");
  }
  let body: unknown;
  try { body = (o.parse ?? JSON.parse)(raw); }
  catch (e) { return text(400, o.parse ? String((e as Error).message ?? e) : "body is not JSON"); }
  try {
    await b.queue.send({ kind: o.kind, id: v.id, body, at: isoAt(now) });
  } catch {
    return text(503, "could not queue the job, send again");
  }
  await b.kv.put(seenKey, isoAt(now), { expirationTtl: o.dedupeTtlS ?? 86400 });
  await writeRow(b.kv, { event: "received", kind: o.kind, id: v.id, attempt: 0 }, now);
  return text(202, "accepted");
}
