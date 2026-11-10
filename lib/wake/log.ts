// Log rows in KV (WAKE.md § Exports, log; § Limits).
import type { KVLike, Row } from "./types.ts";

const TTL_S = 7 * 86400;
const ABOUT_MAX = 200;
let seq = 0; // orders rows written in the same millisecond by this isolate

function logKey(nowMs: number): string {
  seq = (seq + 1) % 36 ** 3;
  const s = seq.toString(36).padStart(3, "0");
  const r = Math.random().toString(36).slice(2, 5).padEnd(3, "0");
  return `log:${String(nowMs).padStart(13, "0")}:${s}${r}`;
}

/** ISO 8601 with an explicit offset ("+00:00"), never "Z". */
export const isoAt = (ms: number) => new Date(ms).toISOString().replace("Z", "+00:00");

export async function writeRow(kv: KVLike, row: Omit<Row, "at">, nowMs = Date.now()): Promise<Row> {
  const full: Row = { at: isoAt(nowMs), ...row, attempt: Number(row.attempt) };
  if (full.about !== undefined) full.about = full.about.slice(0, ABOUT_MAX);
  await kv.put(logKey(nowMs), JSON.stringify(full), { expirationTtl: TTL_S });
  return full;
}

/** Rows oldest first. */
export async function readLog(kv: KVLike, o: { sinceMs?: number; limit?: number } = {}): Promise<Row[]> {
  const limit = o.limit ?? 1000;
  const since = o.sinceMs !== undefined ? `log:${String(o.sinceMs).padStart(13, "0")}` : "";
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: "log:", cursor });
    names.push(...page.keys.map((k) => k.name).filter((n) => n >= since));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const rows = await Promise.all(names.slice(0, limit).map((n) => kv.get(n)));
  return rows.filter((r): r is string => r !== null).map((r) => JSON.parse(r) as Row);
}
