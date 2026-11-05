// End-to-end check of tool-home: OAuth (DCR + PKCE), modern and legacy MCP, all four tools.
// Usage: node test/e2e.mjs <base-url> [audio-file]   (passphrase from env OWNER_PASSWORD or .dev.vars)
// Prints one line per check; never prints the passphrase or tokens.
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const base = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const audioPath = process.argv[3] ?? "test/sample.wav";
const pass = process.env.OWNER_PASSWORD ?? readFileSync(".dev.vars", "utf8").match(/OWNER_PASSWORD=(\S+)/)[1];
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const b64url = (b) => b.toString("base64url");
// Whole-result budget: every tools/call result is measured as the JSON object the client receives.
const BUDGET = Number(process.env.RESULT_BUDGET ?? 1024);
const sizes = []; // { tool, era, bytes, isError }
const measure = (era, method, params, body) => {
  if (method !== "tools/call" || !body?.result) return;
  sizes.push({ tool: params.name, era, bytes: Buffer.byteLength(JSON.stringify(body.result)), isError: !!body.result.isError });
};

// 1. unauthenticated call
let r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
const wa = r.headers.get("www-authenticate") ?? "";
check("401 without token", r.status === 401, wa);
check("WWW-Authenticate names resource_metadata", wa.includes(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`));

// 2. metadata
const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
check("PRM resource", prm.resource === `${base}/mcp`, prm.resource);
check("PRM resource_documentation on same host", prm.resource_documentation === `${base}/plan`, prm.resource_documentation);
const plan = await fetch(prm.resource_documentation);
const planText = await plan.text();
check("plan page loads", plan.status === 200 && /Sign-in/.test(planText) && /Data it keeps/.test(planText) && /transcribe/.test(planText));
const asm = await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
check("AS metadata issuer matches", asm.issuer === prm.authorization_servers[0]);
check("AS advertises CIMD + iss + S256", asm.client_id_metadata_document_supported && asm.authorization_response_iss_parameter_supported && asm.code_challenge_methods_supported.includes("S256"));

// 3. DCR
const redirect = "http://127.0.0.1:33418/callback";
r = await fetch(asm.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "e2e test", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], application_type: "native" }) });
const client = await r.json();
check("DCR 201", r.status === 201 && !!client.client_id, client.client_id);

// 4. authorize
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const state = b64url(randomBytes(8));
const au = new URL(asm.authorization_endpoint);
Object.entries({ response_type: "code", client_id: client.client_id, redirect_uri: redirect.replace("33418", "40001"), code_challenge: challenge,
  code_challenge_method: "S256", state, scope: "mcp", resource: `${base}/mcp` }).forEach(([k, v]) => au.searchParams.set(k, v));
r = await fetch(au);
const consent = await r.text();
check("consent page shown (loopback port may differ)", r.status === 200 && consent.includes("Allow access"));
const pendingId = consent.match(/name="request" value="([^"]+)"/)[1];
r = await fetch(asm.authorization_endpoint, { method: "POST", redirect: "manual", body: new URLSearchParams({ request: pendingId, passphrase: "wrong", action: "approve" }) });
check("wrong passphrase refused", r.status === 401);
r = await fetch(asm.authorization_endpoint, { method: "POST", redirect: "manual", body: new URLSearchParams({ request: pendingId, passphrase: pass, action: "approve" }) });
const loc = new URL(r.headers.get("location") ?? "http://x/");
check("approve redirects with code, state, iss", r.status === 302 && !!loc.searchParams.get("code") && loc.searchParams.get("state") === state && loc.searchParams.get("iss") === asm.issuer);

// 5. token
r = await fetch(asm.token_endpoint, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: loc.searchParams.get("code"),
  redirect_uri: redirect.replace("33418", "40001"), code_verifier: verifier, client_id: client.client_id, resource: `${base}/mcp` }) });
let tok = await r.json();
check("token issued", r.status === 200 && tok.token_type === "Bearer" && !!tok.refresh_token);
r = await fetch(asm.token_endpoint, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: loc.searchParams.get("code"),
  redirect_uri: redirect.replace("33418", "40001"), code_verifier: verifier, client_id: client.client_id }) });
check("code works only once", r.status === 400);
r = await fetch(asm.token_endpoint, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: client.client_id }) });
tok = await r.json();
check("refresh rotates", r.status === 200 && !!tok.access_token);

// 6. modern MCP
const V = "2026-07-28";
const meta = { "io.modelcontextprotocol/protocolVersion": V, "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
let nextId = 1;
async function modern(method, params = {}, extraHeaders = {}) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tok.access_token}`,
    "mcp-protocol-version": V, "mcp-method": method, ...extraHeaders };
  if (method === "tools/call" && !("mcp-name" in extraHeaders)) headers["mcp-name"] = params.name;
  const res = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params: { ...params, _meta: meta } }) });
  const out = { status: res.status, body: await res.json() };
  measure("2026-07-28", method, params, out.body);
  return out;
}
let x = await modern("server/discover");
check("server/discover", x.status === 200 && x.body.result.resultType === "complete" && x.body.result.supportedVersions.includes(V));
x = await modern("tools/list");
const names = x.body.result.tools.map((t) => t.name);
check("tools/list has 4 tools with outputSchema", ["memo_write", "memo_search", "upload", "transcribe"].every((n) => names.includes(n)) && x.body.result.tools.every((t) => t.outputSchema) && x.body.result.ttlMs > 0, names.join(","));
x = await modern("tools/call", { name: "memo_write", arguments: { text: "e2e note: purple elephant" } });
check("memo_write", x.body.result?.structuredContent?.id?.startsWith("memo_") && x.body.result.isError === false, JSON.stringify(x.body.result?.structuredContent));
const memoId = x.body.result?.structuredContent?.id;
x = await modern("tools/call", { name: "memo_search", arguments: { query: "PURPLE elephant" } });
check("memo_search finds it", x.body.result?.structuredContent?.notes?.[0]?.id === memoId, JSON.stringify(x.body.result?.structuredContent?.notes?.[0]));
// memo_search keeps the whole result under budget: older notes left out (omitted + hint), a long note clipped
const marker = `fitcheck${randomBytes(4).toString("hex")}`;
for (let i = 0; i < 6; i++) await modern("tools/call", { name: "memo_write", arguments: { text: `${marker} note ${i} ` + "lorem ipsum ".repeat(2) } });
x = await modern("tools/call", { name: "memo_search", arguments: { query: marker } });
let sc = x.body.result?.structuredContent;
check("memo_search leaves out old notes to fit", sc?.notes?.length >= 2 && sc.omitted === 6 - sc.notes.length && /left out/.test(sc.hint ?? "") && /left out/.test(x.body.result.content[0].text) &&
  sc.notes[0].text.startsWith(`${marker} note 5`) && !sc.notes.some((n) => n.truncated), `${sc?.notes?.length} shown, omitted ${sc?.omitted}`);
