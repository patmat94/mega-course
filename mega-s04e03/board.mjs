// GET /board with ATTEMPT from the Host Desk vars; appends the reply to board.jsonl, prints it.
import { readFileSync, appendFileSync } from 'node:fs';
const vars = JSON.parse(readFileSync(new URL('../mega-s04e01/starter/host-desk/vars.json', import.meta.url), 'utf8'));
const res = await fetch('https://hq.mega.dev/challenges/three-small-changes/board', { headers: { Authorization: `Bearer ${vars.ATTEMPT}` }, redirect: 'manual' });
const text = await res.text();
appendFileSync(new URL('./board.jsonl', import.meta.url), JSON.stringify({ at: new Date().toISOString(), status: res.status, body: text }) + '\n');
let j; try { j = JSON.parse(text); console.log(res.status, JSON.stringify(j, null, 2)); } catch { console.log(res.status, text); }
