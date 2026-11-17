// plane-start.mjs · the start of a Host Desk role through rook-plane (ADR 0017): its startup.mjs reads every entry
// of roles/<role>/reads.json now (the house notes in why/ included), writes the start bundle (ROLE.md, then each
// read with its source, time and version) and one line in roles/<role>/runs.jsonl. The role's run.mjs passes that
// bundle to Pi as the system prompt and keeps its own tool flags, which plane's launch.mjs would not pass.
// A read that fails ends the start: no bundle, no model.
// Plane is found at PLANE_STARTUP, else in the repo's .agents/skills/rook-plane (looked for above this folder).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESK = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findStartup() {
  if (process.env.PLANE_STARTUP) return resolve(process.env.PLANE_STARTUP);
  for (let d = DESK; dirname(d) !== d; d = dirname(d)) {
    const p = join(d, '.agents', 'skills', 'rook-plane', 'scripts', 'startup.mjs');
    if (existsSync(p)) return p;
  }
  return null;
}

/** The start bundle for the role in `roleDir`, as a path relative to that folder. Exits the process when the start fails. */
export function startBundle(roleDir) {
  const startup = findStartup();
  if (!startup) {
    console.error('rook-plane not found: install it in .agents/skills/rook-plane, or set PLANE_STARTUP to its scripts/startup.mjs.');
    process.exit(1);
  }
  const role = `roles/${basename(roleDir)}`;
  // The reviewer's http tool keeps its hosts in the role's own hosts.json; plane reads a role's own file only when named.
  const hosts = existsSync(join(roleDir, 'hosts.json')) ? ['--hosts', `${role}/hosts.json`] : [];
  // A read with {{NAME}} (the reviewer's settings, Bearer {{ATTEMPT}}) goes through rook-clock's egress.mjs, which
  // takes the value from vars.json and sends it only to the hosts in hosts.json; the bundle never holds it.
  const vars = existsSync(join(DESK, 'vars.json')) ? ['--vars', 'vars.json'] : [];
  const r = spawnSync(process.execPath, [startup, role, '--launcher', 'pi', ...hosts, ...vars], { cwd: DESK, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) {
    console.error((r.stderr || r.stdout || `startup exited ${r.status}`).trim());
    process.exit(1);
  }
  const [bundle, hostsLine] = r.stdout.trim().split('\n');
  console.error(`start bundle: ${bundle} (${hostsLine})`);
  return relative(roleDir, resolve(DESK, bundle)).split('\\').join('/');
}
