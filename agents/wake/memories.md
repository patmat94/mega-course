# wake · memories

What this repo learned the hard way about `lib/wake/`. One line per trap. Each line ends with `· source:` and the ADR, commit, log line or contract line where it was learned. Read by the wake-domain agent (`.claude/agents/wake-domain.md`) at every wake-up.

Rules for this file: no transcripts, no logs pasted in, no line without a source. A line whose source no longer says it gets removed, not kept from memory. Main updates this file; the agent only reads it.

## Engineering

- Never answer 2xx before `queue.send` has resolved: in S02E05 the work ran in `ctx.waitUntil` after the reply and the ping died with no trace, arriving about 12 min late · source: mega-s02e05/log.txt:183, docs/adr/0009-shared-wake-module.md, lib/wake/WAKE.md:13
- The `seen:<kind>:<id>` key is written after `queue.send`, never before (mail-agent wrote it before); moving it up turns a sender's retry after a 503 into a silent "duplicate" · source: commit 8f3260c, lib/wake/WAKE.md:121
- Because `seen` is written after the send, a crash between send and `seen` can queue a job twice; every handler must be safe to run twice · source: lib/wake/WAKE.md:121
- A push is never fetched from the request or from `ctx.waitUntil`: `Tools.push` only queues a push job, and the consumer sends it · source: lib/wake/WAKE.md:137, docs/adr/0008-exact-field-types-and-push-outside-background.md
- Each push attempt writes its `push_attempt` row before anything else, including before the retry waits; a missing push must be visible as rows, not inferred from silence · source: lib/wake/WAKE.md:14, lib/wake/WAKE.md:128
- `notified` is written only on a 2xx from the push service, at that moment, never rebuilt later · source: lib/wake/WAKE.md:15, mega-s02e05/log.txt:186
- From Cloudflare, ntfy.sh refused the first demo pushes 6 times in a row (429, 429, 522, 522, 429, 429) while it answered from the laptop; test pushes from the host, not from this PC · source: commit 551fb26, docs/adr/0008-exact-field-types-and-push-outside-background.md
- The module, not the queue, decides the last try: the queue's `max_retries` in wrangler.toml must stay above `maxTries` (40 vs 30), or the queue drops a message before `push_failed` / `job_failed` is written · source: lib/wake/WAKE.md:139, lib/wake/demo/wrangler.toml:19
- `attempt` in a row is a number, never text; S02E05's validator skipped rows with `"round": "2"` without naming the field, five tries failed · source: mega-s02e05/log.txt:175, docs/adr/0008-exact-field-types-and-push-outside-background.md
- Log keys carry a per-isolate sequence before the random suffix; a random suffix alone put rows from the same millisecond out of order and made a test flaky · source: commit 8f3260c, lib/wake/WAKE.md:150
- Run the tests with a glob, `node --test "lib/wake/test/*.test.ts"`; a bare folder path is read as one file and fails on Node 24 · source: KEEP.md:51, lib/wake/WAKE.md:164
- The package ships compiled `dist/` only: Node refuses to strip types from `.ts` files under `node_modules`, so a consumer could not import raw sources · source: docs/adr/0018-wake-as-a-versioned-package.md:13
- A change to WAKE.md § Exports or to behaviour changes WAKE.md first, then bumps at least the minor version (below 1.0); a published version or release is never replaced, a fix is a new tag · source: lib/wake/WAKE.md:5, docs/adr/0018-wake-as-a-versioned-package.md:15, docs/adr/0019-wake-tarball-on-a-github-release.md:14
- Only `.github/workflows/wake-publish.yml` publishes, on a tag `wake-v<version>` equal to `package.json` version; nobody publishes from a PC · source: docs/adr/0018-wake-as-a-versioned-package.md:14
- Lesson policy (holds, owner codes, may lists, replies, prompts) stays in each Worker, never in lib/wake; a second push channel is out of scope · source: lib/wake/WAKE.md:31, lib/wake/WAKE.md:33
- Running Workers (rig-pulse, mail-agent, away-agent) move onto wake only when the human says so; rig-pulse stays as it is because the course checks its may lists exactly · source: docs/adr/0009-shared-wake-module.md
- Workers in this repo import lib/wake by relative path; other repos install `@patmat94/wake` at an exact version and never copy the source · source: docs/adr/0018-wake-as-a-versioned-package.md:11, docs/adr/0018-wake-as-a-versioned-package.md:12

## Customer-facing

Callers are outside services (the course, mail webhooks) and the agents of other repos that install the package.

- A refusal names the header or check that failed and what was wrong, so the sender can fix it; never a bare 401 · source: lib/wake/WAKE.md:16, lib/wake/WAKE.md:114
- A 503 "could not queue the job, send again" means the sender should resend, and the resend will not be dropped as a duplicate · source: lib/wake/WAKE.md:117
- A repeat within 24 h gets 200 "duplicate" and is not queued again · source: lib/wake/WAKE.md:115, lib/wake/WAKE.md:145
- Rows and refusals never hold signing keys, tokens or full request bodies; `about` is at most 200 characters · source: lib/wake/WAKE.md:34, lib/wake/WAKE.md:151
- Other repos install with no token from the GitHub Release tarball URL; bumping means changing the URL, not only a version number · source: docs/adr/0019-wake-tarball-on-a-github-release.md:13, docs/adr/0019-wake-tarball-on-a-github-release.md:21
