// OAuth 2.1 authorization server for this one MCP server.
// Clients: Client ID Metadata Documents (https URL as client_id) or dynamic registration (RFC 7591).
// Sign-in: the owner types the server passphrase (secret OWNER_PASSWORD) on the consent page.
import {
  Env, SCOPE, esc, html, json, nowSec, randomToken, resourceUri, safeEqual, sha256, b64url,
} from "./util";

const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 24 * 3600;
const CODE_TTL = 300;
const PENDING_TTL = 600;
const MAX_FAILS = 5;
const FAIL_WINDOW = 900;

export interface Client {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: "none" | "client_secret_basic" | "client_secret_post";
  secret_hash?: string;
  kind: "cimd" | "dcr";
}

export interface TokenInfo {
  client_id: string;
  client_name: string;
  scope: string;
  resource: string;
  /** Shared by the access and refresh tokens of one approval, so revoking one ends both. Older grants lack it. */
  grant_id?: string;
}

// ---------- metadata ----------

export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceUri(origin),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Tool Home",
    resource_documentation: `${origin}/plan`,
  };
}

export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    revocation_endpoint: `${origin}/revoke`,
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/plan`,
  };
}

export function challenge(origin: string, error?: string): Record<string, string> {
  const parts = [`resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`, `scope="${SCOPE}"`];
  if (error) parts.unshift(`error="${error}"`);
  return { "www-authenticate": `Bearer ${parts.join(", ")}` };
}

// ---------- grants table helpers ----------

async function putGrant(env: Env, key: string, kind: string, data: unknown, ttl: number) {
  await env.DB.prepare("INSERT OR REPLACE INTO grants (key, kind, data, exp) VALUES (?, ?, ?, ?)")
    .bind(key, kind, JSON.stringify(data), nowSec() + ttl).run();
}

async function getGrant<T>(env: Env, key: string, kind: string): Promise<T | null> {
  const row = await env.DB.prepare("SELECT data, exp FROM grants WHERE key = ? AND kind = ?")
    .bind(key, kind).first<{ data: string; exp: number }>();
  if (!row || row.exp < nowSec()) return null;
  return JSON.parse(row.data) as T;
}

/** Reads and deletes in one statement, so a code or refresh token works once. */
async function takeGrant<T>(env: Env, key: string, kind: string): Promise<T | null> {
  const row = await env.DB.prepare("DELETE FROM grants WHERE key = ? AND kind = ? RETURNING data, exp")
    .bind(key, kind).first<{ data: string; exp: number }>();
  if (!row || row.exp < nowSec()) return null;
  return JSON.parse(row.data) as T;
}

async function sweep(env: Env) {
  const now = nowSec();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM grants WHERE exp < ?").bind(now),
    env.DB.prepare("DELETE FROM cimd_cache WHERE exp < ?").bind(now),
    env.DB.prepare("DELETE FROM login_fails WHERE exp < ?").bind(now),
  ]);
}

// ---------- clients ----------

function isLoopback(u: URL): boolean {
  return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

function redirectAllowed(uri: string): boolean {
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return isLoopback(u);
  // private-use schemes of native apps, e.g. com.example.app:/callback
  return !["javascript:", "data:", "file:", "vbscript:", "blob:", "about:"].includes(u.protocol);
}

/** Exact match; for loopback redirects the port may differ (RFC 8252 section 7.3). */
function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (!isLoopback(u)) return false;
  return registered.some((r) => {
    try {
      const v = new URL(r);
      return isLoopback(v) && v.hostname === u.hostname && v.pathname === u.pathname && v.search === u.search;
    } catch { return false; }
  });
}

function isCimdUrl(clientId: string): boolean {
  try {
    const u = new URL(clientId);
    return u.protocol === "https:" && u.pathname !== "/" && !u.hash && !u.username && !u.password;
  } catch { return false; }
}

async function fetchCimd(env: Env, url: string): Promise<Client> {
  const cached = await env.DB.prepare("SELECT data FROM cimd_cache WHERE url = ? AND exp > ?")
    .bind(url, nowSec()).first<{ data: string }>();
  if (cached) return JSON.parse(cached.data) as Client;

  const res = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  if (res.status !== 200) throw new Error(`client metadata document answered ${res.status}`);
  const text = await res.text();
  if (text.length > 10_000) throw new Error("client metadata document is larger than 10 kB");
  let doc: Record<string, unknown>;
  try { doc = JSON.parse(text); } catch { throw new Error("client metadata document is not JSON"); }
  if (doc.client_id !== url) throw new Error("client_id in the document does not match its URL");
  const redirects = doc.redirect_uris;
  if (!Array.isArray(redirects) || redirects.length === 0 || !redirects.every((r) => typeof r === "string" && redirectAllowed(r))) {
    throw new Error("redirect_uris is missing or holds a URI this server does not accept");
  }
  if (typeof doc.client_name !== "string" || !doc.client_name) throw new Error("client_name is missing");
  const method = doc.token_endpoint_auth_method ?? "none";
  if (method !== "none") throw new Error(`token_endpoint_auth_method ${String(method)} is not supported for metadata-document clients`);

  const client: Client = {
    client_id: url,
    client_name: doc.client_name.slice(0, 100),
    redirect_uris: redirects as string[],
    token_endpoint_auth_method: "none",
    kind: "cimd",
  };
  await env.DB.prepare("INSERT OR REPLACE INTO cimd_cache (url, data, exp) VALUES (?, ?, ?)")
    .bind(url, JSON.stringify(client), nowSec() + 3600).run();
  return client;
}

export async function getClient(env: Env, clientId: string): Promise<Client | null> {
  if (isCimdUrl(clientId)) return fetchCimd(env, clientId);
  const row = await env.DB.prepare("SELECT data FROM clients WHERE id = ?").bind(clientId).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Client) : null;
}

// ---------- /register ----------

export async function register(req: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_client_metadata", error_description: "body must be JSON" }, 400); }
  const redirects = body.redirect_uris;
  if (!Array.isArray(redirects) || redirects.length === 0 || redirects.length > 10 ||
      !redirects.every((r) => typeof r === "string" && redirectAllowed(r))) {
    return json({ error: "invalid_redirect_uri", error_description: "redirect_uris must be https, http loopback or an app scheme" }, 400);
  }
  const method = (body.token_endpoint_auth_method ?? "client_secret_basic") as string;
  if (!["none", "client_secret_basic", "client_secret_post"].includes(method)) {
    return json({ error: "invalid_client_metadata", error_description: `token_endpoint_auth_method ${method} is not supported` }, 400);
  }
  const grantTypes = (body.grant_types ?? ["authorization_code"]) as unknown;
  if (!Array.isArray(grantTypes) || !grantTypes.includes("authorization_code")) {
    return json({ error: "invalid_client_metadata", error_description: "grant_types must include authorization_code" }, 400);
  }
  const name = typeof body.client_name === "string" && body.client_name ? body.client_name.slice(0, 100) : "Unnamed client";
  const clientId = `dcr_${randomToken(16)}`;
  const secret = method === "none" ? undefined : randomToken(32);
  const client: Client = {
    client_id: clientId,
    client_name: name,
    redirect_uris: redirects as string[],
    token_endpoint_auth_method: method as Client["token_endpoint_auth_method"],
    secret_hash: secret ? await sha256(secret) : undefined,
    kind: "dcr",
  };
  await env.DB.prepare("INSERT INTO clients (id, data, created_at) VALUES (?, ?, ?)")
    .bind(clientId, JSON.stringify(client), nowSec()).run();
  const out: Record<string, unknown> = {
    client_id: clientId,
    client_id_issued_at: nowSec(),
    client_name: name,
    redirect_uris: client.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: method,
    scope: SCOPE,
  };
  if (typeof body.application_type === "string") out.application_type = body.application_type;
  if (secret) { out.client_secret = secret; out.client_secret_expires_at = 0; }
  return json(out, 201, { "cache-control": "no-store" });
}

// ---------- owner passphrase (consent page and grants page) ----------

const LOCKED_MSG = "Too many wrong passphrases. Wait 15 minutes and try again.";

/** Checks the owner passphrase in the form, with the per-IP wrong-passphrase limit. */
async function checkOwner(req: Request, env: Env, form: FormData): Promise<"ok" | "wrong" | "locked"> {
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const fails = await env.DB.prepare("SELECT count FROM login_fails WHERE ip = ? AND exp > ?").bind(ip, nowSec()).first<{ count: number }>();
  if (fails && fails.count >= MAX_FAILS) return "locked";
  const passphrase = String(form.get("passphrase") ?? "");
  if (!env.OWNER_PASSWORD || !(await safeEqual(passphrase, env.OWNER_PASSWORD))) {
    await env.DB.prepare(
      "INSERT INTO login_fails (ip, count, exp) VALUES (?, 1, ?) ON CONFLICT(ip) DO UPDATE SET count = count + 1",
    ).bind(ip, nowSec() + FAIL_WINDOW).run();
    return "wrong";
  }
  // The right passphrase clears this address's count, so the owner is not locked out by earlier typos.
  if (fails) await env.DB.prepare("DELETE FROM login_fails WHERE ip = ?").bind(ip).run();
  return "ok";
}

// ---------- /authorize ----------

interface Pending {
  client_id: string;
  client_name: string;
  client_kind: "cimd" | "dcr";
  redirect_uri: string;
  state?: string;
  code_challenge: string;
  scope: string;
  resource: string;
}

function normalizeResource(r: string): string | null {
  try {
    const u = new URL(r);
    if (u.hash) return null;
    let s = `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname}${u.search}`;
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch { return null; }
}

function redirectWith(redirectUri: string, params: Record<string, string | undefined>): Response {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { location: u.toString(), "cache-control": "no-store" } });
}

function errorPage(title: string, detail: string, status = 400): Response {
  return html(page(title, `<p>${esc(detail)}</p>`), status);
}

export async function authorizeGet(req: Request, env: Env, origin: string): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const clientId = q.get("client_id") ?? "";
  const redirectUri = q.get("redirect_uri") ?? "";
  let client: Client | null;
  try { client = clientId ? await getClient(env, clientId) : null; }
  catch (e) { return errorPage("Unknown client", `The client could not be loaded: ${(e as Error).message}`); }
  if (!client) return errorPage("Unknown client", "This client_id is not registered here.");
  if (!redirectUri || !redirectMatches(client.redirect_uris, redirectUri)) {
    return errorPage("Bad redirect", "redirect_uri does not match the client's registered redirect URIs.");
  }
  const state = q.get("state") ?? undefined;
  const fail = (error: string, description: string) =>
    redirectWith(redirectUri, { error, error_description: description, state, iss: origin });

  if (q.get("response_type") !== "code") return fail("unsupported_response_type", "response_type must be code");
  const codeChallenge = q.get("code_challenge");
  if (!codeChallenge || q.get("code_challenge_method") !== "S256") return fail("invalid_request", "PKCE with S256 is required");
  let resource = resourceUri(origin);
  const asked = q.get("resource");
  if (asked) {
    const n = normalizeResource(asked);
    if (n !== resourceUri(origin) && n !== origin) return fail("invalid_target", "resource must be this server's MCP endpoint");
  }

  await sweep(env);
  const pendingId = randomToken(24);
  const pending: Pending = {
    client_id: client.client_id,
    client_name: client.client_name,
    client_kind: client.kind,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    scope: SCOPE,
    resource,
  };
  await putGrant(env, pendingId, "pending", pending, PENDING_TTL);
  return html(consentPage(pending, pendingId));
}

export async function authorizePost(req: Request, env: Env, origin: string): Promise<Response> {
  const form = await req.formData();
  const pendingId = String(form.get("request") ?? "");
  const pending = await getGrant<Pending>(env, pendingId, "pending");
  if (!pending) return errorPage("Request expired", "This sign-in request is unknown or expired. Start the connection again from your app.");

  if (form.get("action") !== "approve") {
    await takeGrant(env, pendingId, "pending");
    return redirectWith(pending.redirect_uri, { error: "access_denied", error_description: "The owner denied access", state: pending.state, iss: origin });
  }

  const owner = await checkOwner(req, env, form);
  if (owner === "locked") return html(consentPage(pending, pendingId, LOCKED_MSG), 429);
  if (owner === "wrong") return html(consentPage(pending, pendingId, "Wrong passphrase."), 401);

  await takeGrant(env, pendingId, "pending");
  const code = randomToken(32);
  await putGrant(env, await sha256(code), "code", pending, CODE_TTL);
  return redirectWith(pending.redirect_uri, { code, state: pending.state, iss: origin });
}

// ---------- /token ----------

function tokenError(error: string, description: string, status = 400, headers: Record<string, string> = {}): Response {
  return json({ error, error_description: description }, status, { "cache-control": "no-store", ...headers });
}

async function authenticateClient(req: Request, form: FormData, env: Env): Promise<Client | Response> {
  let clientId = form.get("client_id")?.toString();
  let secret = form.get("client_secret")?.toString();
  let usedBasic = false;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const [id, sec] = atob(auth.slice(6)).split(":");
      clientId = decodeURIComponent(id);
      secret = decodeURIComponent(sec ?? "");
      usedBasic = true;
    } catch { return tokenError("invalid_client", "bad Basic credentials", 401); }
  }
  if (!clientId) return tokenError("invalid_client", "client_id is required", 401);
  let client: Client | null;
  try { client = await getClient(env, clientId); } catch (e) { return tokenError("invalid_client", (e as Error).message, 401); }
  if (!client) return tokenError("invalid_client", "unknown client", 401);
  if (client.token_endpoint_auth_method !== "none") {
    if (!secret || !client.secret_hash || !(await safeEqual(await sha256(secret), client.secret_hash))) {
      return tokenError("invalid_client", "client authentication failed", 401, usedBasic ? { "www-authenticate": 'Basic realm="token"' } : {});
    }
  }
  return client;
}

async function issueTokens(env: Env, info: TokenInfo) {
  if (!info.grant_id) info = { ...info, grant_id: randomToken(12) };
  const access = randomToken(32);
  const refresh = randomToken(32);
  await Promise.all([
    putGrant(env, await sha256(access), "access", info, ACCESS_TTL),
    putGrant(env, await sha256(refresh), "refresh", info, REFRESH_TTL),
  ]);
  return json({
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: refresh,
    scope: info.scope,
  }, 200, { "cache-control": "no-store", pragma: "no-cache" });
}

export async function token(req: Request, env: Env, origin: string): Promise<Response> {
  let form: FormData;
  try { form = await req.formData(); } catch { return tokenError("invalid_request", "body must be application/x-www-form-urlencoded"); }
  const client = await authenticateClient(req, form, env);
  if (client instanceof Response) return client;
  const grantType = form.get("grant_type")?.toString();
  const asked = form.get("resource")?.toString();
  if (asked) {
    const n = normalizeResource(asked);
    if (n !== resourceUri(origin) && n !== origin) return tokenError("invalid_target", "resource must be this server's MCP endpoint");
  }

  if (grantType === "authorization_code") {
    const code = form.get("code")?.toString() ?? "";
    const verifier = form.get("code_verifier")?.toString() ?? "";
    const grant = await takeGrant<Pending>(env, await sha256(code), "code");
    if (!grant) return tokenError("invalid_grant", "code is unknown, used or expired");
    if (grant.client_id !== client.client_id) return tokenError("invalid_grant", "code was issued to another client");
    if (form.get("redirect_uri")?.toString() !== grant.redirect_uri) return tokenError("invalid_grant", "redirect_uri does not match");
    const hashed = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    if (!verifier || hashed !== grant.code_challenge) return tokenError("invalid_grant", "code_verifier does not match code_challenge");
    return issueTokens(env, { client_id: client.client_id, client_name: client.client_name, scope: grant.scope, resource: grant.resource });
  }

  if (grantType === "refresh_token") {
    const rt = form.get("refresh_token")?.toString() ?? "";
    const grant = await takeGrant<TokenInfo>(env, await sha256(rt), "refresh");
    if (!grant) return tokenError("invalid_grant", "refresh_token is unknown, used or expired");
    if (grant.client_id !== client.client_id) return tokenError("invalid_grant", "refresh_token was issued to another client");
    return issueTokens(env, grant);
  }

  return tokenError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
}

// ---------- revocation ----------

const TOKEN_KINDS = "kind IN ('access', 'refresh')";

/** POST /revoke (RFC 7009): a client ends its own grant. Answers 200 even for an unknown token. */
export async function revoke(req: Request, env: Env): Promise<Response> {
  let form: FormData;
  try { form = await req.formData(); } catch { return tokenError("invalid_request", "body must be application/x-www-form-urlencoded"); }
  const client = await authenticateClient(req, form, env);
  if (client instanceof Response) return client;
  const tok = form.get("token")?.toString();
  if (!tok) return tokenError("invalid_request", "token is required");
  const key = await sha256(tok);
  const row = await env.DB.prepare(`SELECT data FROM grants WHERE key = ? AND ${TOKEN_KINDS}`).bind(key).first<{ data: string }>();
  if (row) {
    const info = JSON.parse(row.data) as TokenInfo;
    if (info.client_id !== client.client_id) return tokenError("unauthorized_client", "token was issued to another client");
    if (info.grant_id) {
      await env.DB.prepare(`DELETE FROM grants WHERE ${TOKEN_KINDS} AND json_extract(data, '$.grant_id') = ?`).bind(info.grant_id).run();
    } else {
      await env.DB.prepare("DELETE FROM grants WHERE key = ?").bind(key).run();
    }
  }
  return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
}

interface ClientGrants { client_id: string; client_name: string; tokens: number; until: number }

async function listGrants(env: Env): Promise<ClientGrants[]> {
  const { results } = await env.DB.prepare(
    `SELECT json_extract(data, '$.client_id') AS client_id, MAX(json_extract(data, '$.client_name')) AS client_name,
            COUNT(*) AS tokens, MAX(exp) AS until
       FROM grants WHERE ${TOKEN_KINDS} AND exp >= ? GROUP BY 1 ORDER BY until DESC`,
  ).bind(nowSec()).all<ClientGrants>();
  return results;
}

/** Ends every access and refresh token of one client. Returns how many were deleted. */
async function revokeClient(env: Env, clientId: string): Promise<number> {
  const r = await env.DB.prepare(`DELETE FROM grants WHERE ${TOKEN_KINDS} AND json_extract(data, '$.client_id') = ?`)
    .bind(clientId).run();
  return r.meta.changes ?? 0;
}

/** GET /grants: the owner's page to see who holds access and take it back. */
export function grantsGet(): Response {
  return html(grantsPage(null));
}

export async function grantsPost(req: Request, env: Env): Promise<Response> {
  const form = await req.formData();
  const owner = await checkOwner(req, env, form);
  if (owner === "locked") return html(grantsPage(null, LOCKED_MSG), 429);
  if (owner === "wrong") return html(grantsPage(null, "Wrong passphrase."), 401);
  let notice: string | undefined;
  const target = form.get("revoke")?.toString();
  if (target) {
    const n = await revokeClient(env, target);
    notice = n ? `Access taken back from ${target}: ${n} token(s) ended. Its next call gets 401.` : `${target} held no active tokens.`;
  }
  return html(grantsPage(await listGrants(env), undefined, notice));
}

function grantsPage(list: ClientGrants[] | null, error?: string, notice?: string): string {
  const rows = (list ?? []).map((g) => `<tr><td><b>${esc(g.client_name)}</b><br><span class="muted">${esc(g.client_id)}</span></td>
