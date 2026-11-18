// Posts this job's result to the board: this job's change (the output of `git diff`) from the top folder of this Host
// Desk or of this job's git worktree, the job id, and the model this role runs on (`RAN_ON`: the role's code tool sets
// it to the model Pi reports; run outside a role, it sends `RAN_ON` as set, else `unknown`).
//
//   code post-result.mjs <challenge url> <job id>
//
// The change = everything since the job started, committed or not: in a job's own worktree, since it branched from the
// Host Desk; in the Host Desk, since the commit before its first "merge <job id>" (merge-job.mjs), without those merges.
// New files are in it too (this script tells git about them first, nothing is staged). `vars.json` is never sent: it
// holds your secrets (keep it in `.gitignore`). Nor are `.env*`, `*.pem`, `*.key` files or `night/` (security review 2026-11-16 #12).
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mayReach } from '../extensions/hosts.mjs';

const [challengeUrl, job] = process.argv.slice(2);
if (!challengeUrl || !job) throw new Error('usage: post-result.mjs <challenge url> <job id>');
// The attempt goes to the course only: a host the attempt or the ticket may reach (hosts.json).
if (!mayReach('ATTEMPT', challengeUrl) && !mayReach('TICKET', challengeUrl)) throw new Error(`not sent: the attempt may not reach ${new URL(challengeUrl).host} (hosts.json)`);
const top = resolve(import.meta.dirname, '../../..');
const git = (...args) => execFileSync('git', ['-C', top, ...args], { encoding: 'utf8', maxBuffer: 1 << 22 });
const scope = ['--', '.', ':(exclude)vars.json', ':(exclude,glob)**/vars.json', ':(exclude,glob)**/.env*', ':(exclude,glob)**/*.pem', ':(exclude,glob)**/*.key', ':(exclude,glob)night/**'];
// New files: `git add -N` makes git know them without staging them, so `git diff` shows them.
const fresh = git('ls-files', '-z', '--others', '--exclude-standard', ...scope).split('\0').filter(Boolean);
if (fresh.length) git('add', '-N', '--', ...fresh);

const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
// The Host Desk = git's main worktree (the first one `git worktree list` names); a job's worktree is any other.
const [mainBlock] = git('worktree', 'list', '--porcelain').split(/\r?\n\r?\n/);
const mainPath = /^worktree (.+)$/m.exec(mainBlock)?.[1] ?? top;
const mainHead = /^HEAD ([0-9a-f]+)$/m.exec(mainBlock)?.[1];
const merge = (subject) => /^merge \S+$/.test(subject);
let diff;
if (!same(mainPath, git('rev-parse', '--show-toplevel').trim()) && mainHead) {
  // A job's own worktree: its change since it branched, committed or not.
  diff = git('diff', git('merge-base', 'HEAD', mainHead).trim(), ...scope);
} else {
  // The Host Desk: its own commits since the commit before the first merge, without the merges, + what is not committed.
  const log = git('log', '--reverse', '--no-merges', '--format=%H %s')
    .split('\n')
    .filter(Boolean)
    .map((l) => ({ sha: l.slice(0, l.indexOf(' ')), subject: l.slice(l.indexOf(' ') + 1).trim() }));
  const first = log.findIndex((c) => merge(c.subject));
  const own = first < 0 ? [] : log.slice(first).filter((c) => !merge(c.subject)).map((c) => c.sha);
  diff = [...own.map((c) => git('show', '--format=', '--binary', c, ...scope)), git('diff', 'HEAD', ...scope)].join('');
}
const ranOn = process.env.RAN_ON || 'unknown';
const res = await fetch(`${challengeUrl.replace(/\/$/, '')}/board/results`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.ATTEMPT}` },
  body: JSON.stringify({ job, diff, ranOn }),
});
console.log(res.status, await res.text());
