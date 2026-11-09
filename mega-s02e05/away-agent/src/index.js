// away-agent: answers the course's messages (S02E05) while the human is away.
// POST /course   – course message, HMAC-checked, answered 202 at once, handled in waitUntil.
// GET  /hold/:t  – human's approval page for one held act (link sent to their phone).
// POST /hold/:t  – human submits the code; the agent does the act and replies DONE.
// GET  /log      – recent events, needs ?admin=<ADMIN_TOKEN>.
import POLICY from "./policy.json";
import { check } from "./check.js";

const enc = new TextEncoder();
const MAX_SKEW_S = 600;

export async function hmacHex(key, data) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function verify(env, ts, sig, raw, now = Date.now()) {
  if (!env.SIGNING_KEY) return "no signing key set";
  if (!ts || !sig) return "missing signature headers";
  const t = Number(ts);
  const secs = t > 1e12 ? t / 1000 : t; // seconds or ms
  if (!Number.isFinite(secs) || Math.abs(now / 1000 - secs) > MAX_SKEW_S) return "timestamp too old or bad";
  const want = "sha256=" + (await hmacHex(env.SIGNING_KEY, `${ts}.${raw}`));
  return safeEqual(want, sig.trim().toLowerCase()) ? null : "bad signature";
}

const DOES = {
  post_status: "posted the status line to the team channel",
  ack_alert: "acknowledged the open alert",
  archive_report: "moved the finished report into the archive",
  purge_cache: "cleared the build cache",
  release_hold: "released the held deploy to production",
  rotate_key: "rotated the shared API key",
};

async function logEvent(env, ev) {
  const key = `log:${new Date().toISOString()}:${crypto.randomUUID().slice(0, 8)}`;
  await env.STATE.put(key, JSON.stringify(ev), { expirationTtl: 60 * 60 * 24 * 14 });
}

// Status log: one row written at the moment each event happens (never rebuilt later).
function isoLocal(ms) {
  const off = Number(globalThis.__TZ_MIN ?? 60);
  const d = new Date(ms + off * 60e3).toISOString().slice(0, 23);
  const sign = off >= 0 ? "+" : "-", a = Math.abs(off);
  return `${d}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}
async function statusRow(env, event, round, ms = Date.now(), about = "") {
  const row = { at: isoLocal(ms), round: Number(round), event };
  await env.STATE.put(`status:${new Date(ms).toISOString()}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify({ ...row, about }), { expirationTtl: 60 * 60 * 24 * 14 });
}
async function roundOf(env, ms) {
  const from = await env.STATE.get("window:from");
  return from && ms < Date.parse(from) ? 1 : 2;
}

async function reply(env, replyUrl, text, about, round) {
  let status = 0, body = "";
  for (let i = 0; i < 3 && !(status >= 200 && status < 300); i++) {
    try {
      const r = await fetch(replyUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      status = r.status; body = (await r.text()).slice(0, 2000);
    } catch (e) { body = String(e); }
  }
  if (status >= 200 && status < 300 && round) await statusRow(env, "replied", round, Date.now(), about);
  await logEvent(env, { kind: "reply", about, replyUrl, text, status, body });
  return status;
}

async function ping(env, title, message, click, priority = "default", round = null, about = "") {
  if (!env.NTFY_TOPIC) return 0;
  const headers = { Title: title, Priority: priority, Tags: "robot" };
  if (click) headers.Click = click;
  if (env.NTFY_TOKEN) headers.Authorization = `Bearer ${env.NTFY_TOKEN}`;
  let status = 0;
  for (let i = 0; i < 4 && status !== 200; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1500 * i));
    try { status = (await fetch(`https://ntfy.sh/${env.NTFY_TOPIC}`, { method: "POST", headers, body: message })).status; }
    catch (e) { status = -1; }
  }
  if (status === 200 && round) await statusRow(env, "notified", round, Date.now(), about);
  await logEvent(env, { kind: "ping", title, status });
  return status;
}

