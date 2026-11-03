// End-to-end test: mail the agent from a tester inbox, wait for the reply in the same thread.
// Usage: node scripts/e2e.mjs send "<subject>" "<text>"   |   node scripts/e2e.mjs wait <thread_id>
import { readFileSync } from "node:fs";

const TESTER = "mail-agent-tester";
const AGENT = "patryk-mail-agent@agentmail.to";
const vars = Object.fromEntries(
  readFileSync(".dev.vars", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)\s*=\s*"?([^"]*)/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const secrets = [vars.AGENTMAIL_API_KEY, vars.ANTHROPIC_API_KEY, vars.AGENTMAIL_WEBHOOK_SECRET].filter(Boolean);

async function am(method, path, body) {
  const res = await fetch(`https://api.agentmail.to/v0${path}`, {
    method,
    headers: { Authorization: `Bearer ${vars.AGENTMAIL_API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  return { status: res.status, json: t ? JSON.parse(t) : {} };
}

const [cmd, a, b] = process.argv.slice(2);
const tester = `${TESTER}@agentmail.to`;

if (cmd === "send") {
  const list = await am("GET", "/inboxes?limit=50");
  if (!(list.json.inboxes ?? []).some((i) => i.inbox_id === tester)) {
    const c = await am("POST", "/inboxes", { username: TESTER, display_name: "tester", client_id: "mail-agent-tester" });
    console.log(`create tester -> ${c.status}`);
  }
  const s = await am("POST", `/inboxes/${tester}/messages/send`, { to: AGENT, subject: a, text: b });
  console.log(`send -> ${s.status} message_id=${s.json.message_id} thread_id=${s.json.thread_id} at ${new Date().toISOString()}`);
} else if (cmd === "wait") {
  const start = Date.now();
  while (Date.now() - start < 10 * 60 * 1000) {
    const t = await am("GET", `/inboxes/${tester}/threads/${encodeURIComponent(a)}`);
    const reply = (t.json.messages ?? []).find((m) => (m.from ?? "").includes(AGENT));
    if (reply) {
      const body = reply.text ?? reply.extracted_text ?? "";
      console.log(`reply after ${Math.round((Date.now() - start) / 1000)}s (since wait start), thread ${reply.thread_id}, in_reply_to=${reply.in_reply_to ? "set" : "none"}`);
      console.log(`secret in reply: ${secrets.some((s) => body.includes(s)) ? "YES" : "no"}`);
      console.log("---\n" + body);
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  console.log("no reply within 10 minutes");
} else if (cmd === "delete") {
  const d = await am("DELETE", `/inboxes/${tester}`);
  console.log(`delete tester -> ${d.status}`);
}
