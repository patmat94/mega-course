# S02E02 · nobody asked · what becomes true

## Outcome

An agent people can reach by email runs on its own: it gets mail at its own `@agentmail.to` address, does what is asked with its own tools (e.g. reads a linked page and answers a question about it), and replies in the same thread. Its address is handed to the course with claim-challenge, and a course round passes: a mail the course sends gets its reply in the same thread within 10 minutes, with what it asked for. The course writes while the human is away.

## Scope

- `mega-s02e02/` — agent code, config without secrets, log.txt, receipts.json.
- AgentMail inbox (account created by the human), model API (key from the human).
- A host where the agent keeps running unattended (to be chosen with the human).

## Out of scope

- Replying to senders other than the trusted one (`rook@mail.mega.dev`) with tool actions.
- Chat window or terminal interfaces: only inbox, code, model.

## Acceptance

- [x] Agent has its own `<name>@agentmail.to` inbox and receives mail there.
- [x] Agent replies in the same thread (reply to the message, not a new mail).
- [x] Reply arrives within 10 minutes of the course's mail, while no one is at the harness.
- [x] Reply contains what the mail asked for (agent uses its own tools, e.g. fetches the linked page).
- [x] The AgentMail API key (and model key) never appear in any outgoing mail; replies are scanned for them before sending.
- [x] Agent acts on instructions only from `rook@mail.mega.dev`; other senders get no tool use.
- [x] Agent tested end to end with a self-sent mail before the claim.
- [x] Keys live only in `.env` (git-ignored), never in log.txt or a commit.
- [x] Every outside action (account, host deploy, message) had the user's yes first.
- [x] Tickets and tokens are masked in `log.txt`; the raw ones are only in `receipts.json`.
- [x] A mail from any sender other than `rook@mail.mega.dev` gets no reply at all, also inside Rook's thread (deploy af49efae, code path returns before reply).
- [x] claim-challenge round reports a pass (after claim)

## Notes

- Round 1 refused "untrusted_sender_answered": team@mail.mega.dev wrote into Rook's thread and got the fixed decline line. Any reply to an untrusted sender counts as answering, so they now get none. · source: log.txt claim 2026-11-03

- example.com now has no heading and no link (raw HTML checked 2026-11-03), so it is useless as a test page; use a page with known content. · source: log.txt test 2
- Anthropic web_fetch returns text without links/headings; the agent uses its own read_page tool instead. · source: log.txt test 1

- submit: `{"answer":{"inbox":"<name>@agentmail.to"}}`; repeat the same call to see round status; `"newRound": true` after a failed round. · source: start-challenge reply
- Leaked API key in any mail fails the round. · source: start-challenge reply `you`