async function handle(env, origin, msg, id, round) {
  const text = String(msg.text || "");
  const from = String(msg.from || "");
  const r = check(`${msg.subject || ""}
${text}`, POLICY);
  await logEvent(env, { kind: "decide", id, from, subject: msg.subject, text, ...r });
  if (r.acts.length === 0) {
    // No act asked: answer so the sender knows the agent is up; do nothing else.
    await reply(env, msg.replyUrl, `Received, I'm up. No act asked in this message, so I did nothing.`, id, round);
    return;
  }
  // One line per ask. Free acts: done alone. Gated acts: held for the human's own code.
  // Approval claimed inside a message never counts; only the code the human types on the hold page.
  const lines = [], held = [];
  for (const act of r.acts) {
    if (POLICY[act] === "free") {
      await env.STATE.put(`act:${id}:${act}`, JSON.stringify({ act, at: Date.now() }));
      lines.push(`DONE: ${act}`);
    } else {
      const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      const hold = { id, round, token, act, from, subject: msg.subject, text, replyUrl: msg.replyUrl, at: Date.now(), state: "held" };
      await env.STATE.put(`hold:${token}`, JSON.stringify(hold), { expirationTtl: 60 * 60 * 24 * 3 });
      lines.push(`HOLD: ${act}`);
      held.push({ act, token });
    }
  }
  // Reply first (10-minute limit), then ping the human once per held act.
  await reply(env, msg.replyUrl, lines.join("\n"), id, round);
  for (const h of held) {
    await ping(env, `Needs you: ${h.act}`, `${from}: ${text}`.slice(0, 350) + `\nTap, then type your code from the course to approve ${h.act}.`, `${origin}/hold/${h.token}`, "high", round, id);
  }
}