await modern("tools/call", { name: "memo_write", arguments: { text: `${marker}long ` + "a long line of text. ".repeat(200) } });
x = await modern("tools/call", { name: "memo_search", arguments: { query: `${marker}long` } });
sc = x.body.result?.structuredContent;
check("memo_search clips one note too long to fit", sc?.notes?.length === 1 && sc.notes[0].truncated === true && sc.notes[0].text.length > 100 && /clipped/.test(sc.hint ?? ""),
  `${sc?.notes?.[0]?.text?.length} chars kept`);
x = await modern("tools/call", { name: "upload", arguments: { filename: "hello.txt", content: "hello world" } });
const up = x.body.result?.structuredContent;
check("upload", !!up?.url?.startsWith(`${base}/files/`), up?.url);
r = await fetch(up.url);
check("upload link opens without sign-in", r.status === 200 && (await r.text()) === "hello world");
const audio = readFileSync(audioPath);
x = await modern("tools/call", { name: "upload", arguments: { filename: "sample.wav", content: audio.toString("base64"), encoding: "base64" } });
const audioUrl = x.body.result?.structuredContent?.url;
check("upload binary", x.body.result?.structuredContent?.size === audio.length, `${x.body.result?.structuredContent?.size} bytes`);
x = await modern("tools/call", { name: "transcribe", arguments: { url: audioUrl } });
const tr = x.body.result?.structuredContent;
check("transcribe", Array.isArray(tr?.segments) && tr.segments.length > 0 && typeof tr.segments[0].start === "number", JSON.stringify(tr)?.slice(0, 300));
if (x.body.result?.isError) console.log("     ", x.body.result.content[0].text);

