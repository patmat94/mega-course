import { Env, base64ToBytes, bytesToBase64, newId, randomToken, safeEqual, sha256 } from "./util";
import type { TokenInfo } from "./oauth";

export class ToolError extends Error {}

const MAX_UPLOAD = 25 * 1024 * 1024;
const PUT_TTL = 900;
const CHUNK = 1024 * 1024;
const MAX_AUDIO = 25 * 1024 * 1024;
const WHISPER = "@cf/openai/whisper-large-v3-turbo";

// Tool definitions, in a fixed order.
export const TOOLS = [
  {
    name: "memo_write",
    title: "Save a note",
    description: "Saves a text note on this server and returns its id. Notes can be found again with memo_search.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", minLength: 1, maxLength: 20000, description: "The note text." } },
      required: ["text"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id of the saved note." },
        created_at: { type: "string", format: "date-time" },
      },
      required: ["id", "created_at"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "memo_search",
    title: "Find notes",
    description: "Finds saved notes whose text contains every word of the query (case-insensitive), newest first. An empty query returns the newest notes.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 500, description: "Words to look for. Empty matches every note." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "Most notes to return." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        notes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              text: { type: "string" },
              created_at: { type: "string", format: "date-time" },
              source: { type: "string", description: "Name of the client that saved the note." },
            },
            required: ["id", "text", "created_at", "source"],
            additionalProperties: false,
          },
        },
      },
      required: ["notes"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "upload",
    title: "Upload a file",
    description: "Stores a file on this server and returns a public link to it that anyone can open without signing in. Small files (up to 1 MB): send content as text (encoding utf8) or base64 (encoding base64). Large files (up to 25 MB), or bytes you have on disk: leave content out; the result then also has upload_url, and you send the raw bytes with one HTTP PUT to it (no auth header, valid 15 minutes, once). The link in url works as soon as the PUT returns 200.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", minLength: 1, maxLength: 200, description: "File name, e.g. notes.txt or clip.mp3." },
        content: { type: "string", maxLength: 1400000, description: "File content: plain text, or base64 when encoding is base64. Leave out to get an upload_url instead." },
        encoding: { type: "string", enum: ["utf8", "base64"], default: "utf8", description: "How content is encoded." },
        content_type: { type: "string", maxLength: 200, description: "MIME type. Guessed from the file name when left out." },
      },
      required: ["filename"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri", description: "Public link, served by this server." },
        id: { type: "string" },
        filename: { type: "string" },
        size: { type: "integer", description: "Size in bytes (when content was sent)." },
        content_type: { type: "string" },
        upload_url: { type: "string", format: "uri", description: "Only when content was left out: PUT the raw bytes here." },
        expires_at: { type: "string", format: "date-time", description: "Only with upload_url: when it stops working." },
      },
      required: ["url", "id", "filename", "content_type"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "transcribe",
    title: "Transcribe audio",
    description: "Downloads audio from a public http(s) URL (up to 25 MB; mp3, wav, m4a, ogg, flac, webm) and turns speech into timestamped text with Whisper. start and end are seconds from the beginning of the audio.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", format: "uri", description: "Public link to the audio file." } },
      required: ["url"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        segments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              start: { type: "number", minimum: 0, description: "Start time in seconds." },
              end: { type: "number", minimum: 0, description: "End time in seconds." },
              text: { type: "string" },
            },
            required: ["start", "end", "text"],
            additionalProperties: false,
          },
        },
        language: { type: "string" },
        duration: { type: "number", description: "Audio length in seconds." },
      },
      required: ["segments"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
] as const;

type Args = Record<string, unknown>;

function str(args: Args, key: string, opts: { required?: boolean; max?: number; min?: number } = {}): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) {
    if (opts.required) throw new ToolError(`${key} is required`);
    return undefined;
  }
  if (typeof v !== "string") throw new ToolError(`${key} must be a string`);
  if (opts.min !== undefined && v.length < opts.min) throw new ToolError(`${key} must have at least ${opts.min} character(s)`);
  if (opts.max !== undefined && v.length > opts.max) throw new ToolError(`${key} must have at most ${opts.max} characters`);
  return v;
}

function onlyKeys(args: Args, keys: string[]) {
  const extra = Object.keys(args).filter((k) => !keys.includes(k));
  if (extra.length) throw new ToolError(`unknown argument(s): ${extra.join(", ")}`);
}

// ---------- memo ----------

