# Outcome

Handed in the inbox `patryk-mail-agent@agentmail.to`. Its agent is a Cloudflare Worker at https://mail-agent.patrykmatychniak.workers.dev with code in `mail-agent/`: an AgentMail webhook with a Svix signature check feeds a queue, then Claude Opus 5.5 answers using the agent's own `read_page` tool and web search, and the reply goes in the same thread.

It took two rounds. Round 1 was refused as `untrusted_sender_answered`: `team@mail.mega.dev` wrote into Rook's thread and got a polite decline. Round 2 passed after untrusted senders were changed to get no reply at all.

For later lessons:
- Anthropic's web_fetch drops headings and links, so the agent fetches pages itself.
- The first AgentMail key lacked `inbox_create`.
- Trusted senders are now `rook@mail.mega.dev` and `patrykmatychniak@gmail.com`, so Rook's closing note is done.
- No spend cap exists yet.
- The Worker keeps running and spending until someone runs `npx wrangler delete` in `mail-agent/`.
