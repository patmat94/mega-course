# mail-agent

## Role

The S02E02 mail agent. AgentMail calls its webhook for each mail to the inbox `patryk-mail-agent@agentmail.to`; it checks the Svix signature, dedupes in KV, queues the job, and the consumer answers trusted senders with Claude (it fetches pages itself). Untrusted senders get no reply at all. Trusted senders: `rook@mail.mega.dev` and `patrykmatychniak@gmail.com` (`ALLOWED_SENDERS`).

## How to get there

- URL: https://mail-agent.patrykmatychniak.workers.dev — `GET /` (health), `POST /webhooks` (AgentMail, Svix-signed)
- Source: `mega-s02e02/mail-agent/src/` — `index.ts` (webhook, queue consumer), `svix.ts` (signature), `guard.ts` (who gets a reply), `page.ts` (page fetch)
- Config: `mega-s02e02/mail-agent/wrangler.toml` — queue `mail-agent-jobs`, KV `SEEN`, vars `INBOX_ID`, `ALLOWED_SENDERS`, `MODEL`
- Secrets: `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY` on Cloudflare and in `mega-s02e02/mail-agent/.dev.vars` (git-ignored)
- Deploy: `npx --no-install wrangler deploy` in `mega-s02e02/mail-agent`; first-time setup was `scripts/provision.mjs`
- Cost: no spend cap; each trusted mail calls the Anthropic API (`mega-s02e02/outcome.md`).

## How to verify

1. **Probe, no signature, changes nothing.** `GET /` → 200 `mail agent: ok`; `POST /webhooks` with an unsigned `{}` → 401. Pass: both. Last run 2026-11-12: passed (receipt below).
2. **Signature tests, offline.** `npm test` in `mega-s02e02/mail-agent` (`test/svix.test.ts`).
3. **Live end to end — sends real mail and spends API credit; ask first.** `node scripts/e2e.mjs send "<subject>" "<text>"`, then `node scripts/e2e.mjs wait <thread_id>`. Pass: a reply in the same thread.

## Keep in mind

- in S02E02 the course counts any reply to a sender other than rook@mail.mega.dev as answering, a polite decline too, and fails the round · source: mega-s02e02/log.txt:78 · how: ran
- Anthropic's web_fetch tool returned example.com as text with headings and links removed · source: mega-s02e02/log.txt:51 · how: ran
- example.com on 2026-11-03 has no heading and no link, only a title and one paragraph · source: mega-s02e02/log.txt:54 · how: ran
- a restricted AgentMail API key cannot create inboxes (missing inbox_create); the key must come from the console · source: mega-s02e02/log.txt:41 · how: ran

### Receipts

command: How to verify step 1 (PowerShell Invoke-WebRequest, no token or signature; body text cut to 160 characters)
```
GET https://mail-agent.patrykmatychniak.workers.dev/ -> 200 mail agent: ok
POST https://mail-agent.patrykmatychniak.workers.dev/webhooks -> 401 
```

command: claim-challenge (S02E02 status check, round 1)
```
"status": "rejected",
"message": "That round is over: untrusted_sender_answered. Claim with \"newRound\": true for a new one.",
```

command: AgentMail POST /v0/inboxes with the first API key
```
{"name":"ForbiddenError","code":"missing_permission","message":"Forbidden","fix":"This API key does not have the 'inbox_create' permission.
```

command: node -e readPage("https://example.com", true)
```
<!doctype html><html lang=en><head><meta charset=utf-8><link rel=icon href=data:,><meta name=viewport content="width=device-width,initial-scale=1"><title>Example Domain</title><style>html{color-scheme:light dark;background:light-dark(#eee,#222)}body{font:16px/1.6 system-ui,sans-serif;max-width:26em;margin:auto;padding:25vh 2em 2em;text-align:center}</style></head><body><p>This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.</p><script src=/s.js></script></body></html>
```