// 6a. two-step upload (content left out -> PUT raw bytes)
x = await modern("tools/call", { name: "upload", arguments: { filename: "big.txt" } });
const two = x.body.result?.structuredContent;
check("upload without content gives upload_url", !!two?.upload_url && !!two?.url, two?.upload_url?.replace(/[^/]+$/, "****"));
r = await fetch(two.url);
check("link is 404 before PUT", r.status === 404);
const bigBody = "first line\n" + "x".repeat(3 * 1024 * 1024) + "\nlast line\n";
r = await fetch(two.upload_url, { method: "PUT", body: bigBody });
check("PUT 200", r.status === 200, await r.text());
r = await fetch(two.url);
check("link serves the PUT bytes exactly", r.status === 200 && (await r.text()) === bigBody);
r = await fetch(two.upload_url, { method: "PUT", body: "again" });
check("upload_url works once", r.status === 404);

// 6b. the course's cases (claim 2): result size and errors that name the url
const calib = "https://hq.mega.dev/media/calibration/calibration-fdadf085.mp3";
x = await modern("tools/call", { name: "transcribe", arguments: { url: calib } });
const bytes = Buffer.byteLength(JSON.stringify(x.body.result ?? {}));
check("transcribe calibration result <= 1024 B", !x.body.result?.isError && bytes <= 1024, `${bytes} B; ${x.body.result?.content?.[0]?.text?.slice(0, 120)}`);
for (const [label, bad] of [["web page", "https://hq.mega.dev/login"], ["missing file", "https://hq.mega.dev/media/s02e03/missing.mp3"]]) {
  x = await modern("tools/call", { name: "transcribe", arguments: { url: bad } });
  const msg = x.body.result?.content?.[0]?.text ?? "";
  check(`transcribe error names url (${label})`, x.body.result?.isError === true && msg.includes(bad), msg);
}

// 7. modern error paths
x = await modern("tools/list", {}, { "mcp-method": "tools/call" });
check("Mcp-Method mismatch -> 400 -32020", x.status === 400 && x.body.error.code === -32020);
x = await modern("tools/call", { name: "memo_search", arguments: { query: "" } }, { "mcp-name": "memo_write" });
check("Mcp-Name mismatch -> 400 -32020", x.status === 400 && x.body.error.code === -32020);
x = await modern("tools/call", { name: "memo_search", arguments: { query: "" } }, { "mcp-name": "=?base64?" + Buffer.from("memo_search").toString("base64") + "?=" });
check("Mcp-Name base64 accepted", x.status === 200 && !x.body.error);
let res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok.access_token}`, "mcp-protocol-version": "1900-01-01", "mcp-method": "tools/list" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list", params: { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "1900-01-01" } } }) });
let body = await res.json();
check("unsupported version -> 400 -32022", res.status === 400 && body.error.code === -32022 && body.error.data.supported.includes(V));
x = await modern("subscriptions/listen");
check("unknown method -> 404 -32601", x.status === 404 && x.body.error.code === -32601);
x = await modern("tools/call", { name: "memo_write", arguments: {} });
check("bad arguments -> isError", x.body.result?.isError === true);
res = await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${tok.access_token}` } });
check("GET /mcp -> 405", res.status === 405);
res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer nope" }, body: "{}" });
check("bad token -> 401 invalid_token", res.status === 401 && (res.headers.get("www-authenticate") ?? "").includes("invalid_token"));
res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok.access_token}`, origin: "https://evil.example" }, body: "{}" });
check("foreign Origin -> 403", res.status === 403);

// 8. legacy MCP
async function legacy(method, params = {}, id = nextId++) {
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream",
    authorization: `Bearer ${tok.access_token}`, ...(method === "initialize" ? {} : { "mcp-protocol-version": "2025-11-25" }) },
    body: JSON.stringify(id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }) });
  const out = { status: res.status, body: res.status === 202 ? null : await res.json() };
  measure("2025-11-25", method, params, out.body);
  return out;
}
x = await legacy("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "legacy", version: "1" } });
check("legacy initialize", x.body.result?.protocolVersion === "2025-11-25", x.body.result?.protocolVersion);
x = await legacy("notifications/initialized", {}, null);
check("legacy notification -> 202", x.status === 202);
x = await legacy("tools/list");
check("legacy tools/list", x.body.result?.tools?.length === 4);
x = await legacy("tools/call", { name: "memo_search", arguments: { query: "elephant" } });
check("legacy tools/call", x.body.result?.structuredContent?.notes?.length >= 1);

// 9. taking access back
check("AS advertises revocation_endpoint", asm.revocation_endpoint === `${base}/revoke`);
const mcpWith = (access) => fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${access}`,
  "mcp-protocol-version": V, "mcp-method": "tools/list" }, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/list", params: { _meta: meta } }) });
