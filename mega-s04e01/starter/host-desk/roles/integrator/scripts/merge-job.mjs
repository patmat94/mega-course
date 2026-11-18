// Brings one job's change into this Host Desk and commits it as "merge <job id>": that job's change in its git worktree
// (everything since it branched from this Host Desk, committed or not, new files too), applied here. Your own result
// (post-result.mjs) leaves these merge commits out, so a merged job's change is not in it.
//
//   code merge-job.mjs <job folder> <job id>        e.g. code merge-job.mjs ../host-desk-w-1 w-1
//
// <job folder>: the top folder of that job's worktree, from this Host Desk's top folder. `vars.json` is never read.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const [folder, job] = process.argv.slice(2);
if (!folder || !job) throw new Error('usage: merge-job.mjs <job folder> <job id>');
const top = resolve(import.meta.dirname, '../../..');
const from = resolve(top, folder);
const git = (cwd, args, input) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 1 << 22, stdio: ['pipe', 'pipe', 'pipe'], ...(input === undefined ? {} : { input }) });

// Only one of this Host Desk's own git worktrees (`git worktree list`), never another repository (security review 2026-11-16 #13).
const key = (p) => {
  let r = resolve(p);
  try {
    r = realpathSync.native(r);
  } catch {
    // not there: compared as written
  }
  return process.platform === 'win32' ? r.toLowerCase() : r;
};
const worktrees = git(top, ['worktree', 'list', '--porcelain']).split(/\r?\n/).filter((l) => l.startsWith('worktree ')).map((l) => key(l.slice('worktree '.length)));
if (key(from) === key(top) || !worktrees.includes(key(from))) {
  console.log(`${folder} is not a git worktree of this Host Desk: make it with \`git worktree add\` from its top folder.`);
  process.exit(1);
}

const scope = ['--', '.', ':(exclude)vars.json', ':(exclude,glob)**/vars.json', ':(exclude,glob)**/.env*', ':(exclude,glob)**/*.pem', ':(exclude,glob)**/*.key', ':(exclude,glob)night/**'];
// New files there: `git add -N` makes git know them without staging them, so `git diff HEAD` shows them.
const fresh = git(from, ['ls-files', '-z', '--others', '--exclude-standard', ...scope]).split('\0').filter(Boolean);
if (fresh.length) git(from, ['add', '-N', '--', ...fresh]);
// That job's change since it branched from this Host Desk, committed or not.
const base = git(from, ['merge-base', 'HEAD', git(top, ['rev-parse', 'HEAD']).trim()]).trim();
const paths = git(from, ['diff', '--name-only', base, ...scope]).split('\n').filter(Boolean);
if (!paths.length) {
  console.log(`No change in ${folder}: nothing to merge.`);
  process.exit(1);
}
try {
  git(top, ['apply', '--3way', '--whitespace=nowarn'], git(from, ['diff', '--binary', base, ...scope]));
} catch (e) {
  console.log(`The change of ${job} does not apply cleanly here:\n${e.stderr || e.message}`);
  process.exit(1);
}
git(top, ['add', '--', ...paths]);
try {
  git(top, ['diff', '--cached', '--quiet', '--', ...paths]);
  console.log(`${job} is already merged: its change is in this Host Desk.`);
  process.exit(0);
} catch {
  // staged changes: commit them
}
git(top, ['commit', '-q', '-m', `merge ${job}`, '--', ...paths]);
console.log(`Merged ${job}: ${paths.join(', ')}`);
