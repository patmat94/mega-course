// Runs a payout-runner script with vars.json as its environment, as the role's code tool does:
//   node desk.mjs batch.mjs practice | node desk.mjs finish.mjs run 90
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const desk = new URL('../mega-s04e01/starter/host-desk/', import.meta.url);
const vars = JSON.parse(readFileSync(new URL('vars.json', desk), 'utf8'));
const dir = fileURLToPath(new URL('roles/payout-runner/scripts/', desk));
const [file, ...args] = process.argv.slice(2);
const r = spawnSync(process.execPath, [file, ...args], { cwd: dir, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...vars }, stdio: 'inherit' });
process.exitCode = r.status ?? 1;
