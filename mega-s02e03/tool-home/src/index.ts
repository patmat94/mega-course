import { Env, json, html } from "./util";
import {
  authServerMetadata, authorizeGet, authorizePost, checkBearer, grantsGet, grantsPost, protectedResourceMetadata, register, revoke, token,
} from "./oauth";
import { handleMcp } from "./mcp";
import { readFile, receivePut } from "./tools";
import { planPage } from "./plan";

const PUBLIC_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-method, mcp-name",
};

function allowedOrigin(req: Request, env: Env, origin: string): string | null | false {
  const o = req.headers.get("origin");
  if (!o) return null;
  const allowed = [origin, ...(env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)];
  return allowed.includes(o) ? o : false;
}

function mcpCors(o: string | null): Record<string, string> {
  if (!o) return {};
  return {
    "access-control-allow-origin": o,
    "vary": "origin",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version, mcp-method, mcp-name, mcp-param-*",
    "access-control-expose-headers": "www-authenticate",
  };
}

function withHeaders(res: Response, headers: Record<string, string>): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) r.headers.set(k, v);
  return r;
}

async function serveFile(env: Env, id: string, head: boolean): Promise<Response> {
  const f = await readFile(env, id);
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(head ? null : f.bytes, {
    headers: {
      "content-type": f.type,
      "content-length": String(f.bytes.length),
      "content-disposition": `inline; filename="${f.name}"`,
      // Uploaded content runs in an opaque origin, so it cannot reach this server's pages or tokens.
      "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = url.origin;
    const path = url.pathname;
    const m = req.method;

    if (path === "/" && m === "GET") return Response.redirect(`${origin}/plan`, 302);
    if (path === "/plan" && (m === "GET" || m === "HEAD")) return html(planPage(origin));

    if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
      if (m === "OPTIONS") return new Response(null, { status: 204, headers: PUBLIC_CORS });
      return json(protectedResourceMetadata(origin), 200, PUBLIC_CORS);
    }
    if (path === "/.well-known/oauth-authorization-server") {
      if (m === "OPTIONS") return new Response(null, { status: 204, headers: PUBLIC_CORS });
      return json(authServerMetadata(origin), 200, PUBLIC_CORS);
    }
    if (path === "/register") {
      if (m === "OPTIONS") return new Response(null, { status: 204, headers: PUBLIC_CORS });
      if (m === "POST") return withHeaders(await register(req, env), PUBLIC_CORS);
    }
    if (path === "/token") {
      if (m === "OPTIONS") return new Response(null, { status: 204, headers: PUBLIC_CORS });
      if (m === "POST") return withHeaders(await token(req, env, origin), PUBLIC_CORS);
    }
    if (path === "/revoke") {
      if (m === "OPTIONS") return new Response(null, { status: 204, headers: PUBLIC_CORS });
      if (m === "POST") return withHeaders(await revoke(req, env), PUBLIC_CORS);
    }
    if (path === "/grants") {
      if (m === "GET") return grantsGet();
      if (m === "POST") return grantsPost(req, env);
    }
    if (path === "/authorize") {
      if (m === "GET") return authorizeGet(req, env, origin);
      if (m === "POST") return authorizePost(req, env, origin);
    }

    const put = path.match(/^\/put\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/);
    if (put) {
      if (m === "OPTIONS") return new Response(null, { status: 204, headers: { ...PUBLIC_CORS, "access-control-allow-methods": "PUT, OPTIONS" } });
      if (m === "PUT") return withHeaders(await receivePut(req, env, put[1], put[2], origin), { "access-control-allow-origin": "*" });
      return new Response(null, { status: 405, headers: { allow: "PUT" } });
    }

    const file = path.match(/^\/files\/([A-Za-z0-9_-]+)(?:\/[^/]*)?$/);
    if (file && (m === "GET" || m === "HEAD")) return serveFile(env, file[1], m === "HEAD");

    if (path === "/mcp") {
      const o = allowedOrigin(req, env, origin);
      if (o === false) {
        return json({ jsonrpc: "2.0", error: { code: -32600, message: "Origin not allowed" } }, 403);
      }
      const cors = mcpCors(o);
      if (m === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (m !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", ...cors } });
      const who = await checkBearer(req, env, origin);
      if (who instanceof Response) return withHeaders(who, cors);
      return withHeaders(await handleMcp(req, env, who, origin), cors);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
