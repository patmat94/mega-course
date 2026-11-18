// hosts: which host each secret may reach, from this role's own hosts.json (roles/integrator/hosts.json). A secret with
// no entry reaches no host: this role only talks to the course, so only the attempt is listed.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// host-desk/roles/integrator/extensions/hosts.mjs → host-desk/roles/integrator/
const ROLE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** name → the hosts it may reach. Missing file or bad JSON → no host for any secret. */
export function loadHosts() {
  try {
    const raw = JSON.parse(readFileSync(join(ROLE, 'hosts.json'), 'utf8'));
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.map((h) => String(h).toLowerCase())]));
  } catch {
    return {};
  }
}

// A secret travels over https only; plain http only to this machine (localhost, 127.0.0.1, ::1), for a course run locally.
const LOOPBACK = (h) => h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]';

/** May the secret `name` go to `url`'s host? */
export const mayReach = (name, url, hosts = loadHosts()) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK(u.hostname.toLowerCase()))) return false;
  return (hosts[name] ?? []).includes(u.host.toLowerCase());
};
