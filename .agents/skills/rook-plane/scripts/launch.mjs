#!/usr/bin/env node
// launch.mjs · one role, any harness, fresh context. Rule 3 of the plane pack, in code.
//
//   node launch.mjs roles/<name> --harness claude|codex|pi [--model <id>] [--prompt "Start."] [--dry-run]
//                   [--hosts hosts.json] [--vars vars.json] [--egress <path to egress.mjs>]
//   node launch.mjs --self-test
//
// Run it from the project's folder. It runs startup.mjs first (every read, now), then starts the harness
// once, in print mode, with no saved session and stdin closed. The system prompt is the start bundle:
// ROLE.md, then every read. The lines it runs, with <bundle> the bundle's path:
//
//   claude -p --system-prompt-file <bundle> --no-session-persistence [--model <id>] <prompt>
//   codex exec --ephemeral -c model_instructions_file="<bundle>" [--model <id>] <prompt>
//   pi -p --no-session -ne -nc --system-prompt <bundle> [--model <id>] <prompt>
//
// It prints the line before it runs it, with each secret the reads name and its hosts (KEY → api.example.com),
// and the egress.mjs the start uses; --dry-run
// prints it and runs nothing, not even the reads.
// The harness is found on PATH, in absolute PATH folders only, never inside the project (by its real path),
// never in a network or device folder (\\host\share, \\?\..., //host).
// Arguments are passed as a list, never through a shell: on Windows, a harness installed as a .cmd launcher is started
// through the Node script that launcher names. A harness that is not installed is one line, exit 2.
//
// Exit codes: the harness's own; 1 the start failed (a read); 2 a usage error or no such harness.
// Plain Node.js 20 or newer, no dependencies.

import { spawn } from 'node:child_process';
import { accessSync, constants, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { egressPlaces, findEgress, hostsFile, hostsShown, inside, loadEgress, netPath, parseArgs, readList, roleFolder, shown, start, StartFailed } from './startup.mjs';

export const HARNESSES = ['claude', 'codex', 'pi'];
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;
const MAX_PROMPT = 4000;
const oneLine = (s) => shown(String(s).replace(/\r?\n/g, ' ')).slice(0, 400);

// The harness's arguments, in the order the line above shows.
export function harnessArgs(harness, bundle, { model, prompt }) {
  const m = model ? ['--model', model] : [];
  switch (harness) {
    case 'claude':
      return ['-p', '--system-prompt-file', bundle, '--no-session-persistence', ...m, prompt];
    case 'codex':
      // -c takes TOML: a quoted string, so a Windows path's backslashes stay a path.
      return ['exec', '--ephemeral', '-c', `model_instructions_file=${JSON.stringify(bundle)}`, ...m, prompt];
    case 'pi':
      return ['-p', '--no-session', '-ne', '-nc', '--system-prompt', bundle, ...m, prompt];
    default:
      throw new StartFailed(`--harness ${JSON.stringify(harness)}: one of ${HARNESSES.join(', ')}`, 2);
  }
}

export function checkOptions(opts) {
  if (!opts.harness) throw new StartFailed(`--harness is required: one of ${HARNESSES.join(', ')}`, 2);
  if (!HARNESSES.includes(opts.harness)) throw new StartFailed(`--harness ${JSON.stringify(opts.harness)}: one of ${HARNESSES.join(', ')}`, 2);
  if (opts.model !== undefined && !MODEL.test(opts.model)) {
    throw new StartFailed('--model: a model id of letters, digits and . _ : / @ + - (not starting with -)', 2);
  }
  const prompt = opts.prompt ?? 'Start.';
  if (typeof prompt !== 'string' || prompt.trim() === '' || prompt.length > MAX_PROMPT || prompt.includes('\0')) {
    throw new StartFailed(`--prompt: some text, at most ${MAX_PROMPT} characters`, 2);
  }
  if (/^\s*-/.test(prompt)) throw new StartFailed('--prompt may not start with "-": the harness would read it as a flag', 2);
  return { harness: opts.harness, model: opts.model, prompt };
}

// ---------------------------------------------------------------------------------------------------
// Finding the harness.

const envPath = (env) => {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  return key ? env[key] ?? '' : '';
};

/**
 * Where `name` is on PATH, as { file, kind }: kind "exe" is started as it is, "cmd" is a Windows launcher.
 * Relative PATH folders (".", "") are skipped, and so is any file whose real path is inside a folder of `avoid`
 * (the project): a junction, a link or a short name that leads there is skipped too.
 */
export function findHarness(name, { env = process.env, platform = process.platform, avoid = [] } = {}) {
  // A network or device folder (\\host\share, \\?\..., //host) is skipped: its real path may lead back into the project.
  const dirs = envPath(env).split(platform === 'win32' ? ';' : delimiter).filter((d) => d && isAbsolute(d) && !netPath(d));
  const exts = platform === 'win32' ? ['.com', '.exe', '.bat', '.cmd'] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = join(dir, name + ext);
      let st;
      try {
        st = statSync(file);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (platform !== 'win32') {
        try {
          accessSync(file, constants.X_OK);
        } catch {
          continue;
        }
      }
      let realFile;
      try {
        realFile = realpathSync.native(file);
      } catch {
        continue;
      }
      if (netPath(realFile) || avoid.some((a) => inside(a, resolve(file)) || inside(a, realFile))) continue;
      return { file, kind: /\.(bat|cmd)$/i.test(ext) ? 'cmd' : 'exe' };
    }
  }
  return null;
}

