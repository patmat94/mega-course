// One-time setup: AgentMail inbox + webhook, then Worker secrets.
// Reads keys from .dev.vars (git-ignored) and never prints them.
// Usage: node scripts/provision.mjs <username> <worker-url>
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [username, workerUrl] = process.argv.slice(2);
if (!username || !workerUrl) {
  console.error("usage: node scripts/provision.mjs <username> <worker-url>");
  process.exitCode = 2;
} else {
  await main();
}

function readVars() {
  const vars = {};
  for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

function writeVars(vars) {
  writeFileSync(".dev.vars", Object.entries(vars).map(([k, v]) => `${k}="${v}"`).join("\n") + "\n");
}

async function am(key, method, path, body) {
  const res = await fetch(`https://api.agentmail.to/v0${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

function putSecret(name, value) {
  const r = spawnSync("npx", ["--no-install", "wrangler", "secret", "put", name], {
    input: value,
    encoding: "utf8",
    shell: true,
  });
  console.log(`secret ${name}: ${r.status === 0 ? "set" : "FAILED " + (r.stderr || "").slice(-200)}`);
}

async function main() {
  const vars = readVars();
  if (!vars.AGENTMAIL_API_KEY || !vars.ANTHROPIC_API_KEY) throw new Error(".dev.vars needs AGENTMAIL_API_KEY and ANTHROPIC_API_KEY");

  const me = await am(vars.AGENTMAIL_API_KEY, "GET", "/inboxes?limit=50");
  console.log(`list inboxes -> ${me.status}`);
  let inbox = (me.json.inboxes ?? []).find((i) => i.email === `${username}@agentmail.to` || i.inbox_id === `${username}@agentmail.to`);
  if (!inbox) {
    const r = await am(vars.AGENTMAIL_API_KEY, "POST", "/inboxes", { username, display_name: "mail agent", client_id: `mail-agent-${username}` });
    console.log(`create inbox -> ${r.status} ${r.json.email ?? JSON.stringify(r.json).slice(0, 300)}`);
    if (r.status >= 300) return;
    inbox = r.json;
  } else console.log(`inbox exists: ${inbox.email}`);

  const url = `${workerUrl.replace(/\/$/, "")}/webhooks`;
  const w = await am(vars.AGENTMAIL_API_KEY, "POST", `/inboxes/${encodeURIComponent(inbox.inbox_id)}/webhooks`, {
    url,
    event_types: ["message.received"],
    client_id: `mail-agent-hook-${username}`,
  });
  console.log(`create webhook -> ${w.status} ${w.json.webhook_id ?? JSON.stringify(w.json).slice(0, 300)} enabled=${w.json.enabled}`);
  if (w.status >= 300 || !w.json.secret) return;

  vars.AGENTMAIL_WEBHOOK_SECRET = w.json.secret;
  writeVars(vars);
  putSecret("AGENTMAIL_API_KEY", vars.AGENTMAIL_API_KEY);
  putSecret("ANTHROPIC_API_KEY", vars.ANTHROPIC_API_KEY);
  putSecret("AGENTMAIL_WEBHOOK_SECRET", vars.AGENTMAIL_WEBHOOK_SECRET);
  console.log(`INBOX_ID=${inbox.inbox_id} WEBHOOK_ID=${w.json.webhook_id}`);
}
