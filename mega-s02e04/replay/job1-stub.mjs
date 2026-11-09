#!/usr/bin/env node
// job1-stub.mjs: a stdio MCP server that replays S02E04 job 1 (incident-lookup) from the replies
// recorded in mega-s02e04/log.txt, so the job-1 worker step can be rerun after the course's job link
// expired (2026-11-07). Plain Node 18+, no packages, no network. Every tools/call is appended to
// stub-calls.jsonl (or $STUB_LOG) so the call count does not rest on the transcript alone.
//
// It mirrors the course's reply shapes (one text item holding JSON), not the hands contract: a replay
// has to look like the original run, or the comparison means nothing. Replies a run could need that
// the log did not record (the archive scope, a wrong step, reading crew) are marked "synthetic".

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const here = dirname(fileURLToPath(import.meta.url));
const LOG = process.env.STUB_LOG ?? resolve(here, 'stub-calls.jsonl');
const SKILL = readFileSync(resolve(here, '../skills-dl/incident-lookup/incident-lookup/SKILL.md'), 'utf8');

// --- recorded data (mega-s02e04/log.txt, job 1 worker final message) ---
const LIVE = [
  { id: 'inc-3106', title: 'tram-5 · door sensor fault · 2026-10-31' },
  { id: 'inc-3107', title: 'tram-3 · display data timeout · 2026-10-31' },
];
const RECORD = {
  date: '2026-10-31',
  time: '22:50',
  clock: 'US Eastern',
  line: 'tram-3',
  cause: 'display data timed out at the depot controller; reported by D. Lindqvist',
};
const OTHER = { date: '2026-10-31', time: '21:12', clock: 'US Eastern', line: 'tram-5', cause: 'rear door sensor fault, car held at the depot' }; // synthetic
const ARCHIVE = [{ id: 'arc-0412', title: 'tram-3 · display drill · 2025-10-30' }]; // synthetic

const TOOLS = [
  {
    name: 'search',
    description: 'Search the incident log. Returns matching entries and a step token.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, scope: { type: 'string', description: 'ops/live or archive (default archive)' } }, required: ['query'] },
  },
  {
    name: 'read',
    description: 'Read named fields of one incident. Needs the step token from the last call.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } }, step: { type: 'string' } }, required: ['id', 'fields', 'step'] },
  },
  {
    name: 'redact',
    description: 'Remove personal names from a text. Needs the step token from the last call.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, step: { type: 'string' } }, required: ['text', 'step'] },
  },
  {
    name: 'submit',
    description: 'Hand in the redacted result. Needs the step token from the last call.',
    inputSchema: { type: 'object', properties: { result: { type: 'string' }, skillVersion: { type: 'string' }, step: { type: 'string' } }, required: ['result', 'skillVersion', 'step'] },
  },
];

let stepNo = 0;
let expectedStep = null;
let lastRedacted = null;
const nextStep = () => (expectedStep = `step-${++stepNo}-replay`);
const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });

function call(name, a = {}) {
  if (name !== 'search' && a.step !== expectedStep) return fail(`step: "${a.step}" is not the token from your last call. Start again from search.`); // synthetic
  switch (name) {
    case 'search':
      return ok({ entries: a.scope === 'ops/live' ? LIVE : ARCHIVE, step: nextStep() });
    case 'read': {
      const rec = a.id === 'inc-3107' ? RECORD : a.id === 'inc-3106' ? OTHER : null;
      if (!rec) return fail(`id: "${a.id}" is not in this scope. Use an id from the last search.`); // synthetic
      if ((a.fields ?? []).includes('crew')) return fail('fields: crew cannot be read on this job. Leave it out.'); // synthetic
      const fields = Object.fromEntries((a.fields ?? []).filter((f) => f in rec).map((f) => [f, rec[f]]));
      return ok({ id: a.id, fields, step: nextStep() });
    }
    case 'redact':
      lastRedacted = String(a.text ?? '').replace(/D\. Lindqvist/g, '[redacted]');
      return ok({ text: lastRedacted, step: nextStep() });
    case 'submit':
      if (a.result !== lastRedacted) return fail('result: send exactly the text redact returned.'); // synthetic
      if (a.skillVersion !== '1') return fail('skillVersion: send "1".'); // synthetic
      return ok({ status: 'accepted', result: a.result, receipt: 'v1.REPLAY-STUB-NOT-A-COURSE-RECEIPT' });
    default:
      return fail(`name: no tool "${name}". Tools: search, read, redact, submit.`);
  }
}

function handle(msg) {
  const { id, method, params = {} } = msg;
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: params.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'job1-replay-stub', version: '1' },
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'resources/list':
      return { resources: [{ uri: 'skill://incident-lookup/SKILL.md', name: 'incident-lookup', mimeType: 'text/markdown' }] };
    case 'resources/read':
      return { contents: [{ uri: params.uri, mimeType: 'text/markdown', text: SKILL }] };
    case 'tools/call': {
      const result = call(params.name, params.arguments);
      appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), tool: params.name, arguments: params.arguments, isError: !!result.isError })}\n`);
      return result;
    }
    default:
      if (id === undefined) return undefined; // a notification
      throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return void handle(msg);
  try {
    const result = handle(msg);
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n`);
  } catch (e) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32603, message: e.message } })}\n`);
  }
});
