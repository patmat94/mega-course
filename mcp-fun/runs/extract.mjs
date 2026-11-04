// Prints, per run: model, every tool call with args, a short result digest, and the final answer.
// Usage: node extract.mjs 01.jsonl 02.jsonl ...
import { readFileSync } from "node:fs";
for (const f of process.argv.slice(2)) {
  const lines = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  console.log(`\n===== ${f}`);
  const init = lines.find((l) => l.type === "system" && l.subtype === "init");
  if (init) console.log(`model=${init.model} mcp=${JSON.stringify(init.mcp_servers)} tools=${init.tools.filter((t) => t.startsWith("mcp__")).join(",")}`);
  let k = 0;
  for (const l of lines) {
    for (const c of l.message?.content ?? []) {
      if (c.type === "tool_use") console.log(`#${++k} CALL ${c.name} ${JSON.stringify(c.input)}`);
      if (c.type === "tool_result") {
        const t = typeof c.content === "string" ? c.content : (c.content ?? []).map((x) => x.text ?? "").join("");
        let digest = t.slice(0, 160).replace(/\s+/g, " ");
        try {
          const j = JSON.parse(t);
          digest = `place=${j.place?.name ?? ""}/${j.place?.country ?? ""} date=${j.date ?? ""} next=${JSON.stringify(j.next_call?.tool)}:${JSON.stringify(j.next_call?.arguments)}`;
        } catch {}
        console.log(`   RESULT ${c.is_error ? "ERROR " : ""}${digest}`);
      }
      if (c.type === "text" && l.type === "assistant") console.log(`   TEXT ${c.text.slice(0, 300).replace(/\s+/g, " ")}`);
    }
    if (l.type === "result") console.log(`   END turns=${l.num_turns} cost=$${l.total_cost_usd?.toFixed(3)}`);
  }
}
