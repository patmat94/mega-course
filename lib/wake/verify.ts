// Signature verifiers (WAKE.md § Exports, plan § 2). Behaviour copied from
// mega-s02e02/mail-agent/src/svix.ts and mega-s02e05/away-agent/src/index.js `verify`.

export type Verdict = { ok: true; id: string } | { ok: false; reason: string };
export type Verifier = (req: Request, raw: string, nowMs?: number) => Promise<Verdict>;

const enc = new TextEncoder();

async function hmac(key: Uint8Array<ArrayBuffer>, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const fail = (reason: string): Verdict => ({ ok: false, reason });

function windowCheck(name: string, value: string, nowMs: number, toleranceS: number): string | null {
  const t = Number(value);
  if (!value.trim() || !Number.isFinite(t)) return `${name} is not a number`;
  const secs = t > 1e12 ? t / 1000 : t; // seconds or milliseconds
  const skew = Math.round(Math.abs(nowMs / 1000 - secs));
  return skew > toleranceS ? `${name} is ${skew} s from now, outside the ${toleranceS} s window` : null;
}

/** Standard Webhooks / Svix: HMAC-SHA256 of `id.timestamp.body`, base64, "v1,<sig>" entries. */
export function standardWebhooks(o: { secret: string; prefix?: "webhook" | "svix"; toleranceS?: number }): Verifier {
  const p = o.prefix ?? "webhook";
  const tol = o.toleranceS ?? 300;
  return async (req, raw, nowMs = Date.now()) => {
    if (!o.secret) return fail("no signing key set");
    const id = req.headers.get(`${p}-id`);
    const ts = req.headers.get(`${p}-timestamp`);
    const sig = req.headers.get(`${p}-signature`);
    for (const [name, v] of [[`${p}-id`, id], [`${p}-timestamp`, ts], [`${p}-signature`, sig]] as const) {
      if (!v) return fail(`missing header ${name}`);
    }
    const late = windowCheck(`${p}-timestamp`, ts!, nowMs, tol);
    if (late) return fail(late);
    const key = fromB64(o.secret.startsWith("whsec_") ? o.secret.slice(6) : o.secret);
    const want = toB64(await hmac(key, `${id}.${ts}.${raw}`));
    const entries = sig!.split(" ").map((e) => e.split(",", 2)).filter(([v, s]) => v === "v1" && s);
    return entries.some(([, s]) => safeEqual(s, want))
      ? { ok: true, id: id! }
      : fail(`${p}-signature does not match (checked ${entries.length} v1 entr${entries.length === 1 ? "y" : "ies"})`);
  };
}

/** The course's channel: "sha256=" + hex HMAC-SHA256 of `timestamp.body`. */
export function courseHmac(o: { secret: string; toleranceS?: number }): Verifier {
  const tol = o.toleranceS ?? 600;
  return async (req, raw, nowMs = Date.now()) => {
    if (!o.secret) return fail("no signing key set");
    const ts = req.headers.get("x-course-timestamp");
    const sig = req.headers.get("x-course-signature");
    if (!ts) return fail("missing header x-course-timestamp");
    if (!sig) return fail("missing header x-course-signature");
    const late = windowCheck("x-course-timestamp", ts, nowMs, tol);
    if (late) return fail(late);
    const got = sig.trim().toLowerCase();
    const want = "sha256=" + toHex(await hmac(enc.encode(o.secret), `${ts}.${raw}`));
    return safeEqual(got, want) ? { ok: true, id: got.slice(-16) } : fail("x-course-signature does not match");
  };
}
