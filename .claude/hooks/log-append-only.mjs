// PreToolUse gate for Edit, MultiEdit and Write on a lesson journal (mega-sXXeYY/log.txt).
// Works out what the file would hold after the call and denies it unless the old content
// is still there, unchanged, at the start: only appends pass. A new or empty log.txt passes.
// Line endings and a leading BOM are ignored when comparing, since the logs mix CRLF and LF.
// Any error denies too, so a broken gate never lets an overwrite through.
import { readFileSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";

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

const norm = (s) => String(s ?? "").replace(/^﻿/, "").replace(/\r\n/g, "\n");

function applyEdit(text, { old_string, new_string, replace_all }) {
  const from = norm(old_string);
  const to = norm(new_string);
  if (!text.includes(from)) return null; // the tool itself will fail: nothing to judge
  return replace_all ? text.split(from).join(to) : text.replace(from, () => to);
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const tool = input.tool_name;
  const args = input.tool_input || {};
  const file = resolve(String(args.file_path || ""));
  const rel = relative(root, file).replace(/\\/g, "/");
  if (!/^mega-s\d\de\d\d\/log\.txt$/i.test(rel)) process.exit(0);

  const before = existsSync(file) ? norm(readFileSync(file, "utf8")) : "";
  if (!before) process.exit(0);

  let after = before;
  if (tool === "Write") after = norm(args.content);
  else if (tool === "Edit") after = applyEdit(after, args);
  else if (tool === "MultiEdit") {
    for (const e of args.edits || []) {
      if (after === null) break;
      after = applyEdit(after, e);
    }
  } else process.exit(0);
  if (after === null) process.exit(0);

  if (!after.startsWith(before)) {
    decide("deny", `Journal gate: ${rel} is append-only. This ${tool} would change or drop lines already in it. Add new lines at the end only, for example with Add-Content or >>, or a Write whose content starts with the whole current file.`);
  }
  process.exit(0);
} catch (e) {
  decide("deny", `Journal gate failed, so the change is held: ${e.message}`);
}
