import { Env, bytesToBase64, newId, randomToken, safeEqual, sha256 } from "./util";
import type { TokenInfo } from "./oauth";
import contracts from "./contracts.json";

export class ToolError extends Error {}

const MAX_UPLOAD = 25 * 1024 * 1024;
const PUT_TTL = 900;
const CHUNK = 1024 * 1024;
const MAX_AUDIO = 25 * 1024 * 1024;
const WHISPER = "@cf/openai/whisper-large-v3-turbo";

// Tool definitions. Name, description and schemas come from tools/<name>.tool.md (hands TOOL.md) through
// src/contracts.json: change the TOOL.md, run npm run contracts, then the code.
const EXTRA: Record<string, { title: string; annotations: Record<string, boolean> }> = {
  memo_write: { title: "Save a note", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  memo_search: { title: "Find notes", annotations: { readOnlyHint: true, openWorldHint: false } },
  upload: { title: "Upload a file", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  transcribe: { title: "Transcribe audio", annotations: { readOnlyHint: true, openWorldHint: true } },
};
export const TOOLS = contracts.map((c) => ({ name: c.name, title: EXTRA[c.name].title, description: c.description,
  inputSchema: c.inputSchema, outputSchema: c.outputSchema, annotations: EXTRA[c.name].annotations }));

type Args = Record<string, unknown>;

function str(args: Args, key: string, opts: { required?: boolean; max?: number; min?: number } = {}): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) {
    if (opts.required) throw new ToolError(`${key}: required. Send ${key} as a string.`);
    return undefined;
  }
  if (typeof v !== "string") throw new ToolError(`${key}: must be a string, not ${Array.isArray(v) ? "an array" : typeof v}. Send ${key} as text.`);
  if (opts.min !== undefined && v.length < opts.min) throw new ToolError(`${key}: shorter than ${opts.min} character${opts.min === 1 ? "" : "s"}. Send at least ${opts.min}.`);
  if (opts.max !== undefined && v.length > opts.max) throw new ToolError(`${key}: longer than ${opts.max} characters. Send at most ${opts.max}.`);
  return v;
}

function onlyKeys(args: Args, keys: string[], tool: string, then = "") {
  const extra = Object.keys(args).filter((k) => !keys.includes(k));
  if (extra.length) throw new ToolError(`${extra[0]}: not an argument of ${tool}. Send only: ${keys.join(", ")}${then}.`);
}

// ---------- memo ----------

async function memoWrite(args: Args, env: Env, who: TokenInfo) {
  onlyKeys(args, ["text"], "memo_write");
  const text = str(args, "text", { required: true, min: 1, max: 20000 })!;
  const id = newId("memo");
  const created_at = new Date().toISOString();
  await env.DB.prepare("INSERT INTO memos (id, text, created_at, client_id, client_name) VALUES (?, ?, ?, ?, ?)")
    .bind(id, text, created_at, who.client_id, who.client_name).run();
  return { id, created_at };
}

interface Note { id: string; text: string; created_at: string; source: string; truncated?: true }

/**
 * Keeps the newest notes that fit the whole-result budget. When notes are left out, `omitted` counts them
 * and `hint` says how to reach them; a single note too long on its own is clipped and marked `truncated`.
 */
function fitNotes(rows: Note[], fits: Fits): Record<string, unknown> {
  const build = (notes: Note[]) => {
    const omitted = rows.length - notes.length;
    const clipped = notes.some((n) => n.truncated);
    if (!omitted && !clipped) return { notes };
    const hint = clipped && omitted
      ? `Text clipped and ${omitted} older note(s) left out to fit 1 kB; add query words from the part you need.`
      : clipped
        ? "Text clipped to fit 1 kB; search words from the part you need."
        : `${omitted} older note(s) left out to fit 1 kB; add query words to see them.`;
    return omitted ? { notes, omitted, hint } : { notes, hint };
  };
  const notes: Note[] = [];
  for (const row of rows) {
    if (fits(build([...notes, row]))) { notes.push(row); continue; }
    if (notes.length === 0) {
      // Longest prefix of the newest note that still fits (binary search on characters).
      let lo = 0, hi = row.text.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(build([{ ...row, text: row.text.slice(0, mid), truncated: true }]))) lo = mid; else hi = mid - 1;
      }
      notes.push({ ...row, text: row.text.slice(0, lo), truncated: true });
    }
    break;
  }
  return build(notes);
}

