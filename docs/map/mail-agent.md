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

1. **Probe, no signature, changes nothing.** `GET /` → 200 `mail agent: ok`; `POST /webhooks` with an unsigned `{}` → 401. Pass: both. Last run 2026-11-16: the GET passed; the unsigned POST was not sent, because the Claude Code auto-mode classifier refused the probe call (receipt below). Last full pass 2026-11-12.
2. **Signature tests, offline.** `npm test` in `mega-s02e02/mail-agent` (`test/svix.test.ts`).
3. **Live end to end — sends real mail and spends API credit; ask first.** `node scripts/e2e.mjs send "<subject>" "<text>"`, then `node scripts/e2e.mjs wait <thread_id>`. Pass: a reply in the same thread.

## Agreement

Proposed by the agent on 2026-11-14 from this file and the lesson records; the human has not signed it yet.

- **Should do:** answer mail from `ALLOWED_SENDERS` in the same thread; send nothing at all to anyone else.
- **Signal it works:** each webhook writes a dedupe key `msg:<message-id>` in KV `SEEN` (7-day TTL, `src/index.ts:183`), and a trusted mail gets a reply in its thread (How to verify step 3).
- **Turn off when:** it spends with no cap, so turn it off as soon as no lesson needs the inbox, and at once if any reply goes to an untrusted sender: `npx --no-install wrangler delete` in `mega-s02e02/mail-agent`, after the human's yes.

## Last week (2026-11-07 to 2026-11-14), read on 2026-11-14

- Source: KV `SEEN` keys (`wrangler kv key list --binding SEEN --remote`). Each key lives 7 days, so expiry minus 7 days is when the mail came in. Three keys, three mails reached the webhook: 2026-11-10 11:06:07Z, 2026-11-10 11:32:39Z and 2026-11-14 19:06:46Z.
- The keys do not say who sent each mail or whether a reply went out. No lesson record here explains the mail of 2026-11-14 19:06Z: look in the AgentMail inbox.
- Live version 28429773, created 2026-11-03: not redeployed this week. Workers Logs is on in wrangler.toml, but this machine's wrangler token cannot read it.

```
3 keys
msg:<010001a1c522f765-fea2432d-ceb7-478a-8a42-9deb51be89c0-0 2026-11-17T11:06:07.000Z ""
msg:<010001a1c53b4133-1cee5e31-8bb6-4ea0-802b-39be38341c86-0 2026-11-17T11:32:39.000Z ""
msg:<010001a1db747081-d5b0243f-cc04-4bb8-a5c7-877a62a7028e-0 2026-11-21T19:06:46.000Z ""
```

## Keep in mind

- in S02E02 the course counts any reply to a sender other than rook@mail.mega.dev as answering, a polite decline too, and fails the round · source: mega-s02e02/log.txt:78 · how: ran
- Anthropic's web_fetch tool returned example.com as text with headings and links removed · source: mega-s02e02/log.txt:51 · how: ran
- example.com on 2026-11-03 has no heading and no link, only a title and one paragraph · source: mega-s02e02/log.txt:54 · how: ran
- a restricted AgentMail API key cannot create inboxes (missing inbox_create); the key must come from the console · source: mega-s02e02/log.txt:41 · how: ran

### Receipts

command: How to verify step 1, 2026-11-16, GET only (PowerShell Invoke-WebRequest, no token or signature; body text cut to 160 characters)
```
GET https://mail-agent.patrykmatychniak.workers.dev/ -> 200 mail agent: ok 
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