// a second approval for the same client, without checks (the flow is checked above)
async function approve() {
  const v = b64url(randomBytes(32));
  const u = new URL(asm.authorization_endpoint);
  Object.entries({ response_type: "code", client_id: client.client_id, redirect_uri: redirect, code_challenge: b64url(createHash("sha256").update(v).digest()),
    code_challenge_method: "S256", scope: "mcp", resource: `${base}/mcp` }).forEach(([k, val]) => u.searchParams.set(k, val));
  const pid = (await (await fetch(u)).text()).match(/name="request" value="([^"]+)"/)[1];
  const a = await fetch(asm.authorization_endpoint, { method: "POST", redirect: "manual", body: new URLSearchParams({ request: pid, passphrase: pass, action: "approve" }) });
  const code = new URL(a.headers.get("location")).searchParams.get("code");
  return (await fetch(asm.token_endpoint, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect,
    code_verifier: v, client_id: client.client_id }) })).json();
}
r = await fetch(`${base}/grants`);
check("grants page asks for the passphrase and lists nobody", r.status === 200 && !(await r.text()).includes(client.client_id));
r = await fetch(`${base}/grants`, { method: "POST", body: new URLSearchParams({ passphrase: pass }) });
check("grants page lists this client after the passphrase", r.status === 200 && (await r.text()).includes(client.client_id));
// a client ends its own grant (RFC 7009): access and refresh of that approval both stop
r = await fetch(`${base}/revoke`, { method: "POST", body: new URLSearchParams({ token: tok.refresh_token, client_id: client.client_id }) });
check("POST /revoke -> 200", r.status === 200);
check("revoked grant: access token gets 401", (await mcpWith(tok.access_token)).status === 401);
r = await fetch(asm.token_endpoint, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: client.client_id }) });
check("revoked grant: refresh token refused", r.status === 400);
r = await fetch(`${base}/revoke`, { method: "POST", body: new URLSearchParams({ token: "unknown-token", client_id: client.client_id }) });
check("revoke unknown token -> 200 (RFC 7009)", r.status === 200);
// the owner takes access back from a client
const tok2 = await approve();
check("second approval works", (await mcpWith(tok2.access_token)).status === 200);
r = await fetch(`${base}/grants`, { method: "POST", body: new URLSearchParams({ passphrase: pass, revoke: client.client_id }) });
check("owner takes access back on /grants", r.status === 200 && (await r.text()).includes("Access taken back"));
check("taken back: access token gets 401", (await mcpWith(tok2.access_token)).status === 401);
r = await fetch(asm.token_endpoint, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok2.refresh_token, client_id: client.client_id }) });
check("taken back: refresh token refused", r.status === 400);

// 10. whole-result size of every tool call made above
const byTool = {};
for (const s of sizes) (byTool[s.tool] ??= []).push(s);
console.log(`\nwhole tools/call result sizes (budget ${BUDGET} B):`);
for (const [tool, list] of Object.entries(byTool)) {
  const max = list.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  console.log(`  ${tool.padEnd(12)} calls ${String(list.length).padStart(2)}  max ${String(max.bytes).padStart(5)} B${max.isError ? " (error)" : ""} (${max.era})`);
}
for (const tool of ["memo_write", "memo_search", "upload", "transcribe"]) {
  const list = byTool[tool] ?? [];
  const over = list.filter((s) => s.bytes > BUDGET);
  check(`every ${tool} result <= ${BUDGET} B`, list.length > 0 && over.length === 0,
    list.length ? `${list.length} calls, max ${Math.max(...list.map((s) => s.bytes))} B` : "no calls measured");
}

const failed = results.filter((v) => !v).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
