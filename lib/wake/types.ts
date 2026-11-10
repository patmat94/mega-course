// Shared types (WAKE.md § Exports). KV and Queue are the minimal shapes the module uses;
// Cloudflare's KVNamespace and Queue satisfy them, and the test fakes do too.

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  list(opts?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    keys: { name: string }[]; list_complete: boolean; cursor?: string;
  }>;
}
export interface QueueLike<T> { send(body: T): Promise<void> }

export type Push = { url: string; headers?: Record<string, string>; body: string; about?: string };
export type Job =
  | { kind: string; id: string; body: unknown; at: string }
  | { kind: "push"; id: string; push: Push; at: string };
export type Bindings = { kv: KVLike; queue: QueueLike<Job> };

export interface MessageLike<T> {
  body: T; attempts: number; ack(): void; retry(o?: { delaySeconds?: number }): void;
}
export interface BatchLike<T> { messages: readonly MessageLike<T>[] }

export type Tools = { push(p: Push): Promise<void>; log(row: Omit<Row, "at">): Promise<void> };
export type Handler = (job: Job, t: Tools) => Promise<void>;

export type Event = "received" | "duplicate" | "refused" | "handled" | "handler_failed" | "job_failed"
  | "push_attempt" | "notified" | "push_failed";
export type Row = {
  at: string; event: Event; kind: string; id: string; attempt: number; status?: number; about?: string;
};
