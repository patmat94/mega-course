// Starts the reviewer once: Pi in print mode with the three tools from extensions/ and no others, ROLE.md as
// the system prompt. Model: MODEL (e.g. openrouter/<model id>), else Pi's default. stdin is closed, because `pi -p`
// waits for stdin when it is an open pipe.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// The reviewer zip unpacks roles/reviewer/ and why/ side by side in host-desk/.
if (!existsSync(join(here, '..', '..', 'why'))) {
  console.error('Install not complete: `host-desk/why/` missing. Unzip the reviewer zip where you unzipped the S04E01 zip.');
  process.exit(1);
}

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
  '--system-prompt', 'ROLE.md',
  ...(process.env.MODEL ? ['--model', process.env.MODEL] : []),
  'Start.',
];

// On Windows `pi` is a .cmd launcher, which Node starts only through a shell. No argument above has a space;
// MODEL is the one that comes from outside, so on Windows it holds a plain model id only (security review 2026-11-16 #9).
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