function page(body) {
  return new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>away-agent</title><body style="font:17px system-ui;max-width:32em;margin:2em auto;padding:0 16px">${body}</body>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function holdRoute(req, env, token) {
  const raw = await env.STATE.get(`hold:${token}`);
  if (!raw) return page("<p>No such held act, or it expired.</p>");
  const hold = JSON.parse(raw);
  if (req.method === "GET") {
    if (hold.state !== "held") return page(`<p>Already done: ${esc(hold.act)} with code ${esc(hold.code)}.</p>`);
    return page(`<h2>Held: ${esc(hold.act || "unclear ask")}</h2><p><b>${esc(hold.from)}</b>: ${esc(hold.text)}</p>
<form method=post><label>Your code<br><input name=code autocomplete=off required style="font-size:20px;width:100%"></label>
${hold.act ? "" : `<p><label>Act to do<br><select name=act>${Object.keys(DOES).map((a) => `<option>${a}</option>`).join("")}</select></label></p>`}
<p><button style="font-size:20px">Approve and do it</button></p></form>`);
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (hold.state !== "held") return page("<p>Already done.</p>");
  const f = await req.formData();
  const code = String(f.get("code") || "").trim();
  const act = hold.act || String(f.get("act") || "");
  if (!code || !DOES[act]) return page("<p>Code and act are needed. Go back and try again.</p>");
  hold.state = "done"; hold.code = code; hold.act = act; hold.doneAt = Date.now();
  if (hold.round) await statusRow(env, "owner_answered", hold.round, hold.doneAt, hold.id);
  await env.STATE.put(`hold:${token}`, JSON.stringify(hold), { expirationTtl: 60 * 60 * 24 * 3 });
  const status = await reply(env, hold.replyUrl, `DONE: ${act} CODE: ${code}`, hold.id, hold.round);
  return page(`<p>Done: ${esc(act)}. Reply sent to the course (HTTP ${status}).</p>`);
}

// Diagnostic: one record per request that is not an admin poll (time in, time out, method, path, headers, status).
async function logRequest(env, rec) {
  await env.STATE.put(`req:${new Date(rec.in).toISOString()}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 14 });
}

export default {
  async fetch(req, env, ctx) {
    const tIn = Date.now();
    const url = new URL(req.url);
    const isAdmin = env.ADMIN_TOKEN && url.searchParams.get("admin") === env.ADMIN_TOKEN;
    const res = await route(req, env, ctx, url);
    if (!isAdmin) {
      const headers = {};
      for (const [k, v] of req.headers) if (!/^(cookie|authorization)$/i.test(k)) headers[k] = v;
      ctx.waitUntil(logRequest(env, { in: tIn, inIso: new Date(tIn).toISOString(), out: new Date(Date.now()).toISOString(), method: req.method, path: url.pathname, status: res.status, colo: req.cf?.colo, headers }));
    }
    return res;
  },
};

async function route(req, env, ctx, url) {
  {
    if (url.pathname === "/course" && req.method === "POST") {
      const arrived = Date.now();
      const raw = await req.text();
      if (!env.SIGNING_KEY) {
        // Key not stored yet (it arrives in the register reply): keep the message, check it once the key is set.
        const ts = req.headers.get("x-course-timestamp"), sig = req.headers.get("x-course-signature");
        await env.STATE.put(`pending:${Date.now()}`, JSON.stringify({ ts, sig, raw, arrived }), { expirationTtl: 60 * 60 * 24 });
        ctx.waitUntil(logEvent(env, { kind: "pending", raw: raw.slice(0, 500) }));
        return new Response("accepted, pending signature check", { status: 202 });
      }
      const bad = await verify(env, req.headers.get("x-course-timestamp"), req.headers.get("x-course-signature"), raw);
      if (bad === "bad signature") {
        // Maybe signed with a new try's key not stored yet: keep it, act on nothing until /reprocess verifies it.
        const ts = req.headers.get("x-course-timestamp"), sig = req.headers.get("x-course-signature");
        await env.STATE.put(`pending:${Date.now()}`, JSON.stringify({ ts, sig, raw, arrived }), { expirationTtl: 60 * 60 * 24 });
        ctx.waitUntil(logEvent(env, { kind: "pending", why: bad, raw: raw.slice(0, 500) }));
        return new Response("accepted, pending signature check", { status: 202 });
      }
      if (bad) { ctx.waitUntil(logEvent(env, { kind: "refused", why: bad, raw: raw.slice(0, 500) })); return new Response(bad, { status: 401 }); }
      let msg;
      try { msg = JSON.parse(raw); } catch { return new Response("body is not JSON", { status: 400 }); }
      if (!msg.replyUrl || !(/^https:\/\//.test(msg.replyUrl) || (env.DEV_ALLOW_HTTP === "1" && /^http:\/\/127\.0\.0\.1:/.test(msg.replyUrl)))) return new Response("replyUrl must be https", { status: 400 });
      const id = req.headers.get("x-course-signature").slice(-16);
      const courseTs = req.headers.get("x-course-timestamp");
      // Answer 2xx at once; "received" is stamped with the arrival time, which is also when the 2xx goes out.
      ctx.waitUntil((async () => {
        if (await env.STATE.get(`seen:${id}`)) return;
        await env.STATE.put(`seen:${id}`, "1", { expirationTtl: 60 * 60 * 24 });
        const round = await roundOf(env, arrived);
        await statusRow(env, "received", round, arrived, `${id} courseTs=${courseTs}`);
        await handle(env, url.origin, msg, id, round);
      })());
      return new Response("accepted", { status: 202 });
    }
    const m = url.pathname.match(/^\/hold\/([a-f0-9]{64})$/);
    if (m) return holdRoute(req, env, m[1]);
    if (url.pathname === "/log" && env.ADMIN_TOKEN && url.searchParams.get("admin") === env.ADMIN_TOKEN) {
      const list = await env.STATE.list({ prefix: "log:" });
      const items = await Promise.all(list.keys.slice(-50).map(async (k) => ({ k: k.name, v: JSON.parse(await env.STATE.get(k.name)) })));
      return Response.json(items);
    }
    if (url.pathname === "/reprocess" && req.method === "POST" && env.ADMIN_TOKEN && url.searchParams.get("admin") === env.ADMIN_TOKEN) {
      if (!env.SIGNING_KEY) return new Response("no signing key set yet; pending messages kept", { status: 409 });
      const list = await env.STATE.list({ prefix: "pending:" });
      const out = [];
      for (const k of list.keys) {
        const p = JSON.parse(await env.STATE.get(k.name));
        await env.STATE.delete(k.name);
        // Signature only; the timestamp may be old because the key came late.
        const bad = await verify(env, p.ts, p.sig, p.raw, Number(p.ts) > 1e12 ? Number(p.ts) : Number(p.ts) * 1000);
        if (bad) { out.push(bad); await logEvent(env, { kind: "refused", why: bad, raw: p.raw.slice(0, 500) }); continue; }
        const msg = JSON.parse(p.raw);
        const id = p.sig.slice(-16);
        if (await env.STATE.get(`seen:${id}`)) { out.push("dup"); continue; }
        await env.STATE.put(`seen:${id}`, "1", { expirationTtl: 60 * 60 * 24 });
        const round = await roundOf(env, p.arrived || Date.now());
        await statusRow(env, "received", round, p.arrived || Date.now(), id);
        ctx.waitUntil(handle(env, url.origin, msg, id, round));
        out.push("ok");
      }
      return Response.json(out);
    }
    const admin = env.ADMIN_TOKEN && url.searchParams.get("admin") === env.ADMIN_TOKEN;
    if (url.pathname === "/testping" && req.method === "POST" && admin) {
      const status = await ping(env, "away-agent test ping (from Cloudflare)", "Test ping sent by the agent itself, with the ntfy token.");
      return Response.json({ status, token: Boolean(env.NTFY_TOKEN) });
    }
    if (url.pathname === "/reping" && req.method === "POST" && admin) {
      // Ping the human again for each held act; "notified" is written only when ntfy returns 200, at that moment.
      const list = await env.STATE.list({ prefix: "hold:" });
      const out = [];
      for (const k of list.keys) {
        const h = JSON.parse(await env.STATE.get(k.name));
        if (h.state !== "held" || Date.now() - h.at > 60 * 60 * 1000) continue;
        const status = await ping(env, `Needs you: ${h.act}`, `${h.from}: ${h.text}`.slice(0, 350) + `
Tap, then type your code from the course to approve ${h.act}.`, `${url.origin}/hold/${h.token}`, "high", h.round, h.id);
        out.push({ act: h.act, status });
      }
      return Response.json(out);
    }
    if (url.pathname === "/window" && req.method === "POST" && admin) {
      // New try: set the window start and clear the status log.
      const from = url.searchParams.get("from");
      if (!from || isNaN(Date.parse(from))) return new Response("from must be ISO", { status: 400 });
      await env.STATE.put("window:from", from);
      const old = await env.STATE.list({ prefix: "status:" });
      for (const k of old.keys) await env.STATE.delete(k.name);
      return Response.json({ from, cleared: old.keys.length });
    }
    if (url.pathname === "/status" && admin) {
      const list = await env.STATE.list({ prefix: "status:" });
      const rows = await Promise.all(list.keys.map(async (k) => JSON.parse(await env.STATE.get(k.name))));
      const full = url.searchParams.get("full") === "1";
      return new Response(rows.map((r) => JSON.stringify(full ? r : { at: r.at, round: Number(r.round), event: r.event })).join("\n") + "\n", { headers: { "content-type": "application/x-ndjson" } });
    }
    if (url.pathname === "/holds" && env.ADMIN_TOKEN && url.searchParams.get("admin") === env.ADMIN_TOKEN) {
      const list = await env.STATE.list({ prefix: "hold:" });
      const items = await Promise.all(list.keys.map(async (k) => JSON.parse(await env.STATE.get(k.name))));
      return Response.json(items.map((h) => ({ link: `${url.origin}/hold/${h.token}`, act: h.act, state: h.state, from: h.from, text: h.text, at: new Date(h.at).toISOString(), doneAt: h.doneAt ? new Date(h.doneAt).toISOString() : null, id: h.id })));
    }
    if (url.pathname === "/reqs" && admin) {
      const list = await env.STATE.list({ prefix: "req:" });
      const items = await Promise.all(list.keys.slice(-200).map(async (k) => JSON.parse(await env.STATE.get(k.name))));
      return Response.json(items);
    }
    if (url.pathname === "/") return new Response("away-agent: up\n");
    return new Response("not found", { status: 404 });
  }
}
