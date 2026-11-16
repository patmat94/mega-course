// Prints a Pi --mode json run as one line per tool call and result, plus assistant text.
// usage: node summarize-run.mjs runs/run1.jsonl [maxChars]
import { readFileSync } from 'node:fs';
const [file, max = '600'] = process.argv.slice(2);
const cut = (s) => (s.length > +max ? s.slice(0, +max) + '…' : s);
for (const line of readFileSync(file, 'utf8').replace(/^﻿/, '').trim().split('\n')) {
  let e; try { e = JSON.parse(line.replace(/^﻿/, '')); } catch { continue; }
  if (e.type === 'tool_execution_start') console.log(`> ${e.toolName} ${cut(JSON.stringify(e.args))}`);
  else if (e.type === 'tool_execution_end') {
    const t = (e.result?.content ?? []).map((c) => c.text ?? '').join('');
    console.log(`< ${cut(t.replace(/\s+/g, ' '))}`);
  } else if (e.type === 'message_end' && e.message?.role === 'assistant') {
    const t = (e.message.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    if (t.trim()) console.log(`# ${cut(t.replace(/\s+/g, ' '))}`);
    if (e.message.stopReason && e.message.stopReason !== 'toolUse') console.log(`# stop: ${e.message.stopReason} ${e.message.errorMessage ?? ''}`);
  }
}
