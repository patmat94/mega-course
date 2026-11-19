// watch.mjs · turns heartbeat rows into tasks. Plain code, no model: it reads the rows heartbeat.mjs appended since its
// bookmark, matches each one against the hooks in hooks.json, and for every match opens one task in tasks.jsonl.
// The task id is the hook's dedupe key (worker + the row's UTC date), so a second down row for the same Worker on the
// same day stays one task: the hook fires once per id. A hook past its `expires` date never fires.
//
//   node agents/heartbeat/watch.mjs            report only: prints what it would do, writes nothing (the default)
//   node agents/heartbeat/watch.mjs --apply    appends the tasks, then moves the bookmark past the rows it read
//   --dir <folder>                             read and write there instead of this folder (tests)
//
// Files (in the folder): heartbeat.jsonl (read), hooks.json (read), tasks.jsonl (one line per task, appended on
// arrival, ADR 0014), watch-state.json (the bookmark: how many heartbeat lines were already read).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const readLines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()) : []);

/** Does this hook's condition hold for this row? Only `{ field, equals }` for now. */
export function holds(condition, row) {
  return Object.hasOwn(row, condition.field) && row[condition.field] === condition.equals;
}

/** The task id a hook gives a row. */
export function dedupeId(hook, row) {
  if (hook.response.dedupe === 'worker+date') return `${hook.id}:${row.worker}:${String(row.at).slice(0, 10)}`;
  throw new Error(`hook ${hook.id}: unknown dedupe "${hook.response.dedupe}"`);
}

/**
 * The tasks to open for these rows. Pure: the caller decides whether to write them.
 * rows: [{ line, row }] (line = 1-based line in heartbeat.jsonl); hooks: hooks.json's list; known: ids already in
 * tasks.jsonl; now: Date, for expiry and `opened`.
 */
export function plan(rows, hooks, known, now = new Date()) {
  const seen = new Set(known);
  const tasks = [];
  const skipped = [];
  for (const { line, row } of rows) {
    for (const hook of hooks) {
      if (hook.expires && now.toISOString().slice(0, 10) > hook.expires) continue;
      if (!holds(hook.condition, row)) continue;
      const id = dedupeId(hook, row);
      if (seen.has(id)) {
        skipped.push({ id, line, why: 'already a task' });
        continue;
      }
      seen.add(id);
      tasks.push({
        id,
        hook: hook.id,
        job: hook.owner,
        owner: hook.response.taskOwner,
        worker: row.worker,
        at: row.at,
        why: row.why || `status ${row.status}`,
        url: row.url,
        source: `heartbeat.jsonl:${line}`,
        note: hook.note,
        opened: now.toISOString(),
        state: 'open',
      });
    }
  }
  return { tasks, skipped };
}

/** Reads the folder, plans, and with apply writes the tasks and the bookmark. Returns what it found. */
export function run(dir, { apply = false, now = new Date() } = {}) {
  const lines = readLines(join(dir, 'heartbeat.jsonl'));
  const statePath = join(dir, 'watch-state.json');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { read: 0 };
  const rows = lines.slice(state.read).map((l, i) => ({ line: state.read + i + 1, row: JSON.parse(l) }));
  const { hooks } = JSON.parse(readFileSync(join(dir, 'hooks.json'), 'utf8'));
  const known = readLines(join(dir, 'tasks.jsonl')).map((l) => JSON.parse(l).id);
  const { tasks, skipped } = plan(rows, hooks, known, now);
  if (apply) {
    for (const t of tasks) appendFileSync(join(dir, 'tasks.jsonl'), JSON.stringify(t) + '\n');
    writeFileSync(statePath, JSON.stringify({ read: lines.length, at: now.toISOString() }, null, 2) + '\n');
  }
  return { read: rows.length, from: state.read + 1, tasks, skipped };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const at = args.indexOf('--dir');
  const dir = at >= 0 ? resolve(args[at + 1]) : dirname(fileURLToPath(import.meta.url));
  const r = run(dir, { apply });
  const verb = apply ? 'opened' : 'would open';
  console.log(`read ${r.read} new heartbeat row(s) from line ${r.from}`);
  for (const t of r.tasks) console.log(`${verb} task ${t.id} · owner ${t.owner} · ${t.worker} down at ${t.at}: ${t.why} (${t.source})`);
  for (const s of r.skipped) console.log(`skip heartbeat.jsonl:${s.line} · ${s.id}: ${s.why}`);
  console.log(`${r.tasks.length} task(s) ${verb}${apply ? '; bookmark moved' : '; nothing written (run with --apply to do it)'}`);
}