<td>${g.tokens}</td><td>${new Date(g.until * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC</td>
<td><button type="submit" name="revoke" value="${esc(g.client_id)}">Take back</button></td></tr>`).join("");
  const table = list === null ? "" : list.length === 0
    ? `<p>No client holds access now.</p>`
    : `<table><tr><th>Client</th><th>Tokens</th><th>Lasts until</th><th></th></tr>${rows}</table>`;
  return page("Who has access — Tool Home", `
<h1>Who has access</h1>
<div class="card">
${error ? `<p class="err">${esc(error)}</p>` : ""}${notice ? `<p>${esc(notice)}</p>` : ""}
<form method="post" action="/grants">
<p><label for="pp">Server passphrase (needed for every action here)</label><br>
<input id="pp" type="password" name="passphrase" autocomplete="current-password" autofocus required></p>
${table}
<p><button class="primary" type="submit">${list === null ? "Show clients" : "Refresh"}</button></p>
</form></div>
<p class="muted">Taking access back ends the client's access and refresh tokens. To get back in, the client must ask again and you must approve it on the consent page. <a href="/plan">Plan</a></p>`);
}

// ---------- bearer check ----------

export async function checkBearer(req: Request, env: Env, origin: string): Promise<TokenInfo | Response> {
  const auth = req.headers.get("authorization");
  if (!auth || !/^Bearer\s+/i.test(auth)) {
    return json({ error: "unauthorized", error_description: "Sign-in required" }, 401, challenge(origin));
  }
  const info = await getGrant<TokenInfo>(env, await sha256(auth.replace(/^Bearer\s+/i, "").trim()), "access");
  if (!info || info.resource !== resourceUri(origin)) {
    return json({ error: "invalid_token", error_description: "The access token is invalid, expired or not for this server" }, 401, challenge(origin, "invalid_token"));
  }
  return info;
}

// ---------- pages ----------

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{color-scheme:light dark;--fg:#1d1d1f;--bg:#fafafa;--muted:#666;--card:#fff;--line:#ddd;--accent:#2457d6}
@media (prefers-color-scheme:dark){:root{--fg:#eee;--bg:#161616;--muted:#aaa;--card:#202020;--line:#333;--accent:#7aa2ff}}
body{font:16px/1.55 system-ui,sans-serif;color:var(--fg);background:var(--bg);max-width:44rem;margin:0 auto;padding:2rem 1rem}
h1{font-size:1.5rem}h2{font-size:1.15rem;margin-top:2rem}code{font-size:.92em}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem 1.25rem}
.muted{color:var(--muted)}.err{color:#c62828;font-weight:600}
input[type=password]{width:100%;box-sizing:border-box;padding:.6rem;font-size:1rem;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
button{padding:.6rem 1.1rem;font-size:1rem;border-radius:6px;border:1px solid var(--line);cursor:pointer}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:.4rem;text-align:left;vertical-align:top}
</style></head><body>${body}</body></html>`;
}

function consentPage(p: Pending, pendingId: string, error?: string): string {
  const redirectHost = (() => { try { const u = new URL(p.redirect_uri); return u.host || u.protocol; } catch { return p.redirect_uri; } })();
  const who = p.client_kind === "cimd"
    ? `<b>${esc(p.client_name)}</b> <span class="muted">(identified by ${esc(p.client_id)})</span>`
    : `<b>${esc(p.client_name)}</b> <span class="muted">(self-registered client; the name is not verified)</span>`;
  return page("Allow access to Tool Home?", `
<h1>Allow access to Tool Home?</h1>
<div class="card">
<p>${who} asks to use the tools on this server: memo_write, memo_search, upload and transcribe.</p>
<p class="muted">After you approve, your browser goes back to <code>${esc(redirectHost)}</code>. The access lasts one hour and renews for up to 30 days.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" action="/authorize">
<input type="hidden" name="request" value="${esc(pendingId)}">
<p><label for="pp">Server passphrase (only the owner has it)</label><br>
<input id="pp" type="password" name="passphrase" autocomplete="current-password" autofocus></p>
<p><button class="primary" type="submit" name="action" value="approve">Approve</button>
<button type="submit" name="action" value="deny">Deny</button></p>
</form></div>
<p class="muted"><a href="/plan">What this server does and what it keeps</a></p>`);
}
