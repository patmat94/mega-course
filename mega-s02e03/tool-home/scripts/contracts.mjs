// Copies each tool's contract from tools/<name>.tool.md (the hands TOOL.md) into src/contracts.json,
// which the server lists. TOOL.md is the source: change it, run `npm run contracts`, then the code.
// With --check it writes nothing and exits 1 when src/contracts.json is out of date.
import { readFileSync, writeFileSync } from "node:fs";

const ORDER = ["memo_write", "memo_search", "upload", "transcribe"];
const root = new URL("../", import.meta.url);

function blocks(lines) {
  const out = {};
  let open = null, body = [];
  for (const line of lines) {
    if (open === null) { open = /^```json[ \t]+([a-z-]+)[ \t]*$/.exec(line)?.[1] ?? null; body = []; }
    else if (/^```[ \t]*$/.test(line)) { out[open] = JSON.parse(body.join("\n")); open = null; }
    else body.push(line);
  }
  return out;
}

// The first paragraph under "## Description", whitespace flattened: what check-tool compares.
function description(lines) {
  const at = lines.findIndex((l) => /^##\s+Description\s*$/.test(l));
  if (at < 0) throw new Error("no ## Description");
  const after = lines.slice(at + 1);
  const from = after.findIndex((l) => l.trim());
  const to = after.findIndex((l, i) => i > from && (!l.trim() || l.startsWith("#")));
  return after.slice(from, to < 0 ? undefined : to).join(" ").replace(/\s+/g, " ").trim();
}

const contracts = ORDER.map((name) => {
  const lines = readFileSync(new URL(`tools/${name}.tool.md`, root), "utf8").split(/\r?\n/);
  const b = blocks(lines);
  if (b.check?.tool !== name) throw new Error(`tools/${name}.tool.md: check.tool is not ${name}`);
  return { name, description: description(lines), inputSchema: b["input-schema"], outputSchema: b["output-schema"] };
});

const text = `${JSON.stringify(contracts, null, 2)}\n`;
const target = new URL("src/contracts.json", root);
if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(target, "utf8"); } catch {}
  if (current.replace(/\r\n/g, "\n") !== text) { console.error("src/contracts.json is out of date: run npm run contracts"); process.exitCode = 1; }
  else console.log("src/contracts.json matches tools/*.tool.md");
} else {
  writeFileSync(target, text);
  console.log(`wrote src/contracts.json (${contracts.length} tools)`);
}
