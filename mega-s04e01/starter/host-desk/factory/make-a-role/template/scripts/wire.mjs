// wire.mjs — one request, redirects followed by hand, every hop logged.
// Answers two of the run's questions in code (check-lane payout-run):
//   where may each secret go → SECRET_HOSTS; a redirect, a page or a manual never adds a host;
//   what did each request do on the wire → one log row per hop: host, status, what it carried, where it pointed.
// A hop to a host that is not allowed for a secret the request carries is not sent: the request stops there.

import { readFileSync } from 'node:fs';

/** name → the only hosts that value may reach: the role's own hosts.json (one list for the http tool and the scripts). */
export const SECRET_HOSTS = (() => {
  try {
    const raw = JSON.parse(readFileSync(new URL('../hosts.json', import.meta.url), 'utf8'));
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.map((h) => String(h).toLowerCase())]));
  } catch {
    return {};
  }
})();

/**
 * @param secrets {name: value} — the values to guard; any of them found in the headers or body is "carried".
 * @param log     row => void
 */
export async function wire(method, url, { headers = {}, body, secrets = {}, log, maxHops = 5 } = {}) {
  const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const hdrs = { ...(payload && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}), ...headers };
  const carried = Object.entries(secrets).filter(([, v]) => v && (JSON.stringify(hdrs).includes(v) || (payload ?? '').includes(v) || url.includes(v))).map(([k]) => k);
  let cur = url, m = method;
  for (let hop = 0; hop <= maxHops; hop++) {
    const host = new URL(cur).host;
    // A carried secret with no hosts.json entry reaches no host.
    const bad = carried.filter((k) => !(SECRET_HOSTS[k] ?? []).includes(host.toLowerCase()));
    if (bad.length) {
      log?.({ hop, method: m, host, url: cur, blocked: `would carry ${bad.join(', ')} to ${host}; not sent` });
      return { status: 0, blocked: true, host, json: { blocked: `request stopped: ${bad.join(', ')} may not go to ${host}` }, hops: hop };
    }
    const t0 = Date.now();
    const res = await fetch(cur, { method: m, headers: hdrs, body: m === 'GET' || m === 'HEAD' ? undefined : payload, redirect: 'manual' });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      const next = new URL(loc, cur).toString();
      log?.({ hop, method: m, host, url: cur, carried, status: res.status, ms: Date.now() - t0, location: next });
      await res.arrayBuffer().catch(() => {});
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && m === 'POST')) m = 'GET';
      cur = next;
      continue;
    }
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 2000) }; }
    log?.({ hop, method: m, host, url: cur, carried, body: hop === 0 ? body : undefined, status: res.status, ms: Date.now() - t0, reply: json });
    return { status: res.status, json, host, hops: hop, finalUrl: cur };
  }
  log?.({ method, url, blocked: `more than ${maxHops} redirects` });
  return { status: 0, blocked: true, json: { blocked: 'too many redirects' } };
}
