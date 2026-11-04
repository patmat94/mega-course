// Daily mega start: the first session of the day opens with "mega start".
// SessionStart: if mega-start has not run today (local date), add a note to the agent's context
// asking it to run mega start before the human's first request. Later sessions that day stay quiet.
// PostToolUse on mcp__mega-challenge__mega-start: write today's date, so the note stops.
// The stamp is written only when mega-start runs, so a session closed without a message
// leaves the note for the next one. State lives in .claude/state/ (gitignored).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const stateDir = join(root, '.claude', 'state');
const stampFile = join(stateDir, 'daily-mega-start.txt');
const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, local time

const PASS = '{}';
const readText = (p) => {
  try {
    return readFileSync(p, 'utf8').replace(/^﻿/, '').trim();
  } catch {
    return '';
  }
};

const NOTE =
  `Daily mega start: it has not run today (${today}). Before you answer the human's first message, ` +
  `run mega start as CLAUDE.md and the mega-challenge server describe: call mcp__mega-challenge__mega-start, ` +
  `brief the human as its reply instructs, and save the brief with save-brief. Then turn to their message. ` +
  `If the mega-challenge tools are not available, say so in one line and go on with their message.`;

function run() {
  const input = JSON.parse(readText(0) || '{}');
  if (input.hook_event_name === 'PostToolUse') {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(stampFile, today);
    return PASS;
  }
  if (input.hook_event_name === 'SessionStart') {
    if (input.source === 'compact' || readText(stampFile) === today) return PASS;
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: NOTE } });
  }
  return PASS;
}

let out = PASS;
try {
  out = run();
} catch {}
process.stdout.write(out);
