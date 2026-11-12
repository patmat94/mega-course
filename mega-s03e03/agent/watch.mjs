// S03E03 watcher: reads the tracker every POLL_MS, acknowledges each new issue at once (no model),
// and runs one headless `claude -p` per issue (one at a time) when an issue is new or its thread
// gained an entry not written by the agent (an owner /answer, a course comment).
// State: run/state.json. Logs: run/watch.log, run/tracker.log, run/runs/*.json.
// Env: REPO (the API repo folder), LIVE_URL, POLL_MS, ONCE=1 (one poll then exit when idle).
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { call } from './tracker.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const runDir = resolve(process.env.RUN_DIR || join(here, '..', 'run'));
const repo = resolve(process.env.REPO || join(here, '..', 'sched-prod-api'));
const live = process.env.LIVE_URL || 'https://sched-prod-api-production.patrykmatychniak.workers.dev';
const POLL_MS = Number(process.env.POLL_MS || 30000);
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS || 20 * 60000);
const skill = resolve(here, '..', '..', '.agents', 'skills', 'triage', 'SKILL.md');
const scratch = join(runDir, 'scratch');
mkdirSync(join(runDir, 'runs'), { recursive: true });
mkdirSync(scratch, { recursive: true });

const statePath = join(runDir, 'state.json');
let state = { issues: {} };
try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch {}
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); appendFileSync(join(runDir, 'watch.log'), l + '\n'); };

const queue = [];          // issue numbers waiting for a worker run
let running = null;        // issue number being worked

function enqueue(n, reason) {
  const s = state.issues[n];
  s.pendingReason = s.pendingReason ? `${s.pendingReason}; ${reason}` : reason;
  if (!queue.includes(n) && running !== n) queue.push(n);
  save();
}

async function poll() {
  const { status, data } = await call('GET', '/issues', undefined, 'watcher');
  if (status !== 200 || !data?.issues) { log(`poll failed: HTTP ${status}`); return; }
  for (const is of data.issues) {
    const n = is.n;
    let s = state.issues[n];
    if (!s) {
      s = state.issues[n] = { seenAt: new Date().toISOString(), handledThread: 0, runs: 0 };
      save();
      const r = await call('POST', `/issues/${n}/comments`, {
        body: `Picked up by the agent at ${new Date().toISOString()}. Working #${n} now from the owner's triage skill; the result and the ship line follow here.`,
      }, 'watcher');
      s.ackStatus = r.status; s.ackAt = new Date().toISOString(); save();
      log(`#${n} new ("${is.title}") ack HTTP ${r.status}`);
      enqueue(n, 'new issue');
      continue;
    }
    // New entries in the thread that the agent did not write.
    const thread = is.thread || [];
    const fresh = thread.slice(s.handledThread || 0).filter((e) => e.by !== 'agent');
    if (fresh.length && running !== n && !queue.includes(n)) {
      const what = fresh.map((e) => `${e.by} ${e.kind}${e.body ? `: ${e.body.slice(0, 200)}` : e.label ? ` ${e.label}` : ''}`).join(' | ');
      log(`#${n} new thread entries: ${what}`);
      enqueue(n, `new in the thread since your last run: ${what}`);
    }
  }
  state.lastPoll = { at: new Date().toISOString(), count: data.issues.length, lastIssueBy: data.lastIssueBy };
  save();
}

function runWorker(n) {
  return new Promise(async (done) => {
    const s = state.issues[n];
    const reason = s.pendingReason || 'rerun';
    s.pendingReason = null; s.runs = (s.runs || 0) + 1; save();
    // Thread length now: entries after this are new for the next run.
    const cur = await call('GET', `/issues/${n}`, undefined, 'watcher');
    const before = cur.data?.thread?.length ?? s.handledThread;
    const prompt = readFileSync(join(here, 'prompt.md'), 'utf8')
      .replaceAll('{{n}}', String(n)).replaceAll('{{reason}}', reason)
      .replaceAll('{{skill}}', skill).replaceAll('{{repo}}', repo)
      .replaceAll('{{tracker}}', join(here, 'tracker.mjs')).replaceAll('{{livecheck}}', join(here, 'livecheck.mjs'))
      .replaceAll('{{scratch}}', scratch.replaceAll('\\', '/')).replaceAll('{{live}}', live);
    const args = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits',
      '--add-dir', runDir, '--add-dir', here,
      '--allowedTools', 'Read,Edit,Write,Glob,Grep,Skill,Bash(node:*),Bash(git:*),Bash(npx --no-install wrangler deploy:*),Bash(ls:*),Bash(cat:*)',
      '--disallowedTools', 'WebFetch,WebSearch,Bash(curl:*),Bash(npx --no-install wrangler secret:*),Bash(npx --no-install wrangler delete:*)'];
    if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL);
    const started = Date.now();
    log(`#${n} worker run ${s.runs} start (${reason.slice(0, 160)})`);
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, { cwd: repo, env: { ...process.env, TRACKER_WHO: `agent#${n}` }, shell: false });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    const t = setTimeout(() => { log(`#${n} worker timeout, killing`); child.kill(); }, RUN_TIMEOUT_MS);
    child.on('close', async (code) => {
      clearTimeout(t);
      const file = join(runDir, 'runs', `${n}-${s.runs}-${started}.json`);
      writeFileSync(file, out + (err ? `\n--- stderr\n${err}` : ''));
      let result = '';
      try { result = JSON.parse(out).result || ''; } catch {}
      const last = result.trim().split('\n').pop();
      log(`#${n} worker run ${s.runs} exit ${code} in ${Math.round((Date.now() - started) / 1000)} s: ${last}`);
      // Every thread entry up to now was either before the run or written during it; the agent's own
      // entries are skipped anyway, so mark as handled only what existed before plus agent entries.
      const after = await call('GET', `/issues/${n}`, undefined, 'watcher');
      const th = after.data?.thread || [];
      let k = before;
      while (k < th.length && th[k].by === 'agent') k++;
      s.handledThread = k; s.lastResult = last; s.lastExit = code; save();
      if (k < th.length) enqueue(n, 'entries arrived during the last run');
      done();
    });
  });
}

async function loop() {
  log(`watcher up: repo ${repo}, live ${live}, poll ${POLL_MS} ms`);
  for (;;) {
    try { await poll(); } catch (e) { log(`poll error: ${e.message}`); }
    if (!running && queue.length) {
      running = queue.shift();
      runWorker(running).catch((e) => log(`worker error: ${e.message}`)).finally(() => { running = null; });
    }
    if (process.env.ONCE && !running && !queue.length) { log('idle, ONCE set: exit'); return; }
    await new Promise((r) => setTimeout(r, running ? Math.min(POLL_MS, 15000) : POLL_MS));
  }
}
loop();