/**
 * A Windows .cmd launcher, as the Node script it starts: the last quoted "%~dp0…js" or "%dp0%\…js" in it.
 * Null when it names none, or the script is not there.
 */
export function scriptOfLauncher(file) {
  let text;
  try {
    if (statSync(file).size > 64 * 1024) return null;
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const hits = [...text.matchAll(/"(?:%~dp0|%dp0%)\\?([^"%<>|&^\r\n]+\.[cm]?js)"/gi)];
  if (!hits.length) return null;
  const rel = hits.at(-1)[1];
  if (isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return null;
  const script = resolve(dirname(file), rel);
  try {
    if (!lstatSync(script).isFile()) return null;
  } catch {
    return null;
  }
  return script;
}

// What to spawn: [file, args]. Never a shell.
export function command(found, args, platform = process.platform) {
  if (found.kind === 'exe') return [found.file, args];
  const script = platform === 'win32' ? scriptOfLauncher(found.file) : null;
  if (!script) return null;
  return [process.execPath, [script, ...args]];
}

// The line as printed: each argument quoted when it holds a space or a sign a shell would read.
export const printed = (file, args) =>
  [file, ...args].map((a) => (/^[A-Za-z0-9_./\\:=@+,-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`)).map(oneLine).join(' ');

// ---------------------------------------------------------------------------------------------------
// The launch.

/**
 * Runs the start, then the harness. Returns the harness's exit code.
 * options: the command line's flags, plus project, env, platform, out (a line printer), spawnImpl, and
 * the start's own options (egressPlaces, fetch, now).
 */
export async function launch(roleArg, options = {}) {
  const project = resolve(options.project ?? process.cwd());
  const { harness, model, prompt } = checkOptions(options);
  const { root, dir, stats } = roleFolder(project, roleArg);
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const out = options.out ?? ((line) => console.log(line));
  const rel = (p) => relative(project, p).split(sep).join('/');

  // What the start will use, shown in the line your human approves.
  const hostsPath = hostsFile(project, dir, options.hosts);
  const reads = readList(dir, stats['reads.json']);
  const egressPath = findEgress(options.egress, options.egressPlaces ?? egressPlaces(), root);
  // Each secret the reads name, with the hosts it may go to: your human approves where it goes, not a file name.
  const where = (h, e) => oneLine(`in ${project} · hosts: ${h} · egress: ${e ?? 'none'}`);

  const found = findHarness(harness, { env, platform, avoid: [root] });
  if (!found) throw Object.assign(new StartFailed(`${harness} is not installed: no ${harness} on PATH`, 2), { oneLine: true });
  const placeholder = rel(join(dir, '.start', '<this start>.md'));
  const planned = command(found, harnessArgs(harness, placeholder, { model, prompt }), platform);
  if (!planned) {
    throw Object.assign(new StartFailed(`${found.file} is a launcher that names no Node script: start ${harness} yourself with the line in run-anywhere`, 2), { oneLine: true });
  }
  if (options['dry-run']) {
    out(`would run (${where(hostsShown(project, hostsPath, reads, egressPath ? await loadEgress(egressPath) : null), egressPath)}): ${printed(planned[0], planned[1])}`);
    out('dry run: nothing read, nothing started');
    return 0;
  }

  const { bundle, hostsLine, egress } = await start(roleArg, { ...options, project, launcher: harness });
  const [file, args] = command(found, harnessArgs(harness, bundle, { model, prompt }), platform);
  out(`start bundle: ${rel(bundle)}`);
  out(`run (${where(hostsLine, egress)}): ${printed(file, args)}`);
  const spawnImpl = options.spawnImpl ?? spawn;
  return new Promise((ok) => {
    const child = spawnImpl(file, args, { cwd: project, env, stdio: ['ignore', 'inherit', 'inherit'], shell: false, windowsHide: true });
    child.on('error', (e) => {
      console.error(`could not start ${harness}: ${oneLine(e.message)}`);
      ok(2);
    });
    child.on('close', (code, signal) => ok(code ?? (signal ? 1 : 0)));
  });
}

// ---------------------------------------------------------------------------------------------------
// The command line.

const USAGE = 'usage: node launch.mjs roles/<name> --harness claude|codex|pi [--model <id>] [--prompt "Start."] [--dry-run] [--hosts hosts.json] [--vars vars.json] [--egress <path>]';

async function main(argv) {
  if (argv[0] === '--self-test') {
    if (argv.length > 1) return usage('--self-test takes no other argument');
    const { selfTest } = await import(pathToFileURL(fileURLToPath(new URL('./launch.selftest.mjs', import.meta.url))).href);
    await selfTest();
    console.log('self-test ok');
    return 0;
  }
  let parsed;
  try {
    parsed = parseArgs(argv, ['harness', 'model', 'prompt', 'hosts', 'vars', 'egress', 'dry-run?']);
  } catch (e) {
    return usage(e.message);
  }
  if (parsed.rest.length !== 1) return usage('name one role folder');
  try {
    return await launch(parsed.rest[0], parsed.opts);
  } catch (e) {
    if (e instanceof StartFailed) {
      console.error(e.oneLine ? oneLine(e.message) : e.code === 2 ? `${oneLine(e.message)}\n${USAGE}` : `start failed: ${oneLine(e.message)}`);
      return e.code;
    }
    throw e;
  }
}

function usage(message) {
  console.error(`${oneLine(message)}\n${USAGE}`);
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`launch failed: ${oneLine(e?.message ?? e)}`);
      process.exitCode = 1;
    },
  );
}
