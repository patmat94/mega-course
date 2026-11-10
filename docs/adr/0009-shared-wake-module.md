# 0009 · One shared wake module for Workers that outside services call

## Decision

1. Workers that an outside service wakes (a course ping, a mail webhook, a signed HTTPS call) use one module, `lib/wake/` at the repo root. Each Worker imports it by relative path, and wrangler bundles it at deploy. It is never copied into a lesson folder.
2. The module covers only the path every such Worker shares: check the signature, drop a duplicate, put the job on a Cloudflare Queue, answer 2xx, then run the handler from the queue. Outbound pushes go out from the queue: every attempt writes a log row, a failed push stays pending and is retried, and "notified" is written only on a 2xx (ADR 0008).
3. It is a module, not a hosted service. Each Worker keeps its own signing key, its own queue and its own way to take access back (ADR 0006).
4. New Workers use it first. Running Workers (rig-pulse, mail-agent, away-agent) move only when the human says so. rig-pulse stays as it is, because the course checks its may lists exactly.
5. Proof is unit tests with a fake push target, plus a demo Worker deployed to Cloudflare that sends a real ntfy push, because the network route from Cloudflare is where S02E05 failed.
6. A second push channel for when ntfy.sh can't be reached is out of scope. It is a separate decision.

## Why

Three Workers each wired this path by hand. Two of them run the work in `ctx.waitUntil`, which can end without a trace: in S02E05 try 6 the ping to the human was lost that way and arrived about 12 minutes late after manual re-pings (`mega-s02e05/log.txt:183-186`). mail-agent already does it through a queue with retries (`mega-s02e02/mail-agent/src/index.ts:161-198`). The comparison is in `docs/wake-primitive.html`.

## Decided by

The human, 2026-11-10: "can we build the recommended primitive?", then chose lib/wake/ at the repo root, local tests plus a demo Worker, and no second channel for now.