async function memoWrite(args: Args, env: Env, who: TokenInfo) {
  onlyKeys(args, ["text"]);
  const text = str(args, "text", { required: true, min: 1, max: 20000 })!;
  const id = newId("memo");
  const created_at = new Date().toISOString();
  await env.DB.prepare("INSERT INTO memos (id, text, created_at, client_id, client_name) VALUES (?, ?, ?, ?, ?)")
    .bind(id, text, created_at, who.client_id, who.client_name).run();
  return { id, created_at };
}

async function memoSearch(args: Args, env: Env) {
  onlyKeys(args, ["query", "limit"]);
  const query = str(args, "query", { required: true, max: 500 })!;
  let limit = 20;
  if (args.limit !== undefined) {
    if (typeof args.limit !== "number" || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) {
      throw new ToolError("limit must be an integer from 1 to 100");
    }
    limit = args.limit;
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10);
  const where = words.map(() => "instr(lower(text), ?) > 0").join(" AND ");
  const sql = `SELECT id, text, created_at, client_name AS source FROM memos ${where ? `WHERE ${where}` : ""} ORDER BY n DESC LIMIT ?`;
  const { results } = await env.DB.prepare(sql).bind(...words, limit)
    .all<{ id: string; text: string; created_at: string; source: string }>();
  return { notes: results.map((r) => ({ id: r.id, text: r.text, created_at: r.created_at, source: r.source })) };
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
  onlyKeys(args, ["filename", "content", "encoding", "content_type"]);
  const filename = safeName(str(args, "filename", { required: true, min: 1, max: 200 })!);
  const content = str(args, "content");
  const encoding = str(args, "encoding") ?? "utf8";
  if (encoding !== "utf8" && encoding !== "base64") throw new ToolError(`encoding "${encoding}" is not supported: use utf8 or base64`);
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const type = (str(args, "content_type", { max: 200 }) ?? "").trim() || TYPES[ext] || "application/octet-stream";
  if (!/^[\w.+-]+\/[\w.+-]+(\s*;\s*[\w.+-]+=[\w.+"-]+)*$/.test(type)) throw new ToolError(`content_type "${type}" is not a valid MIME type`);
  const id = newId("file");
  const url = `${origin}/files/${id}/${encodeURIComponent(filename)}`;
  const created = new Date().toISOString();

  if (content === undefined) {
    const token = randomToken(24);
    const exp = Math.floor(Date.now() / 1000) + PUT_TTL;
    await env.DB.prepare("INSERT INTO files (id, name, type, size, chunks, created_at, client_id, put_token, put_exp) VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?)")
      .bind(id, filename, type, created, who.client_id, await sha256(token), exp).run();
    return { url, id, filename, content_type: type, upload_url: `${origin}/put/${id}/${token}`, expires_at: new Date(exp * 1000).toISOString() };
  }

  let bytes: Uint8Array;
  if (encoding === "base64") {
    try { bytes = base64ToBytes(content); } catch { throw new ToolError("content is not valid base64; send encoding utf8 for text"); }
  } else {
    bytes = new TextEncoder().encode(content);
  }
  if (bytes.length > MAX_UPLOAD) throw new ToolError(`the file is ${bytes.length} bytes, over the ${MAX_UPLOAD} byte limit`);
  const { chunks, stmts } = chunkStatements(env, id, bytes);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO files (id, name, type, size, chunks, created_at, client_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, filename, type, bytes.length, chunks, created, who.client_id),
    ...stmts,
  ]);
  return { url, id, filename, size: bytes.length, content_type: type };
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

const AUDIO_HINT = "Give a direct link to an audio file (mp3, wav, m4a, ogg, flac or webm) that opens without sign-in.";
const MB = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** True when the bytes start like an HTML, XML or JSON document rather than audio. */
function looksLikeText(b: Uint8Array): boolean {
  const head = new TextDecoder().decode(b.subarray(0, 256)).replace(/^﻿/, "").trimStart().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<?xml") || head.startsWith("{") || head.startsWith("[");
}

async function loadAudio(url: URL, env: Env, origin: string): Promise<Uint8Array> {
  const u = url.toString();
  if (url.origin === origin) {
    const m = url.pathname.match(/^\/files\/([^/]+)/);
    const f = m ? await readFile(env, m[1]) : null;
    if (!f) throw new ToolError(`${u} was not found: this server has no file at that link. ${AUDIO_HINT}`);
    if (f.bytes.length > MAX_AUDIO) throw new ToolError(`${u} is ${MB(f.bytes.length)}, over the ${MB(MAX_AUDIO)} limit.`);
    return f.bytes;
  }
  let res: Response;
  try {
    res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(30000), headers: { "user-agent": "tool-home/1.0", accept: "audio/*, */*;q=0.5" } });
  } catch (e) {
    const why = (e as Error).name === "TimeoutError" ? "it did not answer within 30 seconds" : `the request failed (${(e as Error).message})`;
    throw new ToolError(`Could not download ${u}: ${why}. ${AUDIO_HINT}`);
  }
  if (res.status === 404 || res.status === 410) {
    throw new ToolError(`${u} was not found: the server answered HTTP ${res.status}. Check that the link is right and the file still exists.`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ToolError(`${u} is not public: the server answered HTTP ${res.status}. ${AUDIO_HINT}`);
  }
  if (!res.ok) throw new ToolError(`Could not download ${u}: the server answered HTTP ${res.status}. ${AUDIO_HINT}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type.startsWith("text/") || type.includes("html") || type.includes("json") || type === "application/xml") {
    await res.body?.cancel();
    throw new ToolError(`${u} is not audio: it returned ${type}${type.includes("html") ? " (a web page)" : ""}. ${AUDIO_HINT}`);
  }
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_AUDIO) {
    await res.body?.cancel();
    throw new ToolError(`${u} is ${MB(len)}, over the ${MB(MAX_AUDIO)} limit.`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_AUDIO) throw new ToolError(`${u} is ${MB(buf.length)}, over the ${MB(MAX_AUDIO)} limit.`);
  if (buf.length === 0) throw new ToolError(`${u} is empty: it returned 0 bytes. ${AUDIO_HINT}`);
  if (looksLikeText(buf)) throw new ToolError(`${u} is not audio: it returned a text document${type ? ` (${type})` : ""}. ${AUDIO_HINT}`);
  return buf;
}

const round = (n: number) => Math.round(n * 100) / 100;

export interface Transcript {
  segments: { start: number; end: number; text: string }[];
  language?: string;
  duration?: number;
}

async function transcribe(args: Args, env: Env, origin: string): Promise<Transcript> {
  onlyKeys(args, ["url"]);
  const raw = str(args, "url", { required: true, max: 2000 })!;
  let url: URL;
  try { url = new URL(raw); } catch { throw new ToolError(`${raw} is not a valid URL. ${AUDIO_HINT}`); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ToolError(`${raw} is not an http or https link. ${AUDIO_HINT}`);
  const audio = await loadAudio(url, env, origin);

  type Seg = { start?: number; end?: number; text?: string };
  type Out = { text?: string; segments?: Seg[]; transcription_info?: { language?: string; duration?: number } };
  let out: Out;
  try {
    out = (await (env.AI as unknown as { run(m: string, i: unknown): Promise<Out> }).run(WHISPER, { audio: bytesToBase64(audio) }));
  } catch (e) {
    const msg = (e as Error).message;
    if (/decode|format/i.test(msg)) {
      throw new ToolError(`${url} could not be decoded as audio: the file is not in a format Whisper reads (${MB(audio.length)} downloaded). ${AUDIO_HINT}`);
    }
    throw new ToolError(`Transcribing ${url} failed on the speech model: ${msg}. Try again in a minute.`);
  }
  let segments = (out.segments ?? [])
    .filter((s) => typeof s.text === "string" && s.text.trim())
    .map((s) => ({ start: round(Math.max(0, Number(s.start) || 0)), end: round(Math.max(0, Number(s.end) || 0)), text: s.text!.trim() }));
  const duration = out.transcription_info?.duration;
  const whole = (out.text ?? "").trim();
  if (segments.length === 0 && whole) segments = [{ start: 0, end: round(Number(duration) || 0), text: whole }];
  const result: Transcript = { segments };
  if (typeof out.transcription_info?.language === "string") result.language = out.transcription_info.language;
  if (typeof duration === "number") result.duration = round(duration);
  return result;
}

/** Short text for the content block: the transcript for transcribe, the JSON for the other tools. */
export function summaryText(name: string, out: Record<string, unknown>): string {
  if (name === "transcribe") {
    const segs = (out as unknown as Transcript).segments;
    return segs.length ? segs.map((s) => s.text).join(" ") : "No speech found.";
  }
  return JSON.stringify(out);
}

// ---------- dispatch ----------

export async function callTool(name: string, args: Args, env: Env, who: TokenInfo, origin: string): Promise<Record<string, unknown>> {
  switch (name) {
    case "memo_write": return memoWrite(args, env, who);
    case "memo_search": return memoSearch(args, env);
    case "upload": return upload(args, env, who, origin);
    case "transcribe": return transcribe(args, env, origin) as unknown as Promise<Record<string, unknown>>;
    default: throw new Error("unknown tool");
  }
}