async function memoSearch(args: Args, env: Env, fits: Fits) {
  onlyKeys(args, ["query", "limit"], "memo_search");
  if (args.query === undefined || args.query === null) throw new ToolError(`query: required. Send query as a string; send "" for the newest notes.`);
  const query = str(args, "query", { required: true, max: 500 })!;
  let limit = 20;
  if (args.limit !== undefined) {
    if (typeof args.limit !== "number" || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) {
      throw new ToolError("limit: must be a whole number from 1 to 100. Send a number in that range, or leave limit out.");
    }
    limit = args.limit;
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10);
  const where = words.map(() => "instr(lower(text), ?) > 0").join(" AND ");
  const sql = `SELECT id, text, created_at, client_name AS source FROM memos ${where ? `WHERE ${where}` : ""} ORDER BY n DESC LIMIT ?`;
  const { results } = await env.DB.prepare(sql).bind(...words, limit)
    .all<Note>();
  return fitNotes(results.map((r) => ({ id: r.id, text: r.text, created_at: r.created_at, source: r.source })), fits);
}

// ---------- upload ----------

const TYPES: Record<string, string> = {
  txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", csv: "text/csv; charset=utf-8",
  json: "application/json", html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", xml: "application/xml",
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", webm: "audio/webm",
  mp4: "video/mp4", zip: "application/zip",
};

function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(0, 100);
  return clean || "file";
}

function chunkStatements(env: Env, id: string, bytes: Uint8Array) {
  const chunks = Math.max(1, Math.ceil(bytes.length / CHUNK));
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < chunks; i++) {
    stmts.push(env.DB.prepare("INSERT INTO file_chunks (file_id, idx, data) VALUES (?, ?, ?)")
      .bind(id, i, bytes.slice(i * CHUNK, (i + 1) * CHUNK)));
  }
  return { chunks, stmts };
}

async function upload(args: Args, env: Env, who: TokenInfo, origin: string) {
  onlyKeys(args, ["filename", "content_type"], "upload", "; then PUT the bytes to upload_url");
  const raw = str(args, "filename", { max: 200 });
  if (raw === undefined || raw.length < 1) throw new ToolError("filename: " + (raw === undefined ? "required" : "shorter than 1 character") + ". Send a name such as notes.txt.");
  const filename = safeName(raw);
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const asked = (str(args, "content_type", { max: 200 }) ?? "").trim();
  const type = asked || TYPES[ext] || "application/octet-stream";
  if (!/^[\w.+-]+\/[\w.+-]+(\s*;\s*[\w.+-]+=[\w.+"-]+)*$/.test(type)) {
    throw new ToolError(`content_type: "${type}" is not a MIME type. Send one such as text/plain, or leave content_type out.`);
  }
  const id = newId("file");
  const token = randomToken(24);
  const exp = Math.floor(Date.now() / 1000) + PUT_TTL;
  await env.DB.prepare("INSERT INTO files (id, name, type, size, chunks, created_at, client_id, put_token, put_exp) VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?)")
    .bind(id, filename, type, new Date().toISOString(), who.client_id, await sha256(token), exp).run();
  return { url: `${origin}/files/${id}/${encodeURIComponent(filename)}`, upload_url: `${origin}/put/${id}/${token}`, expires_at: new Date(exp * 1000).toISOString() };
}

/** Stores bytes the server made itself (a long transcript) as a public file, and returns its link. */
async function storeFile(env: Env, who: TokenInfo, origin: string, filename: string, type: string, bytes: Uint8Array): Promise<string> {
  const id = newId("file");
  const { chunks, stmts } = chunkStatements(env, id, bytes);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO files (id, name, type, size, chunks, created_at, client_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, filename, type, bytes.length, chunks, new Date().toISOString(), who.client_id),
    ...stmts,
  ]);
  return `${origin}/files/${id}/${encodeURIComponent(filename)}`;
}

