// Runs hands' check-tool.mjs on every tools/*.tool.md against a running tool-home, through the signed-in
// stdio entry (test/stdio-proxy.mjs), because check-tool does not sign in.
//
//   npm run check-tools -- <base-url>          prints each plan; nothing is started or sent
//   npm run check-tools -- <base-url> --yes    calls each tool for real with its good and wrong samples
//
// Exit code: the worst of check-tool's codes (0 all passed, 1 a check failed, 2 nothing sent, 3 it broke).
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("../", import.meta.url));
const checkTool = fileURLToPath(new URL("../../../.claude/skills/hands/scripts/check-tool.mjs", import.meta.url));
const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base)) {
  console.error("usage: npm run check-tools -- <base-url> [--yes]");
  process.exit(2);
}
const yes = process.argv.includes("--yes");
let worst = 0;
for (const spec of readdirSync(new URL("../tools/", import.meta.url)).filter((f) => f.endsWith(".tool.md")).sort()) {
  const args = [checkTool, "--spec", `tools/${spec}`, "--cmd", `node test/stdio-proxy.mjs ${base}`, "--timeout", "60"];
  if (yes) args.push("--yes");
  const r = spawnSync(process.execPath, args, { cwd: here, stdio: "inherit" });
  const code = r.status ?? 3;
  console.log(`-> ${spec}: exit ${code}\n`);
  worst = Math.max(worst, code === 0 ? 0 : code === 2 ? (yes ? 3 : 0) : code);
}
process.exitCode = worst;
