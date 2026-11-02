// PreToolUse gate for mcp__mega-challenge__claim-challenge.
// Finds the lesson folder whose receipts.json holds the claimed uuid as challengeId,
// then denies the claim while any Acceptance line in its ticket.md is unticked.
// A line marked "(after claim)" is skipped: it can only be ticked once the claim answers.
// Any error denies too, so a broken gate never lets a claim through.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function decide(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function findLesson(uuid) {
  for (const dir of readdirSync(root)) {
    if (!/^mega-s\d\de\d\d$/.test(dir)) continue;
    const file = join(root, dir, "receipts.json");
    if (!existsSync(file)) continue;
    try {
      const r = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
      if ((r.challengeId || "").toLowerCase() === uuid) return dir;
    } catch {}
  }
  return null;
}

function unticked(ticket) {
  const lines = ticket.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Acceptance\b/i.test(l));
  if (start < 0) return null;
  const open = [];
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
    const l = lines[i];
    if (/^\s*[-*]\s+\[ \]/.test(l) && !/\(after claim\)/i.test(l)) open.push(l.trim());
  }
  return open;
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const uuid = String(input.tool_input?.uuid || "").toLowerCase();
  const dir = findLesson(uuid);
  if (!dir) decide("deny", `Claim gate: no mega-sXXeYY/receipts.json has challengeId ${uuid}. Write it there (challenge-start step 1) before claiming.`);
  const ticketPath = join(root, dir, "ticket.md");
  if (!existsSync(ticketPath)) decide("deny", `Claim gate: ${dir}/ticket.md is missing. Write it with an Acceptance section before claiming.`);
  const open = unticked(readFileSync(ticketPath, "utf8"));
  if (open === null) decide("deny", `Claim gate: ${dir}/ticket.md has no "## Acceptance" section.`);
  if (open.length) decide("deny", `Claim gate: ${open.length} Acceptance line(s) in ${dir}/ticket.md are not ticked. Check each against the real result, tick it, then claim again:\n${open.join("\n")}`);
  // Pass: no permission decision, so the normal permission rules still apply.
  process.stdout.write(JSON.stringify({
    systemMessage: `Claim gate: every Acceptance line in ${dir}/ticket.md is ticked.`,
  }));
  process.exit(0);
} catch (e) {
  decide("deny", `Claim gate failed, so the claim is held: ${e.message}`);
}
