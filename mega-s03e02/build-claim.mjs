// Builds the claim answer { session, tracker, skill } into claim-answer.json and prints its size.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, 'sched-prod', 'sched-prod');
const { receipts } = JSON.parse(readFileSync(join(HERE, 'receipts.json'), 'utf8').replace(/^﻿/, ''));
const files = readdirSync(join(KIT, 'doc', 'issues')).filter((f) => f.endsWith('.md')).sort()
  .map((f) => ({ path: `doc/issues/${f}`, text: readFileSync(join(KIT, 'doc', 'issues', f), 'utf8') }));
const skillPath = '.agents/skills/triage/SKILL.md';
const answer = {
  session: receipts.session,
  tracker: { kind: 'md', files },
  skill: { name: 'triage', path: skillPath, text: readFileSync(join(HERE, '..', skillPath), 'utf8') },
};
const out = JSON.stringify(answer);
writeFileSync(join(HERE, 'claim-answer.json'), out);
console.log(`files ${files.length} · bytes ${Buffer.byteLength(out)} (limit 262144)`);
