// One call to the course with the current ATTEMPT: node course.mjs <GET|POST> <path> [json-body-file]
// Appends {at, method, path, status, body} to course.jsonl on arrival and prints the reply, attempt masked.
import { readFileSync, appendFileSync } from 'node:fs';
const vars = JSON.parse(readFileSync(new URL('../mega-s04e01/starter/host-desk/vars.json', import.meta.url), 'utf8'));
const [method, path, file] = process.argv.slice(2);
const body = file ? readFileSync(file, 'utf8') : undefined;
const res = await fetch(`https://hq.mega.dev/challenges/looks-good-to-me/${path}`, {
  method, redirect: 'manual', body,
  headers: { Authorization: `Bearer ${vars.ATTEMPT}`, ...(body ? { 'content-type': 'application/json' } : {}) },
});
const text = await res.text();
appendFileSync(new URL('./course.jsonl', import.meta.url), JSON.stringify({ at: new Date().toISOString(), method, path, sent: body ? JSON.parse(body) : undefined, status: res.status, body: text }) + '\n');
console.log(res.status, text.split(vars.ATTEMPT).join('v1...(masked)'));
