// stdio entry for tool-home, so hands' check-tool.mjs (which does not sign in) can call its tools.
// It signs in the normal way: registers a client, approves it with the owner passphrase, gets a token.
// Then it forwards each JSON-RPC line from stdin to /mcp with that token and writes each answer to stdout.
// When stdin ends it revokes its token at /revoke, so no grant is left behind.
// Sign-in stays on: without the passphrase this proxy gets no token, and the server is unchanged.
//
// Usage: node test/stdio-proxy.mjs <base-url>   (passphrase from env OWNER_PASSWORD or .dev.vars)
// Logs go to stderr only; it never prints the passphrase or tokens.
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

const base = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const pass = process.env.OWNER_PASSWORD ?? readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").match(/OWNER_PASSWORD=(\S+)/)[1];
const log = (m) => process.stderr.write(`stdio-proxy: ${m}\n`);
const b64url = (b) => b.toString("base64url");

async function signIn() {
  const asm = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  const redirect = "http://127.0.0.1:33419/callback";
  const client = await (await fetch(asm.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "check-tool (stdio proxy)", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code"] }) })).json();
  const verifier = b64url(randomBytes(32));
  const au = new URL(asm.authorization_endpoint);
  Object.entries({ response_type: "code", client_id: client.client_id, redirect_uri: redirect, code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256", scope: "mcp", resource: `${base}/mcp` }).forEach(([k, v]) => au.searchParams.set(k, v));
  const pending = (await (await fetch(au)).text()).match(/name="request" value="([^"]+)"/)?.[1];
  if (!pending) throw new Error("no consent page");
  const ap = await fetch(asm.authorization_endpoint, { method: "POST", redirect: "manual", body: new URLSearchParams({ request: pending, passphrase: pass, action: "approve" }) });
  const code = new URL(ap.headers.get("location") ?? "http://x/").searchParams.get("code");
  if (!code) throw new Error(`approval refused (HTTP ${ap.status})`);
  const tok = await (await fetch(asm.token_endpoint, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect,
    code_verifier: verifier, client_id: client.client_id, resource: `${base}/mcp` }) })).json();
  if (!tok.access_token) throw new Error("no token");
  log(`signed in to ${base} as ${client.client_id}`);
  return { clientId: client.client_id, revokeUrl: asm.revocation_endpoint, ...tok };
}

const session = await signIn();
let legacyVersion = null;

// The headers the 2026-07-28 revision checks against the body; the older revision only names its version.
function headersFor(msg) {
  const h = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${session.access_token}` };
  const pv = msg.params?._meta?.["io.modelcontextprotocol/protocolVersion"];
  if (typeof pv === "string") {
    h["mcp-protocol-version"] = pv;
    h["mcp-method"] = msg.method;
    if (msg.method === "tools/call") {
      const n = String(msg.params?.name ?? "");
      h["mcp-name"] = /^[\x21-\x7e]+$/.test(n) ? n : `=?base64?${Buffer.from(n).toString("base64")}?=`;
    }
  } else if (legacyVersion && msg.method !== "initialize") {
    h["mcp-protocol-version"] = legacyVersion;
  }
  return h;
}

async function forward(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: headersFor(msg), body: line, redirect: "manual" });
  if (res.status === 202) return;
  const text = await res.text();
  let answer;
  try { answer = JSON.parse(text); } catch {
    answer = { jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32603, message: `HTTP ${res.status} from ${base}/mcp` } };
  }
  if (msg.method === "initialize" && typeof answer.result?.protocolVersion === "string") legacyVersion = answer.result.protocolVersion;
  process.stdout.write(`${JSON.stringify(answer)}\n`);
}

// One message at a time, in order, as a stdio server answers.
let queue = Promise.resolve();
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => { if (line.trim()) queue = queue.then(() => forward(line)).catch((e) => log(`forward failed: ${e.message}`)); });
rl.on("close", () => {
  queue = queue.then(async () => {
    const r = await fetch(session.revokeUrl, { method: "POST", body: new URLSearchParams({ token: session.access_token, client_id: session.clientId }) });
    log(`revoked its token (HTTP ${r.status})`);
  }).catch((e) => log(`revoke failed: ${e.message}`));
  // No process.exit right after fetch: on this machine that crashes Node (KEEP.md). The loop drains and ends.
});
