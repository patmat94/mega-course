// code: runs one of your scripts from the scripts/ folder with Node, in that folder, and returns what it
// printed. The values in vars.json reach the script as environment variables (PAYOUT_KEY, …), the rest of the
// environment does not; the model sees only the script's output.
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import * as nodePath from 'node:path';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVars } from './vars.mjs';

const SCRIPTS = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts');
const TIMEOUT_MS = 120_000;
const MAX_OUT = 20_000;

// Peer QA 11-12: a script gets the OS basics Node and git need, plus vars.json, never the rest of the environment, so
// the model key (OPENROUTER_API_KEY, ANTHROPIC_API_KEY, …) never reaches a script. The proxy settings stay so a script
// works behind a company proxy; of git's own settings only the commit name and email stay.
const BASICS = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|HOMEDRIVE|HOMEPATH|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|USER|USERNAME|LOGNAME|SHELL|TERM|LANG|LC_[A-Z]+|TZ|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|HTTPS?_PROXY|NO_PROXY|NODE_USE_ENV_PROXY|GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL))$/i;
const basics = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => BASICS.test(k)));

/**
 * Where `name` points inside `root` (scripts/), or null. Only a plain relative path counts: no absolute, UNC
 * (\\host\share\…, //host/share/…) or other-drive (C:\…, C:x) path, nothing that climbs out with "..".
 * `path` is node:path; a check of the Windows forms on any OS passes path.win32.
 */
export function inside(name, root = SCRIPTS, path = nodePath) {
  if (typeof name !== 'string' || name === '' || path.isAbsolute(name) || /^[a-z]:/i.test(name)) return null;
  const file = path.resolve(root, name);
  const rel = path.relative(root, file);
  if (rel === '' || path.isAbsolute(rel) || rel.split(/[\\/]/)[0] === '..') return null;
  return file;
}

/** The script to run, or null: inside scripts/, there, and no link that leads out of scripts/. */
function script(name) {
  const file = inside(name);
  if (!file || !existsSync(file)) return null;
  try {
    return realpathSync(file).startsWith(realpathSync(SCRIPTS) + sep) ? file : null;
  } catch {
    return null;
  }
}

export default function (pi) {
  pi.registerTool({
    name: 'code',
    label: 'code',
    description: 'Runs a JavaScript file from the scripts/ folder with Node and returns its output.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['file'],
      properties: {
        file: { type: 'string', description: 'A file inside scripts/, e.g. "run.mjs".' },
        args: { type: 'array', items: { type: 'string' } },
      },
    },
    async execute(_id, p, signal, _onUpdate, ctx) {
      const file = script(p.file);
      if (!file) {
        return { content: [{ type: 'text', text: `No such file in scripts/: ${p.file}` }], details: { failed: true } };
      }
      const out = await new Promise((done) => {
        const child = spawn(process.execPath, [file, ...(p.args ?? [])], {
          cwd: SCRIPTS,
          // RAN_ON: the model this role runs on, as Pi reports it (post-result.mjs sends it as `ranOn`).
          env: { ...basics(), ...loadVars(), ...(ctx?.model ? { RAN_ON: `${ctx.model.provider}/${ctx.model.id}` } : {}) },
          stdio: ['ignore', 'pipe', 'pipe'],
          signal,
          timeout: TIMEOUT_MS,
        });
        let text = '';
        child.stdout.on('data', (d) => (text += d));
        child.stderr.on('data', (d) => (text += d));
        child.on('error', (e) => done(`could not run: ${e.message}`));
        child.on('close', (code) => done(`exit ${code}\n${text.length > MAX_OUT ? `${text.slice(0, MAX_OUT)}\n…(cut)` : text}`));
      });
      return { content: [{ type: 'text', text: out }], details: {} };
    },
  });
}
