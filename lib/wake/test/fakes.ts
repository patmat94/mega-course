// In-memory stand-ins for Cloudflare KV and a Queue producer (WAKE.md § Tests: nothing calls Cloudflare).
import type { KVLike, QueueLike } from "../types.ts";

export function fakeKV(): KVLike & { data: Map<string, { value: string; ttl?: number }> } {
  const data = new Map<string, { value: string; ttl?: number }>();
  return {
    data,
    async get(key) { return data.get(key)?.value ?? null; },
    async put(key, value, opts) { data.set(key, { value, ttl: opts?.expirationTtl }); },
    async list(opts) {
      const all = [...data.keys()].filter((k) => k.startsWith(opts?.prefix ?? "")).sort();
      const start = opts?.cursor ? Number(opts.cursor) : 0;
      const limit = opts?.limit ?? 1000;
      const page = all.slice(start, start + limit);
      const done = start + limit >= all.length;
      return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(start + limit) };
    },
  };
}

export function fakeQueue<T>(opts: { failSends?: number } = {}): QueueLike<T> & { sent: T[] } {
  const sent: T[] = [];
  let fails = opts.failSends ?? 0;
  return {
    sent,
    async send(body) {
      if (fails > 0) { fails--; throw new Error("queue unavailable"); }
      sent.push(body);
    },
  };
}
