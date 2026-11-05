// MCP endpoint. Dual-era:
// - modern 2026-07-28: stateless, per-request _meta, header checks, server/discover;
// - legacy 2025-11-25 (and 2025-06-18, 2025-03-26): initialize handshake, served without sessions.
import { Env, SERVER_INFO, json } from "./util";
import { TOOLS, ToolError, callTool, summaryText } from "./tools";
import type { TokenInfo } from "./oauth";

export const MODERN = "2026-07-28";
export const LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26"];
const SUPPORTED = [MODERN, ...LEGACY];

const INSTRUCTIONS =
  "Tool Home keeps notes (memo_write, memo_search), stores files behind public links (upload) and transcribes audio from a link into timestamped segments (transcribe).";

const PV = "io.modelcontextprotocol/protocolVersion";
const CAPS = "io.modelcontextprotocol/clientCapabilities";
const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";

type Id = string | number;
interface Msg { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Record<string, unknown> }

function rpcError(id: Id | null, code: number, message: string, status: number, data?: unknown): Response {
  const error: Record<string, unknown> = { code, message };
  if (data !== undefined) error.data = data;
  const body: Record<string, unknown> = { jsonrpc: "2.0", error };
  if (id !== null) body.id = id;
  return json(body, status);
}

function decodeHeader(v: string): string {
  const m = v.match(/^=\?base64\?(.*)\?=$/);
  if (!m) return v;
  const bin = atob(m[1]);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Whole-result budget per tools/call, in bytes of the JSON result object. The course counts every byte. */
export const RESULT_BUDGET = 1024;

const resultBytes = (result: unknown) => new TextEncoder().encode(JSON.stringify(result)).length;

/** The modern-era result envelope; tool results carry a short serverInfo. */
function wrapResult(result: Record<string, unknown>, short: boolean) {
  return { resultType: "complete", ...result,
    _meta: { [SERVER_INFO_KEY]: short ? { name: SERVER_INFO.name, version: SERVER_INFO.version } : SERVER_INFO } };
}

function logResultSize(tool: string, result: unknown) {
  const bytes = resultBytes(result);
  const line = { event: "tool_result_size", tool, bytes, budget: RESULT_BUDGET, over: bytes > RESULT_BUDGET };
  if (line.over) console.warn(JSON.stringify(line)); else console.log(JSON.stringify(line));
}

function toolResult(name: string, out: Record<string, unknown>) {
  return { content: [{ type: "text", text: summaryText(name, out) }], structuredContent: out, isError: false };
}

function toolFailure(message: string) {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function runTool(params: Record<string, unknown>, env: Env, who: TokenInfo, origin: string, id: Id, modern: boolean): Promise<Response | Record<string, unknown>> {
  const name = params.name;
  if (typeof name !== "string" || !TOOLS.some((t) => t.name === name)) {
    return rpcError(id, -32602, `Unknown tool: ${String(name)}`, modern ? 400 : 200);
  }
  const args = params.arguments ?? {};
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return toolFailure("arguments must be an object");
  }
  // Measured as the modern-era result (the larger envelope), so the legacy one fits too.
  const fits = (out: Record<string, unknown>) => resultBytes(wrapResult(toolResult(name, out), true)) <= RESULT_BUDGET;
  try {
    return toolResult(name, await callTool(name, args as Record<string, unknown>, env, who, origin, fits));
  } catch (e) {
    if (e instanceof ToolError) return toolFailure(e.message);
    console.error("tool failed", name, e);
    return toolFailure(`${name} failed on the server`);
  }
}

export async function handleMcp(req: Request, env: Env, who: TokenInfo, origin: string): Promise<Response> {
  let msg: Msg;
  try { msg = await req.json(); } catch { return rpcError(null, -32700, "Parse error", 400); }
  if (Array.isArray(msg)) return rpcError(null, -32600, "Batches are not supported", 400);
  if (typeof msg !== "object" || msg === null || msg.jsonrpc !== "2.0") return rpcError(null, -32600, "Invalid Request", 400);
  if (typeof msg.method !== "string") return rpcError(null, -32600, "Only requests and notifications are accepted", 400);

  const isNotification = !("id" in msg);
  if (isNotification) return new Response(null, { status: 202 });
  const id = msg.id as Id;
  if (typeof id !== "string" && typeof id !== "number") return rpcError(null, -32600, "id must be a string or number", 400);

  const method = msg.method;
  const params = (msg.params && typeof msg.params === "object" ? msg.params : {}) as Record<string, unknown>;
  const meta = (params._meta && typeof params._meta === "object" ? params._meta : {}) as Record<string, unknown>;
  const headerVersion = req.headers.get("mcp-protocol-version");

  // ----- legacy era -----
  if (method === "initialize" || meta[PV] === undefined) {
    if (method !== "initialize" && headerVersion === MODERN) {
      return rpcError(id, -32602, `Missing _meta["${PV}"]`, 400);
    }
    if (method !== "initialize" && headerVersion && !LEGACY.includes(headerVersion)) {
      return rpcError(id, -32022, "Unsupported protocol version", 400, { supported: SUPPORTED, requested: headerVersion });
    }
    return legacy(method, params, env, who, origin, id);
  }

  // ----- modern era -----
  const version = meta[PV];
  if (typeof version !== "string" || version !== MODERN) {
    return rpcError(id, -32022, "Unsupported protocol version", 400, { supported: SUPPORTED, requested: version });
  }
  if (headerVersion === null) return rpcError(id, -32020, "Header mismatch: MCP-Protocol-Version header is missing", 400);
  if (headerVersion !== version) {
    return rpcError(id, -32020, `Header mismatch: MCP-Protocol-Version header '${headerVersion}' does not match body '${version}'`, 400);
  }
  const headerMethod = req.headers.get("mcp-method");
  if (headerMethod === null) return rpcError(id, -32020, "Header mismatch: Mcp-Method header is missing", 400);
  if (headerMethod !== method) {
    return rpcError(id, -32020, `Header mismatch: Mcp-Method header '${headerMethod}' does not match body '${method}'`, 400);
  }
  if (["tools/call", "resources/read", "prompts/get"].includes(method)) {
    const bodyName = method === "resources/read" ? params.uri : params.name;
    const raw = req.headers.get("mcp-name");
    if (raw === null) return rpcError(id, -32020, "Header mismatch: Mcp-Name header is missing", 400);
    let headerName: string;
    try { headerName = decodeHeader(raw); } catch { return rpcError(id, -32020, "Header mismatch: Mcp-Name header is not valid base64", 400); }
    if (headerName !== bodyName) {
      return rpcError(id, -32020, `Header mismatch: Mcp-Name header '${headerName}' does not match body '${String(bodyName)}'`, 400);
    }
  }
  if (typeof meta[CAPS] !== "object" || meta[CAPS] === null) {
    return rpcError(id, -32602, `Missing _meta["${CAPS}"]`, 400);
  }

  // Tool results stay small (the course caps a whole result at 1 kB), so they carry a short serverInfo.
  const wrap = wrapResult;
  const done = (result: Record<string, unknown>) => json({ jsonrpc: "2.0", id, result: wrap(result, false) });
  // Logs each tool result's whole size (never its arguments), so an over-budget tool shows in Workers Logs.
  const toolDone = (name: unknown, result: Record<string, unknown>) => {
    const full = wrap(result, true);
    logResultSize(String(name), full);
    return json({ jsonrpc: "2.0", id, result: full });
  };

  switch (method) {
    case "server/discover":
      return done({
        supportedVersions: SUPPORTED,
        capabilities: { tools: {} },
        instructions: INSTRUCTIONS,
        ttlMs: 3600000,
        cacheScope: "private",
      });
    case "tools/list":
      return done({ tools: TOOLS, ttlMs: 300000, cacheScope: "private" });
    case "tools/call": {
      const r = await runTool(params, env, who, origin, id, true);
      return r instanceof Response ? r : toolDone(params.name, r);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`, 404);
  }
}

async function legacy(method: string, params: Record<string, unknown>, env: Env, who: TokenInfo, origin: string, id: Id): Promise<Response> {
  const done = (result: Record<string, unknown>) => json({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize": {
      const asked = params.protocolVersion;
      const version = typeof asked === "string" && LEGACY.includes(asked) ? asked : LEGACY[0];
      return done({
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return done({});
    case "tools/list":
      return done({ tools: TOOLS });
    case "tools/call": {
      const r = await runTool(params, env, who, origin, id, false);
      if (r instanceof Response) return r;
      logResultSize(String(params.name), r);
      return done(r);
    }
    default:
      return json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}
