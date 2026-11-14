// PreToolUse gate for mcp__mega-challenge__claim-challenge.
// Finds the lesson folder whose receipts.json holds the claimed uuid as challengeId,
// then denies the claim while any Acceptance line in its ticket.md is unticked,
// or while a ticked line does not end with evidence that exists (ADR 0013):
//   - [x] <check> · evidence: log.txt:47, check-helped.mjs
// A pointer is a path (file or folder) or path:N (line N exists and is not blank).
// Paths resolve from the lesson folder first, then the repo root, and must stay inside the repo.
// A line marked "(after claim)" is skipped: it can only be ticked once the claim answers.
// Any error denies too, so a broken gate never lets a claim through.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";

const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

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

function acceptanceLines(ticket) {
  const lines = ticket.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Acceptance\b/i.test(l));
  if (start < 0) return null;
  const out = [];
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
    const m = /^\s*[-*]\s+\[( |x|X)\]\s*(.*)$/.exec(lines[i]);
    if (!m || /\(after claim\)/i.test(m[2])) continue;
    out.push({ ticked: m[1] !== " ", text: m[2].trim(), lineNo: i + 1 });
  }
  return out;
}

// Returns null when the pointer holds, or a short reason when it does not.
function checkPointer(lessonDir, pointer) {
  const m = /^(.+?)(?::(\d+))?$/.exec(pointer);
  const path = m[1].replace(/^`|`$/g, "");
  const lineNo = m[2] ? Number(m[2]) : null;
  if (isAbsolute(path)) return `${pointer}: use a path inside the repo, not an absolute one`;
  const candidates = [resolve(lessonDir, path), resolve(root, path)];
  const found = candidates.find((p) => {
    const rel = relative(root, p);
    return !rel.startsWith("..") && !isAbsolute(rel) && existsSync(p);
  });
  if (!found) return `${pointer}: no such file or folder in the lesson folder or the repo`;
  if (lineNo === null) return null;
  if (lineNo < 1) return `${pointer}: line numbers start at 1`;
  if (statSync(found).isDirectory()) return `${pointer}: is a folder, so it has no line ${lineNo}`;
  const lines = readFileSync(found, "utf8").replace(/\r?\n$/, "").split(/\r?\n/);
  if (lineNo > lines.length) return `${pointer}: the file has only ${lines.length} lines`;
  if (!lines[lineNo - 1].trim()) return `${pointer}: line ${lineNo} is blank`;
  return null;
}

function missingEvidence(lessonDir, line) {
  const m = /·\s*evidence:\s*(.+?)\s*$/i.exec(line.text);
  if (!m) return "no `· evidence: <pointer>` at the end";
  const pointers = m[1].split(/\s*,\s*/).filter(Boolean);
  if (!pointers.length) return "`· evidence:` names no pointer";
  const bad = pointers.map((p) => checkPointer(lessonDir, p)).filter(Boolean);
  return bad.length ? bad.join("; ") : null;
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const uuid = String(input.tool_input?.uuid || "").toLowerCase();
  const dir = findLesson(uuid);
  if (!dir) decide("deny", `Claim gate: no mega-sXXeYY/receipts.json has challengeId ${uuid}. Write it there (challenge-start step 1) before claiming.`);
  const ticketPath = join(root, dir, "ticket.md");
  if (!existsSync(ticketPath)) decide("deny", `Claim gate: ${dir}/ticket.md is missing. Write it with an Acceptance section before claiming.`);
  const lines = acceptanceLines(readFileSync(ticketPath, "utf8"));
  if (lines === null) decide("deny", `Claim gate: ${dir}/ticket.md has no "## Acceptance" section.`);
  const open = lines.filter((l) => !l.ticked);
  if (open.length) decide("deny", `Claim gate: ${open.length} Acceptance line(s) in ${dir}/ticket.md are not ticked. Check each against the real result, tick it, then claim again:\n${open.map((l) => `- [ ] ${l.text}`).join("\n")}`);
  const lessonDir = join(root, dir);
  const weak = lines
    .map((l) => ({ l, why: missingEvidence(lessonDir, l) }))
    .filter((x) => x.why);
  if (weak.length) decide("deny", `Claim gate: ${weak.length} ticked Acceptance line(s) in ${dir}/ticket.md lack evidence that exists. End each with "· evidence: log.txt:<line>" or "· evidence: <file path>" (several: comma-separated), pointing at what shows the check held:\n${weak.map(({ l, why }) => `ticket.md:${l.lineNo}: ${why}`).join("\n")}`);
  // Pass: no permission decision, so the normal permission rules still apply.
  process.stdout.write(JSON.stringify({
    systemMessage: `Claim gate: every Acceptance line in ${dir}/ticket.md is ticked and points at evidence that exists.`,
  }));
  process.exit(0);
} catch (e) {
  decide("deny", `Claim gate failed, so the claim is held: ${e.message}`);
}
