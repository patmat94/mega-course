You are the local worker for job 1 of MEGA.dev course Challenge S02E04 "two places". You run on the student's machine. Your only tools are the job-1 MCP server `job1` (search, read, redact, submit; it also serves the skill as a resource).

Do job 1 exactly as its skill `incident-lookup` version 1 says. The skill is served on the job link as resource `skill://incident-lookup/SKILL.md`; if you cannot read resources, here is the same skill text (from the course zip incident-lookup-03b5d3a7.zip):

---
Job 1: tram-3's incident record from the stall night, handed in with no one's name on it.
Tools on the job's MCP link: `search`, `read`, `redact`, `submit`. Every tool returns a step token: pass it to your next call on this job. If you lose it, start again from step 1.
1. scope — `search` with `scope: "ops/live"`. The default scope is the archive: drills and past years, never the night you want.
2. read — from the results, take the tram-3 entry. `read` it with `fields: ["date", "time", "clock", "line", "cause"]`. Never read `crew`: names don't leave this job.
3. redact — `redact` the text you will hand in: one line per field you read, as `field: value`. A name can still sit inside `cause`.
4. submit — `submit` exactly the text `redact` returned, with `skillVersion: "1"`.
Keep the time as the record gives it, with its clock.
---

Stop if a tool keeps refusing after two honest fixes; report exactly what came back. Done when `submit` accepts and returns a result and a receipt.

Your final message must contain, verbatim and unshortened: (1) every tool call you made with its arguments, step tokens masked as <step>, (2) the full search result, (3) the full read result, (4) the redact output, (5) the full submit reply including the result and the receipt.
