// Starts this role once: Pi in print mode with the three tools from extensions/ and no others. The system prompt is the
// rook-plane start bundle: ROLE.md plus every read in reads.json (the house notes, the course API index), read now, so
// the role never works from a fact written down when it was made (factory/CHECKLIST.md; ADR 0017).
//   node run.mjs [what to do]     e.g. node run.mjs practice   (default: Start.)
// Model: MODEL (e.g. anthropic/<model id>), else Pi's default. stdin is closed, because `pi -p` waits for an open stdin.
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBundle } from '../plane-start.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ask = process.argv.slice(2).join(' ').trim() || 'Start.';
if (!/^[\w .,:'-]{1,200}$/.test(ask)) {
  console.error('What to do: letters, digits, spaces and . , : \' - only (it reaches a shell on Windows).');
  process.exit(1);
}
const bundle = startBundle(here);
const args = [
  '-p',
  '--no-session',
  '--no-builtin-tools',
  '--no-extensions',
  '--no-context-files',
  '--no-skills',
  '--no-prompt-templates',
  '--no-mcp',
  '-e', 'extensions/vars.mjs',
  '-e', 'extensions/http.mjs',
  '-e', 'extensions/code.mjs',
  '--system-prompt', bundle,
  ...(process.env.MODEL ? ['--model', process.env.MODEL] : []),
  process.platform === 'win32' ? `"${ask}"` : ask,
];

// On Windows `pi` is a .cmd launcher, which Node starts only through a shell. MODEL and the ask come from outside, so
// both are checked above to plain characters (security review 2026-11-16 #9).
if (process.platform === 'win32' && process.env.MODEL && !/^[\w./:@-]+$/.test(process.env.MODEL)) {
  console.error('MODEL may hold letters, digits and . / : @ - _ only.');
  process.exit(1);
}
const child = spawn(process.platform === 'win32' ? 'pi.cmd' : 'pi', args, {
  cwd: here,
  stdio: ['ignore', 'inherit', 'inherit'],
  shell: process.platform === 'win32',
});
child.on('error', (e) => {
  console.error(`Could not start pi: ${e.message}. Install Pi 1.5 or newer: npm install -g @earendil-works/pi-coding-agent (https://pi.dev).`);
  process.exit(1);
});
child.on('close', (code) => process.exit(code ?? 1));