/** PUT /put/<id>/<token>: stores the raw request body for a file created by upload without content. */
export async function receivePut(req: Request, env: Env, id: string, token: string, origin: string): Promise<Response> {
  const reply = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
  const row = await env.DB.prepare("SELECT name, put_token, put_exp FROM files WHERE id = ?").bind(id)
    .first<{ name: string; put_token: string | null; put_exp: number | null }>();
  if (!row || !row.put_token || !(await safeEqual(await sha256(token), row.put_token))) {
    return reply(404, "This upload link is unknown or was already used.");
  }
  if ((row.put_exp ?? 0) < Math.floor(Date.now() / 1000)) return reply(410, "This upload link expired. Call upload again for a new one.");
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_UPLOAD) return reply(413, `The body is ${len} bytes, over the ${MAX_UPLOAD} byte limit.`);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > MAX_UPLOAD) return reply(413, `The body is ${bytes.length} bytes, over the ${MAX_UPLOAD} byte limit.`);
  // Claim the link first, so a second PUT cannot write the same file.
  const claimed = await env.DB.prepare("UPDATE files SET put_token = NULL WHERE id = ? AND put_token IS NOT NULL RETURNING id").bind(id).first();
  if (!claimed) return reply(404, "This upload link was already used.");
  const { chunks, stmts } = chunkStatements(env, id, bytes);
  for (let i = 0; i < stmts.length; i += 5) await env.DB.batch(stmts.slice(i, i + 5));
  await env.DB.prepare("UPDATE files SET size = ?, chunks = ?, put_exp = NULL WHERE id = ?").bind(bytes.length, chunks, id).run();
  return new Response(JSON.stringify({ url: `${origin}/files/${id}/${encodeURIComponent(row.name)}`, size: bytes.length }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

export async function readFile(env: Env, id: string): Promise<{ name: string; type: string; bytes: Uint8Array } | null> {
  const meta = await env.DB.prepare("SELECT name, type, size, chunks FROM files WHERE id = ? AND put_token IS NULL AND put_exp IS NULL").bind(id)
    .first<{ name: string; type: string; size: number; chunks: number }>();
  if (!meta) return null;
  const { results } = await env.DB.prepare("SELECT data FROM file_chunks WHERE file_id = ? ORDER BY idx").bind(id).all<{ data: ArrayBuffer | number[] }>();
  const out = new Uint8Array(meta.size);
  let off = 0;
  for (const r of results) {
    const part = r.data instanceof ArrayBuffer ? new Uint8Array(r.data) : new Uint8Array(r.data as number[]);
    out.set(part, off);
    off += part.length;
  }
  return { name: meta.name, type: meta.type, bytes: out };
}

// ---------- transcribe ----------

const AUDIO_HINT = "Send a direct link to an audio file (mp3, wav, m4a, ogg, flac or webm) that opens without sign-in.";
const MB = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const MAX_REDIRECTS = 5;

/** True when the bytes start like an HTML, XML or JSON document rather than audio. */
function looksLikeText(b: Uint8Array): boolean {
  const head = new TextDecoder().decode(b.subarray(0, 256)).replace(/^﻿/, "").trimStart().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<?xml") || head.startsWith("{") || head.startsWith("[");
}

/**
 * True for a host on this machine or a private network (hands rule 9): localhost names, loopback, private,
 * link-local, carrier-grade NAT and unique-local ranges, and IPv4 written as one number. A name that resolves
 * to such an address is also out of reach: a Worker cannot open connections into a private network.
 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/.test(h)) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const p = Number(v4[1]), q = Number(v4[2]);
    return p === 0 || p === 10 || p === 127 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) ||
      (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127) || p >= 224;
  }
  if (h.includes(":")) {
    if (h === "::" || h === "::1") return true;
    if (/^(fc|fd)/.test(h) || /^fe[89ab]/.test(h)) return true;
    const mapped = h.match(/^::ffff:(.+)$/);
    if (mapped) return mapped[1].includes(".") ? isPrivateHost(mapped[1]) : true;
  }
  return false;
}

/** Checks one link before it is fetched: http or https, a public host. Returns the URL, or throws for the model. */
function publicUrl(raw: string, origin: string, shown = raw): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ToolError(`url: ${shown} is not an http or https link. ${AUDIO_HINT}`); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ToolError(`url: ${shown} is not an http or https link. ${AUDIO_HINT}`);
  if (url.origin !== origin && isPrivateHost(url.hostname)) {
    throw new ToolError(`url: ${shown} points to a private or local address. Send a public link to an audio file (mp3, wav, m4a, ogg, flac or webm) that opens without sign-in.`);
  }
  return url;
}

async function loadAudio(first: URL, env: Env, origin: string): Promise<Uint8Array> {
  const u = first.toString();
  if (first.origin === origin) {
    const m = first.pathname.match(/^\/files\/([^/]+)/);
    const f = m ? await readFile(env, m[1]) : null;
    if (!f) throw new ToolError(`url: ${u} was not found: this server has no file at that link. Send a link that opens, or upload the file first.`);
    if (f.bytes.length > MAX_AUDIO) throw new ToolError(`url: ${u} is ${MB(f.bytes.length)}, over the ${MB(MAX_AUDIO)} limit. Send a shorter recording, at most ${MB(MAX_AUDIO)}.`);
    return f.bytes;
  }
  // Redirects are followed by hand, so each hop is checked like the first link (hands rule 9).
  let url = first;
  let res: Response | undefined;
  for (let hop = 0; ; hop++) {
    try {
      res = await fetch(url.toString(), { redirect: "manual", signal: AbortSignal.timeout(30000), headers: { "user-agent": "tool-home/1.0", accept: "audio/*, */*;q=0.5" } });
    } catch (e) {
      if ((e as Error).name === "TimeoutError") throw new ToolError(`url: ${u} did not answer within 30 seconds. Send the same call again later, or a link on a faster host.`);
      throw new ToolError(`url: ${u} could not be downloaded (${(e as Error).message}). ${AUDIO_HINT}`);
    }
    if (res.status < 300 || res.status >= 400) break;
    const next = res.headers.get("location");
    await res.body?.cancel();
    if (!next) throw new ToolError(`url: ${u} answered HTTP ${res.status} with no address to go on to. ${AUDIO_HINT}`);
    if (hop >= MAX_REDIRECTS) throw new ToolError(`url: ${u} redirects more than ${MAX_REDIRECTS} times. Send the final link of the audio file.`);
    const target = new URL(next, url);
    url = publicUrl(target.toString(), origin, `${u} (redirected to ${target.host})`);
    if (url.origin === origin) return loadAudio(url, env, origin);
  }
  if (res.status === 404 || res.status === 410) {
    throw new ToolError(`url: ${u} was not found: the server answered HTTP ${res.status}. Send a link that opens, or check that the file still exists.`);
  }
  if (res.status === 401 || res.status === 403) throw new ToolError(`url: ${u} is not public: the server answered HTTP ${res.status}. ${AUDIO_HINT}`);
  if (!res.ok) throw new ToolError(`url: ${u} could not be downloaded: the server answered HTTP ${res.status}. ${AUDIO_HINT}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type.startsWith("text/") || type.includes("html") || type.includes("json") || type === "application/xml") {
    await res.body?.cancel();
    throw new ToolError(`url: ${u} is not audio: it returned ${type}${type.includes("html") ? " (a web page)" : ""}. ${AUDIO_HINT}`);
  }
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_AUDIO) {
    await res.body?.cancel();
    throw new ToolError(`url: ${u} is ${MB(len)}, over the ${MB(MAX_AUDIO)} limit. Send a shorter recording, at most ${MB(MAX_AUDIO)}.`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_AUDIO) throw new ToolError(`url: ${u} is ${MB(buf.length)}, over the ${MB(MAX_AUDIO)} limit. Send a shorter recording, at most ${MB(MAX_AUDIO)}.`);
  if (buf.length === 0) throw new ToolError(`url: ${u} is empty: it returned 0 bytes. ${AUDIO_HINT}`);
  if (looksLikeText(buf)) throw new ToolError(`url: ${u} is not audio: it returned a text document${type ? ` (${type})` : ""}. ${AUDIO_HINT}`);
  return buf;
}

const round = (n: number) => Math.round(n * 100) / 100;

export interface Segment { start: number; text: string }

async function transcribe(args: Args, env: Env, who: TokenInfo, origin: string, fits: Fits): Promise<Record<string, unknown>> {
  onlyKeys(args, ["url"], "transcribe");
  const raw = str(args, "url", { required: true, max: 2000 })!;
  const url = publicUrl(raw.trim(), origin);
  const audio = await loadAudio(url, env, origin);

  type Seg = { start?: number; text?: string };
  type Out = { text?: string; segments?: Seg[] };
  let out: Out;
  try {
    out = await (env.AI as unknown as { run(m: string, i: unknown): Promise<Out> }).run(WHISPER, { audio: bytesToBase64(audio) });
  } catch (e) {
    const msg = (e as Error).message;
    if (/decode|format/i.test(msg)) {
      throw new ToolError(`url: ${url} could not be decoded as audio (${MB(audio.length)} downloaded). ${AUDIO_HINT}`);
    }
    throw new ToolError(`No field is wrong: the speech model failed (${msg.slice(0, 120)}). Send the same call again in 1 minute.`);
  }
  let segments: Segment[] = (out.segments ?? [])
    .filter((s) => typeof s.text === "string" && s.text.trim())
    .map((s) => ({ start: round(Math.max(0, Number(s.start) || 0)), text: s.text!.trim() }));
  const whole = (out.text ?? "").trim();
  if (segments.length === 0 && whole) segments = [{ start: 0, text: whole }];
  if (fits({ segments })) return { segments };

  // Over the budget (hands rule 4): the whole transcript goes to a file on this server; the result keeps the
  // first segments that fit, the link and the size.
  const file = new TextEncoder().encode(segments.map((s) => `[${s.start}] ${s.text}`).join("\n") + "\n");
  const name = (url.pathname.split("/").pop() || "audio").replace(/\.[^.]*$/, "") + ".transcript.txt";
  const transcript_url = await storeFile(env, who, origin, safeName(name), "text/plain; charset=utf-8", file);
  const build = (n: number) => ({ segments: segments.slice(0, n), omitted: segments.length - n, transcript_url, transcript_bytes: file.length });
  let n = 0;
  while (n < segments.length - 1 && fits(build(n + 1))) n++;
  return build(n);
}

/** The text item: the same JSON as structuredContent, compact, once (hands rule 2). */
export function summaryText(_name: string, out: Record<string, unknown>): string {
  return JSON.stringify(out);
}

// ---------- dispatch ----------

/** True when this tool output, sent as a whole tools/call result, stays within the result budget. */
export type Fits = (out: Record<string, unknown>) => boolean;

export async function callTool(name: string, args: Args, env: Env, who: TokenInfo, origin: string, fits: Fits): Promise<Record<string, unknown>> {
  switch (name) {
    case "memo_write": return memoWrite(args, env, who);
    case "memo_search": return memoSearch(args, env, fits);
    case "upload": return upload(args, env, who, origin);
    case "transcribe": return transcribe(args, env, who, origin, fits);
    default: throw new Error("unknown tool");
  }
}
