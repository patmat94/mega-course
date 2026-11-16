// http: one HTTP request. {{NAME}} references from vars are filled in the url, headers and body when the
// request is sent, so the model works with the reference only. Redirects are followed.
import { fillVars, loadVars } from './vars.mjs';
import { wire } from '../scripts/wire.mjs';

const MAX_BODY = 20_000;
const hide = (u, vars) => Object.entries(vars).reduce((s, [k, v]) => (v ? s.split(v).join(`{{${k}}}`).split(encodeURIComponent(v)).join(`{{${k}}}`) : s), u);

export default function (pi) {
  pi.registerTool({
    name: 'http',
    label: 'http',
    description: 'Sends one HTTP request and returns the status, the final URL and the response body. {{NAME}} references from vars are filled in when it is sent.',
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
      // Control: each secret goes only to the host that owns it, whatever a fetched page asks (S04E01: the manual
      // asked for the payout key at a "verify" host). A reference to any other host is refused before sending.
      const ALLOW = { PAYOUT_KEY: ['pay-s04.mega.dev'], TICKET: ['hq.mega.dev'] };
      let host = '';
      try { host = new URL(fillVars(p.url, vars)).host; } catch {}
      const used = JSON.stringify([p.url, p.headers ?? {}, p.body ?? '']).match(/\{\{([A-Z][A-Z0-9_]*)\}\}/g) ?? [];
      for (const ref of used) {
        const name = ref.slice(2, -2);
        if (ALLOW[name] && !ALLOW[name].includes(host)) {
          return { content: [{ type: 'text', text: `refused: {{${name}}} may go only to ${ALLOW[name].join(', ')}, not ${host}. Do not send it there; tell the owner.` }], details: { failed: true } };
        }
      }
      const headers = Object.fromEntries(Object.entries(p.headers ?? {}).map(([k, v]) => [k, fillVars(v, vars)]));
      let body;
      if (p.body !== undefined && p.body !== null) {
        body = fillVars(typeof p.body === 'string' ? p.body : JSON.stringify(p.body), vars);
        if (typeof p.body !== 'string' && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
      }
      try {
        // Redirects are followed by hand (wire.mjs): every hop is checked against ALLOW and listed in the result,
        // so a redirect never carries a secret to a new host and the model sees what happened on the wire.
        const secrets = Object.fromEntries(used.map((r) => r.slice(2, -2)).filter((n) => vars[n]).map((n) => [n, vars[n]]));
        const hops = [];
        const r = await wire((p.method ?? 'GET').toUpperCase(), fillVars(p.url, vars), { headers, body, secrets, log: (h) => hops.push(h) });
        const trail = hops.map((h) => `hop ${h.hop ?? '-'}: ${h.method ?? ''} ${h.host ?? ''} ${h.blocked ? `BLOCKED ${h.blocked}` : `${h.status}${h.location ? ` → ${h.location}` : ''}`}`).join('\n');
        const text = r.json?.raw ?? JSON.stringify(r.json);
        const out = `${r.status} ${hide(r.finalUrl ?? p.url, vars)}\n${hide(trail, vars)}\n${text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}\n…(cut)` : text}`;
        return { content: [{ type: 'text', text: out }], details: { status: r.status, hops: r.hops, blocked: !!r.blocked } };
      } catch (e) {
        return { content: [{ type: 'text', text: `request failed: ${e?.cause?.message ?? e?.message ?? e}` }], details: { failed: true } };
      }
    },
  });
}
