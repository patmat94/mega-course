# night-desk

A role that handles Host Desk events while nobody types: a booking changed, a booking cancelled, a guest's message. `night.mjs` is the poller that wakes it: it claims a job on the board, keeps it beating, starts the night, pulls each event, starts the role once per event (`run.mjs`), acks the event and posts its result. You and your harness may change anything here, code included.

All of this week’s Challenges are a simulation. Your agent pays out bookings for a pretend holiday-rental host, with a practice payout key made just for you.

## What is here

| Path | What it is |
|---|---|
| `ROLE.md` | What the role does: its system prompt. |
| `run.mjs` | Starts the role once (Pi with three tools), for one event. |
| `night.mjs` | The poller. |
| `extensions/` | The role's tools: `vars`, `http`, `code`. |
| `hosts.json` | The hosts each secret may reach from this role: the attempt goes to hq.mega.dev only, on every redirect too, and no other secret leaves. If your course runs on another host, change it to that host. |
| `scripts/` | The role's scripts: `event.mjs`, `change.mjs`, `result.mjs`. |

The changes the role records go to `host-desk/night/changes.json`, one row per change: the booking, `nights` added or a `refund` in EUR. Run the payout batch on the bookings with those changes.

## Set it up

1. You need what the S04E01 zip needs: Node.js 22.19 or newer, Pi 1.5 or newer, your model key.
2. In `host-desk/vars.json`, put the attempt from the manual as `ATTEMPT` (fetch the manual once; the night and the payout batch use that one attempt).
3. From `host-desk/`: `MODEL=openrouter/<model id> node roles/night-desk/night.mjs <challenge url>` (the `challenge` URL from start-challenge). On Windows PowerShell: `$env:MODEL = "openrouter/<model id>"; node roles/night-desk/night.mjs <challenge url>`.

## Keep your desk running

The night lasts about 10 minutes. The poller must run for all of it.

- **Pi Durable (recommended)**: the Pi way. `@earendil-works/pi-durable` (MIT) is a library for agents that keep running: their work is saved at every step and comes back after a restart. Hosted on Cloudflare (a free account is enough), it keeps running when your chat and laptop close, and wakes when there is work. You write the small host yourself, with your harness: https://developers.cloudflare.com/agents/harnesses/pi/ and https://www.npmjs.com/package/@earendil-works/pi-durable. It is experimental: its API changes between versions.
- **Claude Code**: start `night.mjs` as a background command and keep the session open, or run `claude -p` in a loop or on a schedule. A command in a `claude -p` run gets 10 minutes by default.
- **Codex**: run `codex exec` in a loop.
- **An OS scheduler**: Windows Task Scheduler, macOS `launchd`, Linux `cron` or a systemd timer, every minute. On macOS, launchd can't read ~/Desktop or ~/Documents: keep the desk in another folder.
- **An open terminal**: start `night.mjs` in a terminal and leave it open.
