// wake-demo: one Worker built on lib/wake (plan § 5). A signed course-style call is queued and
// answered 202; its handler pushes to NTFY_URL; admin routes read the log and revoke the token.
import { ingress, consume, courseHmac, readLog } from "../../index.ts";
import type { Job, KVLike, QueueLike, BatchLike } from "../../index.ts";

interface Env {
  KV: KVLike; JOBS: QueueLike<Job>;
  SIGNING_KEY: string; ADMIN_TOKEN: string; NTFY_URL: string;
}

const enc = new TextEncoder();
const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");

/** Bearer token in the Authorization header, never in the URL. Revoked tokens stay refused. */
async function admin(req: Request, env: Env): Promise<string | null> {
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_TOKEN || !got) return "admin token missing";
  const [a, b] = [await sha256(got), await sha256(env.ADMIN_TOKEN)];
  if (a !== b) return "admin token does not match";
  if (await env.KV.get(`revoked:${a}`)) return "admin token was revoked; set a new ADMIN_TOKEN secret";
  return null;
}

const bindings = (env: Env) => ({ kv: env.KV, queue: env.JOBS });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/course") {
      return ingress(req, bindings(env), { verify: courseHmac({ secret: env.SIGNING_KEY }), kind: "course" });
    }
    if (pathname === "/log" || pathname === "/revoke") {
      const no = await admin(req, env);
      if (no) return new Response(no, { status: 401 });
      if (pathname === "/log") return Response.json(await readLog(env.KV));
      if (req.method !== "POST") return new Response("POST /revoke", { status: 405 });
      await env.KV.put(`revoked:${await sha256(env.ADMIN_TOKEN)}`, new Date().toISOString());
      return new Response("revoked: this token no longer opens /log or /revoke");
    }
    if (pathname === "/") return new Response("wake-demo: up\n");
    return new Response("not found\n", { status: 404 });
  },

  async queue(batch: BatchLike<Job>, env: Env): Promise<void> {
    await consume(batch, bindings(env), {
      course: async (job, t) => {
        if (!env.NTFY_URL) throw new Error("NTFY_URL is not set");
        const ask = JSON.stringify("body" in job ? job.body : null).slice(0, 120);
        await t.push({ url: env.NTFY_URL, headers: { Title: "wake-demo" }, body: `course asked: ${ask}`, about: "course ping" });
      },
    });
  },
};
