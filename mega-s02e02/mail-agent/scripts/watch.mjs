// Watch the agent inbox until a mail from rook@mail.mega.dev has a reply from the agent (max 15 min).
import { readFileSync } from "node:fs";
const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)\s*=\s*"?([^"]*)/)).filter(Boolean).map((m) => [m[1], m[2]]));
const INBOX = "patryk-mail-agent@agentmail.to";
const get = (p) => fetch(`https://api.agentmail.to/v0${p}`, { headers: { Authorization: `Bearer ${vars.AGENTMAIL_API_KEY}` } }).then((r) => r.json());
const start = Date.now();
while (Date.now() - start < 15 * 60 * 1000) {
  const list = await get(`/inboxes/${INBOX}/threads?limit=20`);
  for (const th of list.threads ?? []) {
    if (!(th.senders ?? []).some((s) => s.includes("rook@mail.mega.dev"))) continue;
    const t = await get(`/inboxes/${INBOX}/threads/${th.thread_id}`);
    const msgs = t.messages ?? [];
    const rook = msgs.filter((m) => m.from.includes("rook@mail.mega.dev"));
    const mine = msgs.filter((m) => m.from.includes(INBOX));
    if (rook.length && mine.length >= rook.length) {
      for (const m of msgs) console.log(`--- ${m.timestamp} ${m.from}\n${(m.extracted_text ?? m.text ?? "").slice(0, 2500)}`);
      process.exit(0);
    }
  }
  await new Promise((r) => setTimeout(r, 15000));
}
console.log("no answered rook thread within 15 minutes");
