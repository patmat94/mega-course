// Starts this role once: Pi in print mode with the tools below and no others, ROLE.md as the system prompt.
//   node run.mjs [what to do]        e.g. node run.mjs "Job w-1"   (default: "Start.")
// Model: MODEL (e.g. openrouter/<model id>), else Pi's default. stdin is closed, because `pi -p` waits for stdin when
// it is an open pipe. Pi runs in JSON mode so this script can print the model it ran on (the last line, `model: …`).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This role's tools: the three in extensions/ + Pi's own read / edit / write (files of the Host Desk).
const TOOLS = 'vars,http,code,read,edit,write';

const here = dirname(fileURLToPath(import.meta.url));
// Pi runs in the Host Desk's top folder (or the job's worktree), so file paths are the ones `git diff` prints.
const top = resolve(here, '../..');
const role = `roles/${basename(here)}`;
const win = process.platform === 'win32';
const prompt = process.argv.slice(2).join(' ').trim() || 'Start.';
const args = [
  '-p',
  '--mode', 'json',
  '--no-session',
  '--tools', TOOLS,
  '--no-extensions',
  '--no-context-files',
  '--no-skills',
  '--no-prompt-templates',
  '--no-mcp',
  '-e', `${role}/extensions/vars.mjs`,
  '-e', `${role}/extensions/http.mjs`,
  '-e', `${role}/extensions/code.mjs`,
  '--system-prompt', `${role}/ROLE.md`,
  ...(process.env.MODEL ? ['--model', process.env.MODEL] : []),
  prompt,
];

const stop = (why) => {
  console.error(why);
  process.exit(1);
};

/**
 * Windows: `pi` is a .cmd launcher, and cmd.exe would read the prompt (`"`, `&`, `%NAME%`). So no shell: this Node
 * starts the script the launcher names (pi.cmd on PATH: the pi.dev launcher or npm's). Only when none is found, the
 * launcher runs through cmd.exe, and then a prompt with a character cmd.exe reads is refused. MODEL: plain ids only.
 */
function windowsPi() {
  if (process.env.MODEL && !/^[\w./:@-]+$/.test(process.env.MODEL)) stop('MODEL may hold letters, digits and . / : @ - _ only.');
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const shim = join(dir.replace(/^"(.*)"$/, '$1'), 'pi.cmd');
    let text;
    try {
      text = readFileSync(shim, 'utf8');
    } catch {
      continue;
    }
    const named = /"%(?:~dp0|dp0%)\\?([^"%]+\.[cm]?js)"/i.exec(text)?.[1];
    const script = named && join(dirname(shim), named);
    if (script && existsSync(script)) return [process.execPath, [script, ...args], false];
  }
  if (/["%&|<>^!\r\n]/.test(prompt)) stop('On this machine Pi starts through cmd.exe: the prompt may not hold " % & | < > ^ ! or a line break. Give the job id only, e.g. node run.mjs "Job w-1".');
  return ['pi.cmd', [...args.slice(0, -1), JSON.stringify(prompt)], true];
}

const [cmd, argv, shell] = win ? windowsPi() : ['pi', args, false];
const child = spawn(cmd, argv, {
  cwd: top,
  stdio: ['ignore', 'pipe', 'inherit'],
  shell,
  // RAN_ON reaches this role's scripts: the model Pi started with (the code tool sets the one Pi reports, QA mvp r1 fix 4).
  env: { ...process.env, RAN_ON: process.env.MODEL ?? '' },
});
let model = '';
let rest = '';
child.stdout.on('data', (chunk) => {
  const lines = (rest + chunk).split('\n');
  rest = lines.pop() ?? '';
  for (const line of lines) show(line);
});
function show(line) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  if (e.type !== 'message_end' || e.message?.role !== 'assistant') return;
  model = e.message.responseModel || e.message.model || model;
  for (const part of e.message.content ?? []) if (part.type === 'text' && part.text.trim()) console.log(part.text.trim());
}
child.on('error', (e) => {
  console.error(`Could not start pi: ${e.message}. Install Pi 1.5 or newer: npm install -g @earendil-works/pi-coding-agent (https://pi.dev).`);
  process.exit(1);
});
child.on('close', (code) => {
  if (rest) show(rest);
  if (model) console.log(`model: ${model}`);
  process.exit(code ?? 1);
});
