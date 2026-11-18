// http: one HTTP request. {{NAME}} references from vars are filled in only for a host that secret may reach
// (this role's hosts.json), on every hop: redirects are followed here, one at a time, and a header whose secret may not reach
// the next host is dropped before the hop. A first request that would send a secret to another host is not sent.
import { mayReach, loadHosts } from './hosts.mjs';
import { fillVars, loadVars } from './vars.mjs';

const MAX_BODY = 20_000;
const MAX_HOPS = 5;
const REF = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
const refsIn = (text) => [...String(text).matchAll(REF)].map((m) => m[1]);

export default function (pi) {
  pi.registerTool({
    name: 'http',
    label: 'http',
    description: 'Sends one HTTP request and returns the status, the final URL and the response body. {{NAME}} references from vars are filled in only for the hosts that secret may reach (hosts.json in this role), on every redirect too.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        method: { type: 'string', description: 'GET (default), POST, PUT, PATCH or DELETE.' },
        url: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: { description: 'A string, or a JSON value (sent as JSON).' },
      },
    },
    async execute(_id, p, signal) {
      const vars = loadVars();
      const hosts = loadHosts();
      const fail = (text) => ({ content: [{ type: 'text', text }], details: { failed: true } });
      let url = p.url;
      let method = (p.method ?? 'GET').toUpperCase();
      let headers = { ...p.headers };
      let body = p.body === undefined || p.body === null ? undefined : typeof p.body === 'string' ? p.body : JSON.stringify(p.body);
      if (body !== undefined && typeof p.body !== 'string' && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
      const blocked = (u) => [...refsIn(u), ...Object.values(headers).flatMap(refsIn), ...(body ? refsIn(body) : [])].filter((n) => n in vars && !mayReach(n, u, hosts));
      const first = blocked(url);
      if (first.length) return fail(`not sent: {{${first[0]}}} may not reach ${new URL(url).host} (roles/critic/hosts.json)`);
      // Only a {{NAME}} reference carries a secret: a value written out is never sent (security review 2026-11-16 #7).
      const written = Object.entries(vars).find(([, v]) => v.length >= 8 && [url, ...Object.values(headers), body ?? ''].some((s) => String(s).includes(v)));
      if (written) return fail(`not sent: the request holds the value of {{${written[0]}}} as plain text; put the reference {{${written[0]}}} there instead`);
      // Only the model's own URL has its references filled. A redirect's Location comes from the server: it is sent as
      // it came, and one that names a secret its new host may not have is not followed. The output shows names, never values.
      let target = fillVars(url, vars);
      const hide = (u) => Object.entries(vars).reduce((s, [k, v]) => (v ? s.split(v).join(`{{${k}}}`).split(encodeURIComponent(v)).join(`{{${k}}}`) : s), u);
      try {
        for (let hop = 0; ; hop++) {
          const filled = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, fillVars(v, vars)]));
          const res = await fetch(target, { method, headers: filled, body: body === undefined ? undefined : fillVars(body, vars), redirect: 'manual', signal });
          const location = res.headers.get('location');
          if (res.status >= 300 && res.status < 400 && location && hop < MAX_HOPS) {
            target = new URL(location, target).href;
            url = hide(target);
            const named = refsIn(target).filter((n) => n in vars && !mayReach(n, target, hosts));
            if (named.length) return fail(`not followed: {{${named[0]}}} may not reach ${new URL(target).host}`);
            // The next hop: a header whose secret may not reach the new host is dropped; a body with one is not resent.
            headers = Object.fromEntries(Object.entries(headers).filter(([, v]) => refsIn(v).every((n) => !(n in vars) || mayReach(n, target, hosts))));
            if (body !== undefined && refsIn(body).some((n) => n in vars && !mayReach(n, target, hosts))) return fail(`not followed: the body holds a secret that may not reach ${new URL(target).host}`);
            if (res.status === 303) [method, body] = ['GET', undefined];
            continue;
          }
          const text = await res.text();
          const out = `${res.status} ${url}\n${text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}\n…(cut)` : text}`;
          return { content: [{ type: 'text', text: out }], details: { status: res.status, url } };
        }
      } catch (e) {
        return fail(`request failed: ${e?.cause?.message ?? e?.message ?? e}`);
      }
    },
  });
}
